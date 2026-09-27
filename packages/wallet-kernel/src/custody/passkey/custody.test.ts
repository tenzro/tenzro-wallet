/**
 * Custody flows against a mocked node and an in-memory authenticator.
 * Request shapes are checked field by field against
 * crates/tenzro-node/src/passkey_rpc.rs.
 */

import { describe, expect, it } from 'vitest';

import { fromHex, toHex } from './bytes.ts';
import { ML_DSA_65_PUBLIC_KEY_BYTES, ML_DSA_65_SIGNATURE_BYTES } from './constants.ts';
import { PasskeyCustody } from './custody.ts';
import { deriveCustodyKey, humanDidFromPasskey, verifyCustodySignature } from './derive.ts';
import { passkeySigningDriver } from './driver.ts';
import { FakeAuthenticator, MockRpc, challengeDigest } from './fake-authenticator.fixture.ts';
import { onboardDelegatedAgent, registerControlledMachine } from './machines.ts';
import { PasskeyError } from './webauthn.ts';

const ACCOUNT = '0x00000000000000000000000000000000000a11ce';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function nodeMock(extra: Record<string, (params: never) => unknown> = {}) {
  let n = 0;
  const credentialIds: string[] = [];
  const rpc = new MockRpc({
    tenzro_createCustodyChallenge: () => {
      n += 1;
      return { challenge_id: `c${n}`, challenge_hex: challengeDigest(n), expires_in_secs: 300 };
    },
    tenzro_enrollPasskey: (p: { passkey_public_key_hex: string; credential_id_hex: string }) => {
      credentialIds.push(p.credential_id_hex);
      return {
        did: humanDidFromPasskey(fromHex(p.passkey_public_key_hex)),
        smart_account_address: ACCOUNT,
        credential_id_hex: p.credential_id_hex,
        webauthn_validator_address: '0x0000000000000000000000000000000000001020',
        installed_validators: ['webauthn'],
      };
    },
    tenzro_listPasskeys: () => ({
      account_address: ACCOUNT,
      count: credentialIds.length,
      credential_ids: credentialIds,
    }),
    tenzro_getAccountRecord: () => ({ record: { account_address: ACCOUNT, credentials: [] } }),
    tenzro_addPasskey: (p: { new_credential_id_hex: string }) => {
      credentialIds.push(p.new_credential_id_hex);
      return {
        account_address: ACCOUNT,
        credential_id_hex: p.new_credential_id_hex,
        credentials_total: credentialIds.length,
      };
    },
    tenzro_removePasskey: () => ({
      removed: true,
      credentials_remaining: credentialIds.length - 1,
    }),
    tenzro_setSpendingLimit: (p: unknown) => p,
    tenzro_grantSessionKey: (p: unknown) => p,
    tenzro_setPasskeyPolicy: (p: unknown) => p,
    tenzro_initiateRecovery: () => ({
      recovery_id: 'r1',
      account_address: ACCOUNT,
      recovery_op_hash_hex: challengeDigest(99),
      expires_at_ms: 0,
      guardians_required: 1,
      guardians_total: 2,
    }),
    ...extra,
  });
  return { rpc, credentialIds };
}

async function enrolled() {
  const auth = new FakeAuthenticator();
  const { rpc, credentialIds } = nodeMock();
  const custody = new PasskeyCustody({ rpc, authenticator: auth });
  const account = await custody.createWallet({ displayName: 'Ada' });
  return { auth, rpc, custody, account, credentialIds };
}

describe('createWallet', () => {
  it('proves possession of both legs over an enroll_passkey challenge', async () => {
    const { auth, rpc, account } = await enrolled();
    const cred = auth.credentials[0]!;

    const [challengeReq] = rpc.paramsOf('tenzro_createCustodyChallenge');
    // passkey_rpc.rs require_key_possession: account = the P-256 key (x || y),
    // target = credential_id || ml_dsa_public_key.
    expect(challengeReq?.account_address).toBe(toHex(cred.publicKey, true));
    expect(challengeReq?.operation).toBe('enroll_passkey');
    const target = fromHex(challengeReq?.target_hex as string);
    expect(toHex(target.slice(0, cred.id.length))).toBe(toHex(cred.id));
    expect(target.length).toBe(cred.id.length + ML_DSA_65_PUBLIC_KEY_BYTES);

    const [enroll] = rpc.paramsOf('tenzro_enrollPasskey');
    expect(Object.keys(enroll ?? {}).sort()).toEqual([
      'authorization',
      'credential_id_hex',
      'display_name',
      'ml_dsa_public_key_hex',
      'passkey_public_key_hex',
      'salt',
    ]);
    expect(enroll?.passkey_public_key_hex).toBe(toHex(cred.publicKey, true));
    expect(enroll?.credential_id_hex).toBe(toHex(cred.id, true));
    expect(enroll?.salt).toBe(0);
    const vk = fromHex(enroll?.ml_dsa_public_key_hex as string);
    expect(toHex(vk)).toBe(toHex(target.slice(cred.id.length)));

    const authz = enroll?.authorization as {
      challenge_id: string;
      credential_id_hex: string;
      assertion: Record<string, unknown>;
      ml_dsa_signature_hex: string;
    };
    expect(authz.challenge_id).toBe('c1');
    expect(authz.credential_id_hex).toBe(toHex(cred.id, true));
    // Byte fields travel as JSON number arrays, never base64.
    expect(Array.isArray(authz.assertion.authenticator_data)).toBe(true);
    expect(Array.isArray(authz.assertion.client_data_json)).toBe(true);
    expect(Array.isArray(authz.assertion.signature)).toBe(true);
    const clientData = JSON.parse(
      new TextDecoder().decode(new Uint8Array(authz.assertion.client_data_json as number[])),
    ) as { challenge: string };
    const digest = fromHex(challengeDigest(1));
    expect(clientData.challenge).toBe(b64url(digest));
    const mlSig = fromHex(authz.ml_dsa_signature_hex);
    expect(mlSig).toHaveLength(ML_DSA_65_SIGNATURE_BYTES);
    expect(verifyCustodySignature(digest, mlSig, vk)).toBe(true);

    expect(account.did).toBe(humanDidFromPasskey(cred.publicKey));
    expect(account.account).toBe(ACCOUNT);
    expect(account.credentialId).toBe(toHex(cred.id));
  });

  it('derives the same ML-DSA key the passkey will reproduce later', async () => {
    const { auth, rpc } = await enrolled();
    const [enroll] = rpc.paramsOf('tenzro_enrollPasskey');
    const signed = await auth.get({ challenge: new Uint8Array(32), allow: [] });
    expect(toHex(deriveCustodyKey(signed.prf!).publicKey, true)).toBe(
      enroll?.ml_dsa_public_key_hex,
    );
  });

  it('reads the PRF with one extra assertion when create() did not return it', async () => {
    const auth = new FakeAuthenticator();
    auth.returnPrfOnCreate = false;
    const { rpc } = nodeMock();
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    const account = await custody.createWallet({ displayName: 'Ada' });
    expect(account.account).toBe(ACCOUNT);
  });

  it('refuses an identity that does not derive from the passkey', async () => {
    const auth = new FakeAuthenticator();
    const { rpc } = nodeMock({
      tenzro_enrollPasskey: () => ({
        did: 'did:tenzro:human:00000000-0000-8000-8000-000000000000',
        smart_account_address: ACCOUNT,
      }),
    });
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    await expect(custody.createWallet({ displayName: 'Ada' })).rejects.toBeInstanceOf(PasskeyError);
  });
});

describe('linkDevice', () => {
  it('creates the new passkey first and binds its P-256 key as the add_passkey target', async () => {
    const { auth, rpc, custody, account } = await enrolled();
    const first = auth.credentials[0]!;
    auth.preferred = toHex(first.id);

    const res = await custody.linkDevice({ account: account.account, label: 'Laptop' });
    const second = auth.credentials[1]!;
    expect(res.credentials_total).toBe(2);
    // user.id of a linked passkey is the 20-byte account, so sign-in finds it.
    expect(toHex(second.userId, true)).toBe(ACCOUNT);

    const challenges = rpc.paramsOf('tenzro_createCustodyChallenge');
    const addChallenge = challenges.at(-1);
    expect(addChallenge?.operation).toBe('add_passkey');
    expect(addChallenge?.account_address).toBe(ACCOUNT);
    expect(addChallenge?.target_hex).toBe(toHex(second.publicKey, true));

    const [add] = rpc.paramsOf('tenzro_addPasskey');
    expect(Object.keys(add ?? {}).sort()).toEqual([
      'account_address',
      'authorization',
      'label',
      'new_credential_id_hex',
      'new_passkey_public_key_hex',
      'new_pq_verifying_key_hex',
    ]);
    expect(fromHex(add?.new_pq_verifying_key_hex as string).length).toBe(
      ML_DSA_65_PUBLIC_KEY_BYTES,
    );
    expect(add?.new_passkey_public_key_hex).toBe(toHex(second.publicKey, true));
    const authz = add?.authorization as { credential_id_hex: string };
    expect(authz.credential_id_hex).toBe(toHex(first.id, true));
  });
});

describe('removeDevice', () => {
  it('refuses to remove the last passkey without asking the node', async () => {
    const { rpc, custody, account } = await enrolled();
    const before = rpc.calls.length;
    await expect(
      custody.removeDevice({
        account: account.account,
        credentialIdHex: account.credentialId,
        approver: { id: account.credentialId },
      }),
    ).rejects.toMatchObject({ kind: 'last-device' });
    expect(rpc.calls.slice(before).map((c) => c.method)).toEqual(['tenzro_listPasskeys']);
  });

  it('binds the credential id as the remove_passkey target', async () => {
    const { auth, rpc, custody, account } = await enrolled();
    auth.preferred = account.credentialId;
    await custody.linkDevice({ account: account.account, label: 'Phone' });
    const second = toHex(auth.credentials[1]!.id);

    await custody.removeDevice({
      account: account.account,
      credentialIdHex: `0x${second}`,
      approver: { id: account.credentialId },
    });
    const challenge = rpc.paramsOf('tenzro_createCustodyChallenge').at(-1);
    expect(challenge?.operation).toBe('remove_passkey');
    expect(challenge?.target_hex).toBe(`0x${second}`);
    const [remove] = rpc.paramsOf('tenzro_removePasskey');
    expect(remove?.credential_id_hex).toBe(`0x${second}`);
  });
});

describe('policy, limits and session keys', () => {
  it('set_spending_limit uses an empty target and a 32-byte authenticator key', async () => {
    const { rpc, custody, account } = await enrolled();
    await custody.setSpendingLimit({
      account: account.account,
      perTxCapWei: '1000',
      dailyCapWei: '5000',
      approver: { id: account.credentialId },
    });
    const challenge = rpc.paramsOf('tenzro_createCustodyChallenge').at(-1);
    expect(challenge?.operation).toBe('set_spending_limit');
    expect(challenge).not.toHaveProperty('target_hex');
    const [limit] = rpc.paramsOf('tenzro_setSpendingLimit');
    expect(limit?.per_tx_cap_wei).toBe('1000');
    expect(limit?.daily_cap_wei).toBe('5000');
    expect(fromHex(limit?.authenticator_pubkey_hex as string)).toHaveLength(32);
  });

  it('grant_session_key binds the session public key', async () => {
    const { rpc, custody, account } = await enrolled();
    const sessionKey = `0x${'5a'.repeat(32)}`;
    await custody.grantSessionKey({
      account: account.account,
      approver: { id: account.credentialId },
      grant: {
        sessionPublicKeyHex: sessionKey,
        allowedSelectors: ['0xa9059cbb'],
        maxValuePerCallWei: '10',
        validAfterUnix: 1,
        validUntilUnix: 2,
      },
    });
    const challenge = rpc.paramsOf('tenzro_createCustodyChallenge').at(-1);
    expect(challenge?.operation).toBe('grant_session_key');
    expect(challenge?.target_hex).toBe(sessionKey);
    const [grant] = rpc.paramsOf('tenzro_grantSessionKey');
    expect(grant?.allowed_selectors_hex).toEqual(['a9059cbb']);
    expect(grant?.session_pubkey_hex).toBe('5a'.repeat(32));
  });

  it('two-device approval needs two passkeys', async () => {
    const { custody, account } = await enrolled();
    await expect(
      custody.setSecondFactor({
        account: account.account,
        policy: 'two_credentials',
        approver: { id: account.credentialId },
      }),
    ).rejects.toBeInstanceOf(PasskeyError);
  });
});

describe('recovery', () => {
  it('starts recovery with a new passkey and its own ML-DSA key', async () => {
    const auth = new FakeAuthenticator();
    const { rpc } = nodeMock();
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    const started = await custody.startRecovery({ account: ACCOUNT, label: 'New phone' });
    expect(started.recovery_id).toBe('r1');
    const [req] = rpc.paramsOf('tenzro_initiateRecovery');
    expect(fromHex(req?.new_ml_dsa_public_key_hex as string)).toHaveLength(
      ML_DSA_65_PUBLIC_KEY_BYTES,
    );
    expect(req?.new_passkey_public_key_hex).toBe(toHex(auth.credentials[0]!.publicKey, true));
  });
});

describe('signIn', () => {
  it('finds a linked passkey through its 20-byte user handle', async () => {
    const { auth, custody, account } = await enrolled();
    auth.preferred = account.credentialId;
    await custody.linkDevice({ account: account.account, label: 'Laptop' });
    auth.preferred = toHex(auth.credentials[1]!.id);
    const found = await custody.signIn();
    expect(found.account).toBe(ACCOUNT);
    expect(found.credentialId).toBe(toHex(auth.credentials[1]!.id));
  });

  it('finds the first passkey by recovering its key and resolving the DID', async () => {
    const auth = new FakeAuthenticator();
    const { rpc } = nodeMock();
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    await custody.createWallet({ displayName: 'Ada' });
    const did = humanDidFromPasskey(auth.credentials[0]!.publicKey);
    rpc.handlers.tenzro_resolveIdentity = ((p: { did: string }) =>
      p.did === did
        ? { did, display_name: 'Ada', metadata: { smart_account_address: ACCOUNT } }
        : Promise.reject(new Error('not found'))) as (params: never) => unknown;
    const found = await custody.signIn();
    expect(found.did).toBe(did);
    expect(found.account).toBe(ACCOUNT);
  });
});

describe('passkeySigningDriver', () => {
  it('returns one bincode bundle whose ML-DSA leg verifies over the op hash', async () => {
    const { auth, account } = await enrolled();
    const driver = passkeySigningDriver({
      authenticator: auth,
      credentials: () => [{ id: account.credentialId }],
    });
    const opHash = fromHex(challengeDigest(7));
    const res = await driver.sign({
      did: account.did as never,
      surfaceKey: {
        surface: 'tenzro-native',
        scheme: 'webauthn-p256+ml-dsa-65',
        address: ACCOUNT,
        credentialIds: [account.credentialId],
      },
      scheme: 'webauthn-p256+ml-dsa-65',
      preimage: opHash,
    });
    expect(res.signatures).toHaveLength(1);
    const bundle = res.signatures[0]!;
    // Vec length prefix (u64 LE) = 1 entry.
    expect(toHex(bundle.slice(0, 8))).toBe('0100000000000000');
    // The ML-DSA signature is the 3309-byte field before the credential id.
    const credLen = fromHex(account.credentialId).length;
    const mlSig = bundle.slice(
      bundle.length - 8 - credLen - ML_DSA_65_SIGNATURE_BYTES,
      bundle.length - 8 - credLen,
    );
    const signed = await auth.get({ challenge: new Uint8Array(32), allow: [] });
    expect(verifyCustodySignature(opHash, mlSig, deriveCustodyKey(signed.prf!).publicKey)).toBe(
      true,
    );
  });

  it('refuses other schemes and non-32-byte preimages', async () => {
    const driver = passkeySigningDriver({ authenticator: new FakeAuthenticator() });
    const surfaceKey = {
      surface: 'tenzro-native' as const,
      scheme: 'webauthn-p256+ml-dsa-65' as const,
      address: ACCOUNT,
      credentialIds: [],
    };
    await expect(
      driver.sign({
        did: 'x' as never,
        surfaceKey,
        scheme: 'ed25519',
        preimage: new Uint8Array(32),
      }),
    ).rejects.toBeInstanceOf(PasskeyError);
    await expect(
      driver.sign({
        did: 'x' as never,
        surfaceKey,
        scheme: 'webauthn-p256+ml-dsa-65',
        preimage: new Uint8Array(31),
      }),
    ).rejects.toBeInstanceOf(PasskeyError);
  });
});

describe('agents and machines', () => {
  const human = 'did:tenzro:human:a828941c-fe91-8250-af8b-a16527305188';
  const scope = { maxTransactionValueWei: '1000', maxDailySpendWei: '5000' };

  it('onboards a delegated agent under a human controller with the node field names', async () => {
    const rpc = new MockRpc({ tenzro_onboardDelegatedAgent: (p: unknown) => p });
    await onboardDelegatedAgent(rpc, {
      controllerDid: human,
      pairing: { devicePublicKeyHex: `0x${'ab'.repeat(32)}`, machineId: 'tpm-ek-1' },
      capabilities: ['inference'],
      scope: { ...scope, allowedPaymentProtocols: ['x402'] },
    });
    const [p] = rpc.paramsOf('tenzro_onboardDelegatedAgent');
    expect(p).toEqual({
      controller_did: human,
      device_public_key: 'ab'.repeat(32),
      machine_id: 'tpm-ek-1',
      capabilities: ['inference'],
      delegation_scope: {
        max_transaction_value: '1000',
        max_daily_spend: '5000',
        allowed_payment_protocols: ['x402'],
      },
    });
  });

  it('never creates an agent without a human owner or a hardware key', async () => {
    const rpc = new MockRpc({ tenzro_onboardDelegatedAgent: (p: unknown) => p });
    const pairing = { devicePublicKeyHex: 'ab'.repeat(32), machineId: 'm' };
    for (const controllerDid of ['self', 'did:tenzro:machine:1234', 'not-a-did']) {
      await expect(
        onboardDelegatedAgent(rpc, { controllerDid, pairing, capabilities: [], scope }),
      ).rejects.toBeInstanceOf(PasskeyError);
    }
    await expect(
      onboardDelegatedAgent(rpc, {
        controllerDid: human,
        pairing: { devicePublicKeyHex: '', machineId: 'm' },
        capabilities: [],
        scope,
      }),
    ).rejects.toBeInstanceOf(PasskeyError);
    await expect(
      onboardDelegatedAgent(rpc, {
        controllerDid: human,
        pairing,
        capabilities: [],
        scope: { maxTransactionValueWei: '1.5', maxDailySpendWei: '1' },
      }),
    ).rejects.toBeInstanceOf(PasskeyError);
    expect(rpc.calls).toHaveLength(0);
  });

  it('registers a controlled machine with its device key', async () => {
    const rpc = new MockRpc({ tenzro_registerMachineIdentity: (p: unknown) => p });
    await registerControlledMachine(rpc, {
      controllerDid: human,
      devicePublicKeyHex: `0x${'cd'.repeat(32)}`,
      capabilities: ['compute'],
      scope,
    });
    const [p] = rpc.paramsOf('tenzro_registerMachineIdentity');
    expect(p?.public_key).toBe('cd'.repeat(32));
    expect(p?.controller_did).toBe(human);
  });
});
