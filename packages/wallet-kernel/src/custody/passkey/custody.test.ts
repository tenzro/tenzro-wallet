/**
 * Custody flows against a mocked node and an in-memory authenticator.
 * Request shapes are checked field by field against
 * crates/tenzro-node/src/passkey_rpc.rs.
 */

import { describe, expect, it } from 'vitest';

import { agentTermsTarget } from '../../ports/agent/agent-terms.ts';
import { fromHex, toHex } from './bytes.ts';
import { SignatureContext, signingDigest, webauthnChallenge } from './composite.ts';
import { PasskeyCustody, decodeRecoveryRequest, encodeRecoveryRequest } from './custody.ts';
import { humanDidFromPasskey } from './derive.ts';
import { passkeySigningDriver } from './driver.ts';
import { FakeAuthenticator, MockRpc, challengeDigest } from './fake-authenticator.fixture.ts';
import { custodyChallengeDigest } from './gate.ts';
import {
  type GuardianCard,
  guardianTarget,
  recoveryApprovalChallenge,
  recoveryOpHash,
} from './guardian.ts';
import { agentActionDigest, agentWalletAccount } from './step-up.ts';
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
  const digests: Uint8Array[] = [];
  const rpc = new MockRpc({
    tenzro_createCustodyChallenge: (p: {
      account_address: string;
      operation: string;
      target_hex?: string;
    }) => {
      n += 1;
      const nonce = new Uint8Array(16).fill(n);
      const target = p.target_hex ? fromHex(p.target_hex) : new Uint8Array(0);
      const digest = custodyChallengeDigest(fromHex(p.account_address), p.operation, target, nonce);
      digests.push(digest);
      return {
        challenge_id: `c${n}`,
        challenge_hex: toHex(digest, true),
        webauthn_challenge: webauthnChallenge(SignatureContext.AccountOwner, digest),
        nonce_hex: toHex(nonce, true),
        target_hex: toHex(target, true),
        expires_in_secs: 300,
      };
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
  return { rpc, credentialIds, digests };
}

async function enrolled() {
  const auth = new FakeAuthenticator();
  const { rpc, credentialIds, digests } = nodeMock();
  const custody = new PasskeyCustody({ rpc, authenticator: auth });
  const account = await custody.createWallet({ displayName: 'Ada' });
  return { auth, rpc, custody, account, credentialIds, digests };
}

describe('createWallet', () => {
  it('proves possession of the passkey over an enroll_passkey challenge', async () => {
    const { auth, rpc, account, digests } = await enrolled();
    const cred = auth.credentials[0]!;

    const [challengeReq] = rpc.paramsOf('tenzro_createCustodyChallenge');
    // passkey_rpc.rs require_key_possession: account = the P-256 key (x || y),
    // target = credential_id.
    expect(challengeReq?.account_address).toBe(toHex(cred.publicKey, true));
    expect(challengeReq?.operation).toBe('enroll_passkey');
    expect(challengeReq?.target_hex).toBe(toHex(cred.id, true));

    const [enroll] = rpc.paramsOf('tenzro_enrollPasskey');
    expect(Object.keys(enroll ?? {}).sort()).toEqual([
      'authorization',
      'credential_id_hex',
      'display_name',
      'passkey_public_key_hex',
      'registration_authenticator_data_hex',
      'salt',
    ]);
    expect(enroll?.passkey_public_key_hex).toBe(toHex(cred.publicKey, true));
    expect(enroll?.credential_id_hex).toBe(toHex(cred.id, true));
    expect(enroll?.salt).toBe(0);
    const reg = fromHex(enroll?.registration_authenticator_data_hex as string);
    expect(reg[32]! & 0x40).toBe(0x40);

    const authz = enroll?.authorization as Record<string, unknown> & {
      assertion: Record<string, unknown>;
    };
    expect(Object.keys(authz).sort()).toEqual(['assertion', 'challenge_id', 'credential_id_hex']);
    expect(authz.challenge_id).toBe('c1');
    expect(authz.credential_id_hex).toBe(toHex(cred.id, true));
    // Byte fields travel as JSON number arrays, never base64.
    expect(Array.isArray(authz.assertion.authenticator_data)).toBe(true);
    const clientData = JSON.parse(
      new TextDecoder().decode(new Uint8Array(authz.assertion.client_data_json as number[])),
    ) as { challenge: string };
    expect(clientData.challenge).toBe(
      webauthnChallenge(SignatureContext.AccountOwner, digests[0]!),
    );

    expect(account.did).toBe(humanDidFromPasskey(cred.publicKey));
    expect(account.account).toBe(ACCOUNT);
    expect(account.credentialId).toBe(toHex(cred.id));
  });

  it('refuses a challenge whose digest does not match the requested change', async () => {
    const auth = new FakeAuthenticator();
    const { rpc } = nodeMock({
      tenzro_createCustodyChallenge: () => ({
        challenge_id: 'c1',
        challenge_hex: challengeDigest(1),
        nonce_hex: toHex(new Uint8Array(16), true),
        expires_in_secs: 300,
      }),
    });
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    await expect(custody.createWallet({ displayName: 'Ada' })).rejects.toBeInstanceOf(PasskeyError);
    expect(rpc.paramsOf('tenzro_enrollPasskey')).toHaveLength(0);
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

describe('createWallet on a device that already has a Tenzro passkey', () => {
  it('opens the existing wallet instead of making a second identity', async () => {
    const auth = new FakeAuthenticator();
    const { rpc } = nodeMock({
      // Only the DID derived from the enrolled passkey resolves, so a wrongly
      // recovered key would find nothing.
      tenzro_resolveIdentity: (p: { did: string }) =>
        auth.credentials[0] && p.did === humanDidFromPasskey(auth.credentials[0].publicKey)
          ? { did: p.did, metadata: { smart_account_address: ACCOUNT } }
          : null,
    });
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    const account = await custody.createWallet({ displayName: 'Ada' });
    auth.immediateGet = true;
    const again = await custody.createWallet({ displayName: 'Ada again' });
    expect(again.existing).toBe(true);
    expect(again.account).toBe(account.account);
    expect(auth.credentials).toHaveLength(1);
    expect(rpc.paramsOf('tenzro_enrollPasskey')).toHaveLength(1);
  });

  it('creates as before where the browser cannot ask silently', async () => {
    const { auth, rpc, custody } = await enrolled();
    auth.immediateGet = false;
    const fresh = await custody.createWallet({ displayName: 'Second' });
    expect(fresh.existing).toBeUndefined();
    expect(auth.credentials).toHaveLength(2);
    expect(rpc.paramsOf('tenzro_enrollPasskey')).toHaveLength(2);
  });
});

describe('linkDevice', () => {
  it('ties to the passkey a device already holds (synced) instead of failing', async () => {
    const { auth, rpc, custody, account } = await enrolled();
    const first = auth.credentials[0]!;
    auth.syncsExisting = true;
    auth.preferred = toHex(first.id);

    const res = await custody.linkDevice({
      account: account.account,
      label: 'iPhone',
      hints: ['hybrid'],
    });
    expect(res.already_linked).toBe(true);
    expect(res.credential_id_hex).toBe(toHex(first.id, true));
    expect(res.credentials_total).toBe(1);
    expect(auth.credentials).toHaveLength(1);
    expect(rpc.paramsOf('tenzro_addPasskey')).toHaveLength(0);
  });

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
      'new_credential_proof',
      'new_passkey_public_key_hex',
      'new_registration_authenticator_data_hex',
    ]);
    // The new passkey signs the same challenge as the approving one.
    const proof = add?.new_credential_proof as { assertion: { client_data_json: number[] } };
    const authzCd = (add?.authorization as { assertion: { client_data_json: number[] } }).assertion
      .client_data_json;
    const challengeOf = (cd: number[]) =>
      (JSON.parse(new TextDecoder().decode(new Uint8Array(cd))) as { challenge: string }).challenge;
    expect(challengeOf(proof.assertion.client_data_json)).toBe(challengeOf(authzCd));
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
  function recoveryNode() {
    const pending: Record<string, unknown>[] = [];
    const { rpc } = nodeMock({
      tenzro_initiateRecovery: ((p: {
        account_address: string;
        new_passkey_public_key_hex: string;
        new_credential_id_hex: string;
      }) => {
        const r = {
          recovery_id: 'r1',
          account_address: p.account_address,
          expires_at_ms: 1_700_000_000_000,
          guardians_required: 2,
          guardians_total: 3,
        };
        pending.push({
          recovery_id: 'r1',
          new_credential_id_hex: p.new_credential_id_hex,
          created_at_ms: 0,
          expires_at_ms: r.expires_at_ms,
          ready_at_ms: null,
          guardian_signatures_collected: 0,
          finalized: false,
          cancelled: false,
        });
        return {
          ...r,
          recovery_op_hash_hex: toHex(
            recoveryOpHash({
              account: p.account_address,
              newPasskeyPublicKey: fromHex(p.new_passkey_public_key_hex),
              newCredentialId: fromHex(p.new_credential_id_hex),
              recoveryId: 'r1',
              expiresAtMs: r.expires_at_ms,
            }),
            true,
          ),
        };
      }) as (params: never) => unknown,
      tenzro_listPendingRecoveries: () => ({ pending_recoveries: pending }),
      tenzro_submitRecoverySignature: ((p: unknown) => ({
        ...(p as object),
        guardian_signatures_collected: 1,
        guardians_required: 2,
        quorum_reached: false,
        ready_at_ms: null,
      })) as (params: never) => unknown,
    });
    return rpc;
  }

  it('starts recovery with a new passkey only', async () => {
    const auth = new FakeAuthenticator();
    const rpc = recoveryNode();
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    const started = await custody.startRecovery({ account: ACCOUNT, label: 'New phone' });
    expect(started.recovery_id).toBe('r1');
    const [req] = rpc.paramsOf('tenzro_initiateRecovery');
    expect(Object.keys(req ?? {}).sort()).toEqual([
      'account_address',
      'new_credential_id_hex',
      'new_passkey_public_key_hex',
      'new_registration_authenticator_data_hex',
    ]);
    expect(req?.new_passkey_public_key_hex).toBe(toHex(auth.credentials[0]!.publicKey, true));
  });

  it('refuses a recovery the node started for a different passkey', async () => {
    const auth = new FakeAuthenticator();
    const { rpc } = nodeMock();
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    await expect(
      custody.startRecovery({ account: ACCOUNT, label: 'New phone' }),
    ).rejects.toBeInstanceOf(PasskeyError);
  });

  it('adds a guardian from its card, approving exactly its key, provider, role and label', async () => {
    const { rpc, custody, account } = await enrolled();
    rpc.handlers.tenzro_addGuardian = (() => ({ guardian_count: 1, threshold: 1 })) as (
      params: never,
    ) => unknown;
    const guardianDevice = new FakeAuthenticator();
    guardianDevice.tier = 'synced';
    guardianDevice.aaguid = new Uint8Array(16).fill(0xa1);
    const card: GuardianCard = await new PasskeyCustody({
      rpc,
      authenticator: guardianDevice,
    }).createGuardian({ label: 'Sam', source: 'trusted_person' });
    expect(card.role).toBe('device');

    await custody.addGuardian({
      account: account.account,
      card,
      threshold: 1,
      approver: { id: account.credentialId },
    });
    const challenge = rpc.paramsOf('tenzro_createCustodyChallenge').at(-1);
    expect(challenge?.operation).toBe('add_guardian');
    expect(challenge?.target_hex).toBe(toHex(guardianTarget(card), true));
    const [added] = rpc.paramsOf('tenzro_addGuardian');
    expect(Object.keys(added ?? {}).sort()).toEqual([
      'account_address',
      'authorization',
      'guardian_credential_id_hex',
      'guardian_p256_pubkey_hex',
      'guardian_registration_authenticator_data_hex',
      'label',
      'role',
      'threshold',
    ]);
    expect(added?.guardian_p256_pubkey_hex).toBe(
      toHex(guardianDevice.credentials[0]!.publicKey, true),
    );
  });

  it('approves from the guardian device at the index its key holds', async () => {
    const rpc = recoveryNode();
    const recovering = new PasskeyCustody({ rpc, authenticator: new FakeAuthenticator() });
    const { request } = await recovering.startRecovery({ account: ACCOUNT, label: 'New phone' });

    const guardianDevice = new FakeAuthenticator();
    const guardian = new PasskeyCustody({ rpc, authenticator: guardianDevice });
    const card = await guardian.createGuardian({ label: 'Key', source: 'security_key' });
    rpc.handlers.tenzro_listGuardians = (() => ({
      threshold: 2,
      independent_roots: 2,
      members: [
        {
          index: 0,
          p256_pubkey_hex: `0x${'05'.repeat(64)}`,
          role: 'device',
          aaguid: '0x',
          backup_eligible: false,
          backup_state: false,
        },
        {
          index: 1,
          p256_pubkey_hex: card.p256,
          role: 'recovery_key',
          aaguid: '0x',
          backup_eligible: false,
          backup_state: false,
        },
      ],
    })) as (params: never) => unknown;

    await guardian.approveRecovery(request);
    const [sub] = rpc.paramsOf('tenzro_submitRecoverySignature');
    expect(Object.keys(sub ?? {}).sort()).toEqual(['guardian_index', 'recovery_id', 'signature']);
    expect(sub?.guardian_index).toBe(1);
    const sig = sub?.signature as {
      classical: { form: string; client_data_json: string };
      pq?: unknown;
    };
    expect(sig.classical.form).toBe('web_authn');
    expect(sig.pq).toBeUndefined();
    const cd = JSON.parse(new TextDecoder().decode(fromHex(sig.classical.client_data_json))) as {
      challenge: string;
    };
    const opHash = recoveryOpHash({
      account: ACCOUNT,
      newPasskeyPublicKey: fromHex(request.newPasskeyPublicKeyHex),
      newCredentialId: fromHex(request.newCredentialIdHex),
      recoveryId: 'r1',
      expiresAtMs: request.expiresAtMs,
    });
    expect(cd.challenge).toBe(b64url(recoveryApprovalChallenge(opHash)));
  });

  /**
   * Wire vectors for the node: the requests this wallet sends to enrol a
   * passkey, add a guardian and approve a recovery, with the values both
   * sides derive. TENZRO_WRITE_FIXTURES=1 rewrites the file (keys and
   * signatures are fresh each time); otherwise the derived values in the
   * committed file are recomputed here. The node's
   * passkey_rpc_wallet_vectors test verifies the same file.
   */
  it('matches the committed wire vectors', async () => {
    const fs = await import('node:fs');
    const path = new URL('./fixtures/wire-vectors.json', import.meta.url);
    type Vectors = {
      rp_id: string;
      account: string;
      account_passkey_hex: string;
      enroll_request: Record<string, unknown>;
      guardian_card: GuardianCard;
      other_guardian_card: GuardianCard;
      add_guardian: {
        target_hex: string;
        nonce_hex: string;
        challenge_hex: string;
        request: Record<string, unknown>;
      };
      recovery: {
        recovery_id: string;
        expires_at_ms: number;
        initiate_request: Record<string, unknown>;
        op_hash_hex: string;
        approval_challenge_hex: string;
        guardian_index: number;
        submit_request: Record<string, unknown>;
      };
    };
    if (process.env.TENZRO_WRITE_FIXTURES === '1') {
      const { rpc, custody, account, auth } = await enrolled();
      rpc.handlers.tenzro_addGuardian = (() => ({ guardian_count: 2, threshold: 2 })) as (
        params: never,
      ) => unknown;
      // Fake authenticators derive keys from a counter: skip ahead so every
      // passkey in the vectors is distinct.
      const fresh = async (skip: number) => {
        const a = new FakeAuthenticator();
        for (let i = 0; i < skip; i++)
          await a.create({ userId: new Uint8Array(16), userName: 'skip' });
        return a;
      };
      const guardianDevice = await fresh(1);
      guardianDevice.tier = 'synced';
      guardianDevice.aaguid = new Uint8Array(16).fill(0xa1);
      const guardian = new PasskeyCustody({ rpc, authenticator: guardianDevice });
      const card = await guardian.createGuardian({ label: '  Sam (é) ', source: 'trusted_person' });
      guardianDevice.preferred = card.credentialId.replace(/^0x/, '').toLowerCase();
      await custody.addGuardian({
        account: account.account,
        card,
        threshold: 2,
        approver: { id: account.credentialId },
      });
      const challenge = rpc.paramsOf('tenzro_createCustodyChallenge').at(-1)!;
      const nonce = new Uint8Array(16).fill(rpc.paramsOf('tenzro_createCustodyChallenge').length);
      const target = guardianTarget(card);

      const node = recoveryNode();
      const { request } = await new PasskeyCustody({
        rpc: node,
        authenticator: await fresh(2),
      }).startRecovery({
        account: ACCOUNT,
        label: 'New phone',
      });
      const other = await new PasskeyCustody({
        rpc: node,
        authenticator: await fresh(3),
      }).createGuardian({
        label: 'Other',
        source: 'security_key',
      });
      const member = (c: GuardianCard, index: number) => ({
        index,
        p256_pubkey_hex: c.p256,
        role: c.role,
        aaguid: '0x',
        backup_eligible: false,
        backup_state: false,
      });
      node.handlers.tenzro_listGuardians = (() => ({
        threshold: 2,
        independent_roots: 2,
        members: [member(other, 0), member(card, 1)],
      })) as (params: never) => unknown;
      const approver = new PasskeyCustody({ rpc: node, authenticator: guardianDevice });
      await approver.approveRecovery(request);
      const opHash = recoveryOpHash({
        account: ACCOUNT,
        newPasskeyPublicKey: fromHex(request.newPasskeyPublicKeyHex),
        newCredentialId: fromHex(request.newCredentialIdHex),
        recoveryId: request.recoveryId,
        expiresAtMs: request.expiresAtMs,
      });
      const v: Vectors = {
        rp_id: auth.rpId,
        account: account.account,
        account_passkey_hex: toHex(auth.credentials[0]!.publicKey, true),
        enroll_request: rpc.paramsOf('tenzro_enrollPasskey')[0]!,
        guardian_card: card,
        other_guardian_card: other,
        add_guardian: {
          target_hex: toHex(target, true),
          nonce_hex: toHex(nonce, true),
          challenge_hex: toHex(
            custodyChallengeDigest(
              fromHex(account.account),
              String(challenge.operation),
              target,
              nonce,
            ),
            true,
          ),
          request: rpc.paramsOf('tenzro_addGuardian')[0]!,
        },
        recovery: {
          recovery_id: request.recoveryId,
          expires_at_ms: request.expiresAtMs,
          initiate_request: node.paramsOf('tenzro_initiateRecovery')[0]!,
          op_hash_hex: toHex(opHash, true),
          approval_challenge_hex: toHex(recoveryApprovalChallenge(opHash), true),
          guardian_index: 1,
          submit_request: node.paramsOf('tenzro_submitRecoverySignature')[0]!,
        },
      };
      fs.mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
      fs.writeFileSync(path, `${JSON.stringify(v, null, 2)}\n`);
    }
    const v = JSON.parse(fs.readFileSync(path, 'utf8')) as Vectors;
    const target = guardianTarget(v.guardian_card);
    expect(toHex(target, true)).toBe(v.add_guardian.target_hex);
    expect(
      toHex(
        custodyChallengeDigest(
          fromHex(v.account),
          'add_guardian',
          target,
          fromHex(v.add_guardian.nonce_hex),
        ),
        true,
      ),
    ).toBe(v.add_guardian.challenge_hex);
    const keys = [
      v.account_passkey_hex,
      v.guardian_card.p256,
      v.other_guardian_card.p256,
      String(v.recovery.initiate_request.new_passkey_public_key_hex),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(v.add_guardian.request.label).toBe(v.guardian_card.label);
    expect(v.add_guardian.request.guardian_p256_pubkey_hex).toBe(v.guardian_card.p256);
    const r = v.recovery;
    const opHash = recoveryOpHash({
      account: String(r.initiate_request.account_address),
      newPasskeyPublicKey: fromHex(String(r.initiate_request.new_passkey_public_key_hex)),
      newCredentialId: fromHex(String(r.initiate_request.new_credential_id_hex)),
      recoveryId: r.recovery_id,
      expiresAtMs: r.expires_at_ms,
    });
    expect(toHex(opHash, true)).toBe(r.op_hash_hex);
    expect(toHex(recoveryApprovalChallenge(opHash), true)).toBe(r.approval_challenge_hex);
    expect(r.submit_request.guardian_index).toBe(r.guardian_index);
  });

  it('round-trips a recovery request as text and refuses anything else', async () => {
    const rpc = recoveryNode();
    const { request } = await new PasskeyCustody({
      rpc,
      authenticator: new FakeAuthenticator(),
    }).startRecovery({
      account: ACCOUNT,
      label: 'New phone',
    });
    expect(decodeRecoveryRequest(encodeRecoveryRequest(request))).toEqual(request);
    expect(() => decodeRecoveryRequest('nope')).toThrow(PasskeyError);
  });

  it('refuses to approve with a passkey that is not a guardian', async () => {
    const rpc = recoveryNode();
    const recovering = new PasskeyCustody({ rpc, authenticator: new FakeAuthenticator() });
    const { request } = await recovering.startRecovery({ account: ACCOUNT, label: 'New phone' });
    const stranger = new FakeAuthenticator();
    await new PasskeyCustody({ rpc, authenticator: stranger }).createGuardian({
      label: 'X',
      source: 'own_passkey',
    });
    rpc.handlers.tenzro_listGuardians = (() => ({
      threshold: 1,
      independent_roots: 1,
      members: [
        {
          index: 0,
          p256_pubkey_hex: `0x${'05'.repeat(64)}`,
          role: 'device',
          aaguid: '0x',
          backup_eligible: false,
          backup_state: false,
        },
      ],
    })) as (params: never) => unknown;
    await expect(
      new PasskeyCustody({ rpc, authenticator: stranger }).approveRecovery(request),
    ).rejects.toBeInstanceOf(PasskeyError);
    expect(rpc.paramsOf('tenzro_submitRecoverySignature')).toHaveLength(0);
  });

  it('cancels a recovery with a passkey approval bound to that recovery', async () => {
    const { rpc, custody, account } = await enrolled();
    rpc.handlers.tenzro_cancelRecovery = ((p: { recovery_id: string }) => ({
      recovery_id: p.recovery_id,
      cancelled: true,
    })) as (params: never) => unknown;
    const r = await custody.cancelRecovery({
      account: account.account,
      recoveryId: 'abc123',
      approver: { id: account.credentialId },
    });
    expect(r.cancelled).toBe(true);
    const challenge = rpc.paramsOf('tenzro_createCustodyChallenge').at(-1);
    expect(challenge?.operation).toBe('cancel_recovery');
    expect(challenge?.target_hex).toBe(toHex(new TextEncoder().encode('abc123'), true));
    const [sent] = rpc.paramsOf('tenzro_cancelRecovery');
    expect((sent?.authorization as { credential_id_hex: string }).credential_id_hex).toBe(
      `0x${account.credentialId}`,
    );
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
  it('returns one bincode bundle signed over the userop context', async () => {
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
        scheme: 'webauthn-p256',
        address: ACCOUNT,
        credentialIds: [account.credentialId],
      },
      scheme: 'webauthn-p256',
      preimage: opHash,
    });
    expect(res.signatures).toHaveLength(1);
    const bundle = res.signatures[0]!;
    // Vec length prefix (u64 LE) = 1 entry, then the credential id.
    expect(toHex(bundle.slice(0, 8))).toBe('0100000000000000');
    const credLen = fromHex(account.credentialId).length;
    expect(toHex(bundle.slice(16, 16 + credLen))).toBe(account.credentialId);
    // No post-quantum leg: the entry ends with Option::None.
    expect(bundle.at(-1)).toBe(0);
    const expected = b64url(signingDigest(SignatureContext.UserOperation, opHash));
    expect(new TextDecoder().decode(bundle)).toContain(`"challenge":"${expected}"`);
  });

  it('refuses other schemes and non-32-byte preimages', async () => {
    const driver = passkeySigningDriver({ authenticator: new FakeAuthenticator() });
    const surfaceKey = {
      surface: 'tenzro-native' as const,
      scheme: 'webauthn-p256' as const,
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
        scheme: 'webauthn-p256',
        preimage: new Uint8Array(31),
      }),
    ).rejects.toBeInstanceOf(PasskeyError);
  });
});

describe('agents rooted in this identity', () => {
  const AGENT = 'did:tenzro:agent:example';

  async function rooted(controller?: string) {
    const env = await enrolled();
    const cred = env.auth.credentials[0]!;
    env.rpc.handlers.tenzro_getAccountRecord = () => ({
      record: {
        account_address: ACCOUNT,
        credentials: [
          {
            credential_id_hex: toHex(cred.id, true),
            p256_public_key_hex: toHex(cred.publicKey, true),
          },
        ],
      },
    });
    env.rpc.handlers.tenzro_getAgentTerms = () => ({
      agent_did: AGENT,
      root_kind: 'passkey',
      status: 'active',
      terms: { controller_did: controller ?? env.account.did },
    });
    return { ...env, cred };
  }

  function heldAction(amount = '501') {
    const action = {
      agent_did: AGENT,
      machine_did: 'did:tenzro:machine:serving-a',
      operation: 'transfer',
      counterparty: 'ab'.repeat(20),
      amount,
      chain: 'tenzro',
      nonce: 7,
    };
    const nonce = new Uint8Array(16).fill(5);
    const target = agentActionDigest(action);
    const account = agentWalletAccount(AGENT);
    const digest = custodyChallengeDigest(account, 'agent_step_up', target, nonce);
    return {
      action,
      digest,
      step_up: {
        controller_operation: 'agent_step_up',
        account: toHex(account),
        nonce: toHex(nonce),
        target: toHex(target),
        challenge_hex: toHex(digest),
        webauthn_challenge: webauthnChallenge(SignatureContext.AccountOwner, digest),
        action_nonce: 7,
      },
    };
  }

  it("approves a held action with the identity's passkey over the node's step-up digest", async () => {
    const { custody, account, cred } = await rooted();
    const { action, step_up, digest } = heldAction();
    const out = await custody.approveAgentStepUp(account, { action, step_up });
    expect(out.account).toBe(step_up.account);
    expect(out.nonce).toBe(step_up.nonce);
    expect(out.root_public_key).toBe(toHex(cred.publicKey));
    expect(out.signature.classical.form).toBe('web_authn');
    const client = JSON.parse(
      new TextDecoder().decode(fromHex(out.signature.classical.client_data_json)),
    );
    expect(client.challenge).toBe(webauthnChallenge(SignatureContext.AccountOwner, digest));
  });

  it('signs nothing when the action shown is not the one the challenge binds', async () => {
    const { custody, account, auth } = await rooted();
    const { step_up } = heldAction('501');
    const shown = heldAction('5').action;
    let asked = 0;
    const get = auth.get.bind(auth);
    auth.get = async (o) => {
      asked += 1;
      return get(o);
    };
    await expect(
      custody.approveAgentStepUp(account, { action: shown, step_up }),
    ).rejects.toBeInstanceOf(PasskeyError);
    expect(asked).toBe(0);
  });

  it('refuses an agent another identity roots', async () => {
    const { custody, account } = await rooted('did:tenzro:human:someone-else');
    const { action, step_up } = heldAction();
    await expect(custody.approveAgentStepUp(account, { action, step_up })).rejects.toThrow(
      /not rooted in this identity/,
    );
  });

  const terms = (controller: string) => ({
    controller_did: controller,
    agent_name: 'example',
    delegation_scope: { max_daily_spend: '5000' },
    serving_nodes: [
      { machine_did: 'did:tenzro:machine:serving-a', operator_did: 'did:tenzro:human:op' },
    ],
  });

  function termsChallenge(account: string, completed: ReturnType<typeof terms>) {
    const nonce = new Uint8Array(16).fill(9);
    const target = agentTermsTarget(completed);
    const digest = custodyChallengeDigest(fromHex(account), 'delegate_agent', target, nonce);
    return {
      challenge_id: 't1',
      challenge_hex: toHex(digest, true),
      nonce_hex: toHex(nonce, true),
      target_hex: toHex(target, true),
      expires_in_secs: 300,
      delegation: completed,
    };
  }

  it('approves the Terms the node completed with only serving-node keys added', async () => {
    const { custody, account, cred } = await rooted();
    const requested = terms(account.did);
    const completed = {
      ...requested,
      serving_nodes: [{ ...requested.serving_nodes[0]!, dpop_public_key: 'cd'.repeat(32) }],
    };
    const authorization = await custody.approveAgentTerms(account, {
      operation: 'delegate_agent',
      terms: requested,
      challenge: termsChallenge(account.account, completed),
    });
    expect(authorization.challenge_id).toBe('t1');
    expect(authorization.credential_id_hex).toBe(toHex(cred.id, true));
  });

  it('refuses Terms the node changed, or Terms for another controller', async () => {
    const { custody, account } = await rooted();
    const requested = terms(account.did);
    const widened = { ...requested, delegation_scope: { max_daily_spend: '9999' } };
    await expect(
      custody.approveAgentTerms(account, {
        operation: 'delegate_agent',
        terms: requested,
        challenge: termsChallenge(account.account, widened),
      }),
    ).rejects.toThrow(/differ/);
    const other = terms('did:tenzro:human:someone-else');
    await expect(
      custody.approveAgentTerms(account, {
        operation: 'delegate_agent',
        terms: other,
        challenge: termsChallenge(account.account, other),
      }),
    ).rejects.toThrow(/another controller/);
  });

  it("revokes with the identity's passkey on the identity's account", async () => {
    const { custody, account, rpc, cred } = await rooted();
    rpc.handlers.tenzro_revokeIdentity = (p: unknown) => p;
    await custody.revokeDelegatedAgent({ account, agentDid: AGENT });
    const req = rpc.paramsOf('tenzro_createCustodyChallenge').at(-1);
    expect(req?.operation).toBe('revoke_delegated_agent');
    expect(req?.account_address).toBe(ACCOUNT);
    const [revoke] = rpc.paramsOf('tenzro_revokeIdentity');
    expect(revoke?.did).toBe(AGENT);
    expect((revoke?.authorization as { credential_id_hex: string }).credential_id_hex).toBe(
      toHex(cred.id, true),
    );
  });
});
