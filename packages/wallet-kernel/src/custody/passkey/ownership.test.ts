/**
 * Ownership proofs and further wallets, against the mocked node and the
 * in-memory authenticator used by custody.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { fromHex, toHex } from './bytes.ts';
import { PasskeyCustody } from './custody.ts';
import { deriveCustodyKey, humanDidFromPasskey, recoverAssertionPublicKeys } from './derive.ts';
import { FakeAuthenticator, MockRpc, challengeDigest } from './fake-authenticator.fixture.ts';
import { PasskeyError } from './webauthn.ts';

const FIRST = '0x00000000000000000000000000000000000a11ce';
const SECOND = '0x00000000000000000000000000000000000b0b00';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function setup(recordCredentials?: () => unknown[]) {
  let n = 0;
  let firstXy = '';
  let firstCred = '';
  const rpc = new MockRpc({
    tenzro_createCustodyChallenge: () => {
      n += 1;
      return { challenge_id: `c${n}`, challenge_hex: challengeDigest(n), expires_in_secs: 300 };
    },
    tenzro_enrollPasskey: (p: {
      passkey_public_key_hex: string;
      credential_id_hex: string;
      salt: number;
    }) => {
      if (!firstXy) {
        firstXy = p.passkey_public_key_hex;
        firstCred = p.credential_id_hex;
      }
      return {
        did: humanDidFromPasskey(fromHex(p.passkey_public_key_hex)),
        smart_account_address: p.salt === 0 ? FIRST : SECOND,
        credential_id_hex: p.credential_id_hex,
        webauthn_validator_address: '0x0000000000000000000000000000000000001020',
        installed_validators: ['webauthn'],
      };
    },
    tenzro_getAccountRecord: () => ({
      record: {
        account_address: FIRST,
        credentials: recordCredentials
          ? recordCredentials()
          : [{ credential_id_hex: firstCred, p256_public_key_hex: firstXy }],
      },
    }),
  });
  const authenticator = new FakeAuthenticator();
  return { rpc, authenticator, custody: new PasskeyCustody({ rpc, authenticator }) };
}

describe('ownership proof', () => {
  it("signs the relying party's code with the passkey the account holds", async () => {
    const { custody, authenticator } = setup();
    const account = await custody.createWallet({ displayName: 'Ada' });
    const code = new Uint8Array(32).fill(7);
    const proof = await custody.proveOwnership(account, code);

    expect(proof.account).toBe(account.account);
    expect(proof.credentialIdHex).toBe(account.credentialId);
    const clientData = JSON.parse(new TextDecoder().decode(fromHex(proof.clientDataJsonHex)));
    expect(clientData.type).toBe('webauthn.get');
    expect(clientData.challenge).toBe(b64url(code));

    // The signature is valid for the passkey's own key.
    const candidates = recoverAssertionPublicKeys(
      fromHex(proof.authenticatorDataHex),
      fromHex(proof.clientDataJsonHex),
      fromHex(proof.signatureHex),
    ).map((xy) => toHex(xy));
    const cred = authenticator.credential(account.credentialId);
    expect(cred).toBeDefined();
    expect(candidates).toContain(toHex(cred?.publicKey ?? new Uint8Array()));
  });

  it('refuses a code too short to be single-use', async () => {
    const { custody } = setup();
    const account = await custody.createWallet({ displayName: 'Ada' });
    await expect(custody.proveOwnership(account, new Uint8Array(8))).rejects.toBeInstanceOf(
      PasskeyError,
    );
  });
});

describe('addWallet', () => {
  it('enrols the first passkey again with the next salt, approved by that passkey', async () => {
    const { custody, rpc } = setup();
    const account = await custody.createWallet({ displayName: 'Ada' });
    const added = await custody.addWallet(account, { salt: 1 });

    expect(added.account).toBe(SECOND);
    expect(added.did).toBe(account.did);
    expect(added.salt).toBe(1);

    const enrols = rpc.paramsOf('tenzro_enrollPasskey');
    const last = enrols[enrols.length - 1] as Record<string, unknown>;
    expect(last.salt).toBe(1);
    expect(last.authorization).toBeDefined();
    expect(last.passkey_public_key_hex).toBe(enrols[0]?.passkey_public_key_hex);

    // The enrolment challenge is keyed to the passkey and bound to its credential and ML-DSA key.
    const challenges = rpc.paramsOf('tenzro_createCustodyChallenge');
    const c = challenges[challenges.length - 1] as Record<string, string>;
    expect(c.operation).toBe('enroll_passkey');
    expect(c.account_address).toBe(last.passkey_public_key_hex);
    expect(String(c.target_hex).replace(/^0x/, '')).toBe(
      String(last.credential_id_hex).replace(/^0x/, '') +
        String(last.ml_dsa_public_key_hex).replace(/^0x/, ''),
    );
  });

  it('refuses salt 0 and an account whose record does not show the first passkey', async () => {
    const a = setup();
    const account = await a.custody.createWallet({ displayName: 'Ada' });
    await expect(a.custody.addWallet(account, { salt: 0 })).rejects.toBeInstanceOf(PasskeyError);

    const b = setup(() => []);
    const other = await b.custody.createWallet({ displayName: 'Ada' });
    await expect(b.custody.addWallet(other, { salt: 1 })).rejects.toMatchObject({
      kind: 'not-found',
    });
  });
});

/** Counts the approvals a flow asks for, and remembers the options of each. */
function counted(authenticator: FakeAuthenticator) {
  const seen: Array<{ kind: 'create' | 'get'; hints?: readonly string[] }> = [];
  const create = authenticator.create.bind(authenticator);
  const get = authenticator.get.bind(authenticator);
  authenticator.create = async (o) => {
    seen.push({ kind: 'create', ...(o.hints ? { hints: o.hints } : {}) });
    return create(o);
  };
  authenticator.get = async (o) => {
    seen.push({ kind: 'get', ...(o.hints ? { hints: o.hints } : {}) });
    return get(o);
  };
  return seen;
}

function provesFor(
  proof: {
    credentialIdHex: string;
    authenticatorDataHex: string;
    clientDataJsonHex: string;
    signatureHex: string;
  },
  code: Uint8Array,
  authenticator: FakeAuthenticator,
) {
  const clientData = JSON.parse(new TextDecoder().decode(fromHex(proof.clientDataJsonHex)));
  expect(clientData.challenge).toBe(b64url(code));
  const candidates = recoverAssertionPublicKeys(
    fromHex(proof.authenticatorDataHex),
    fromHex(proof.clientDataJsonHex),
    fromHex(proof.signatureHex),
  ).map((xy) => toHex(xy));
  const cred = authenticator.credential(proof.credentialIdHex);
  expect(candidates).toContain(toHex(cred?.publicKey ?? new Uint8Array()));
}

describe('connecting a site while creating or signing in', () => {
  const code = new Uint8Array(32).fill(9);

  it('creates with three approvals, the PRF read doubling as the proof', async () => {
    const { custody, authenticator } = setup();
    authenticator.returnPrfOnCreate = false;
    const seen = counted(authenticator);
    const account = await custody.createWallet({ displayName: 'Ada', challenge: code });
    expect(seen.map((s) => s.kind)).toEqual(['create', 'get', 'get']);
    expect(account.proof?.account).toBe(account.account);
    provesFor(account.proof!, code, authenticator);
  });

  it('creates with three approvals when the PRF came at creation', async () => {
    const { custody, authenticator } = setup();
    const seen = counted(authenticator);
    const account = await custody.createWallet({ displayName: 'Ada', challenge: code });
    expect(seen.map((s) => s.kind)).toEqual(['create', 'get', 'get']);
    provesFor(account.proof!, code, authenticator);
  });

  it('asks no approval for a proof nobody requested', async () => {
    const { custody, authenticator } = setup();
    const seen = counted(authenticator);
    const account = await custody.createWallet({ displayName: 'Ada' });
    expect(seen.map((s) => s.kind)).toEqual(['create', 'get']);
    expect(account.proof).toBeUndefined();
  });

  it('signs in and proves with one approval', async () => {
    const { custody, authenticator, rpc } = setup();
    await custody.createWallet({ displayName: 'Ada' });
    const did = humanDidFromPasskey(authenticator.credentials[0]!.publicKey);
    rpc.handlers.tenzro_resolveIdentity = (() => ({
      did,
      metadata: { smart_account_address: FIRST },
    })) as (params: never) => unknown;
    const seen = counted(authenticator);
    const found = await custody.signIn({ challenge: code });
    expect(seen).toHaveLength(1);
    expect(found.proof?.account).toBe(FIRST);
    provesFor(found.proof!, code, authenticator);
  });

  it('passes the phone hint to every approval of the flow', async () => {
    const { custody, authenticator } = setup();
    authenticator.returnPrfOnCreate = false;
    const seen = counted(authenticator);
    await custody.createWallet({ displayName: 'Ada', challenge: code, hints: ['hybrid'] });
    expect(seen.every((s) => s.hints?.[0] === 'hybrid')).toBe(true);
  });

  it('refuses a code too short to be single-use before any approval', async () => {
    const { custody, authenticator } = setup();
    const seen = counted(authenticator);
    await expect(custody.signIn({ challenge: new Uint8Array(8) })).rejects.toBeInstanceOf(
      PasskeyError,
    );
    expect(seen).toHaveLength(0);
  });
});

describe('linking a phone from the first device', () => {
  it('asks the phone to create over QR and this device to approve', async () => {
    const auth = new FakeAuthenticator();
    const ids: string[] = [];
    let n = 0;
    const rpc = new MockRpc({
      tenzro_createCustodyChallenge: () => {
        n += 1;
        return { challenge_id: `c${n}`, challenge_hex: challengeDigest(n), expires_in_secs: 300 };
      },
      tenzro_enrollPasskey: (p: { passkey_public_key_hex: string; credential_id_hex: string }) => {
        ids.push(p.credential_id_hex.replace(/^0x/, ''));
        return {
          did: humanDidFromPasskey(fromHex(p.passkey_public_key_hex)),
          smart_account_address: FIRST,
        };
      },
      tenzro_listPasskeys: () => ({ credential_ids: ids }),
      tenzro_addPasskey: (p: { new_credential_id_hex: string }) => ({
        account_address: FIRST,
        credential_id_hex: p.new_credential_id_hex,
        credentials_total: 2,
      }),
    });
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    const first = await custody.createWallet({ displayName: 'Ada' });
    auth.preferred = first.credentialId;
    const seen = counted(auth);
    await custody.linkDevice({
      account: FIRST,
      label: 'Phone',
      crossPlatform: true,
      hints: ['hybrid'],
      approver: { id: first.credentialId },
    });
    // Create on the phone, this device approves, then the phone signs its own
    // addition so the network can check what it claims about syncing.
    expect(seen).toEqual([
      { kind: 'create', hints: ['hybrid'] },
      { kind: 'get' },
      { kind: 'get', hints: ['hybrid'] },
    ]);
    const [added] = rpc.paramsOf('tenzro_addPasskey') as Array<{
      authorization: { credential_id_hex: string };
      new_pq_verifying_key_hex: string;
    }>;
    expect(added?.authorization.credential_id_hex.replace(/^0x/, '')).toBe(first.credentialId);
    // The phone's own post-quantum key, derived from its PRF, goes with it.
    const phone = auth.credentials[1]!;
    const phonePrf = (
      await auth.get({ challenge: new Uint8Array(32), allow: [{ id: toHex(phone.id) }] })
    ).prf!;
    expect(added?.new_pq_verifying_key_hex).toBe(toHex(deriveCustodyKey(phonePrf).publicKey, true));
  });

  it('reads the new device PRF on that device before this one approves, when create did not return it', async () => {
    const auth = new FakeAuthenticator();
    const ids: string[] = [];
    let n = 0;
    const rpc = new MockRpc({
      tenzro_createCustodyChallenge: () => {
        n += 1;
        return { challenge_id: `c${n}`, challenge_hex: challengeDigest(n), expires_in_secs: 300 };
      },
      tenzro_enrollPasskey: (p: { passkey_public_key_hex: string; credential_id_hex: string }) => {
        ids.push(p.credential_id_hex.replace(/^0x/, ''));
        return {
          did: humanDidFromPasskey(fromHex(p.passkey_public_key_hex)),
          smart_account_address: FIRST,
        };
      },
      tenzro_listPasskeys: () => ({ credential_ids: ids }),
      tenzro_addPasskey: (p: { new_credential_id_hex: string }) => ({
        account_address: FIRST,
        credential_id_hex: p.new_credential_id_hex,
        credentials_total: 2,
      }),
    });
    const custody = new PasskeyCustody({ rpc, authenticator: auth });
    const first = await custody.createWallet({ displayName: 'Ada' });
    auth.returnPrfOnCreate = false;
    const seen = counted(auth);
    const allowSeen: string[][] = [];
    const get = auth.get.bind(auth);
    auth.get = async (o) => {
      allowSeen.push((o.allow ?? []).map((c) => c.id));
      return get(o);
    };
    await custody.linkDevice({
      account: FIRST,
      label: 'Phone',
      crossPlatform: true,
      hints: ['hybrid'],
      approver: { id: first.credentialId },
    });
    // PRF read on the new device, approval here, then the new device signs its
    // own addition.
    expect(seen.map((s) => s.kind)).toEqual(['create', 'get', 'get', 'get']);
    expect(allowSeen[0]).toEqual([toHex(auth.credentials[1]!.id)]);
    expect(allowSeen[1]).toEqual([first.credentialId]);
    expect(allowSeen[2]).toEqual([toHex(auth.credentials[1]!.id)]);
  });
});
