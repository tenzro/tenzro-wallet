/**
 * Ownership proofs and further wallets, against the mocked node and the
 * in-memory authenticator used by custody.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { fromHex, toHex } from './bytes.ts';
import { PasskeyCustody } from './custody.ts';
import { recoverAssertionPublicKeys, smartAccountAddress } from './derive.ts';
import { FakeAuthenticator } from './fake-authenticator.fixture.ts';
import { network } from './keystore-network.fixture.ts';
import { PasskeyError } from './webauthn.ts';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function setup() {
  const net = network();
  const authenticator = new FakeAuthenticator();
  return {
    net,
    rpc: net.rpc,
    authenticator,
    custody: new PasskeyCustody({ rpc: net.rpc, authenticator, sender: net.sender }),
  };
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
    const { custody, rpc, authenticator } = setup();
    const account = await custody.createWallet({ displayName: 'Ada' });
    const added = await custody.addWallet(account, { salt: 1 });

    const first = authenticator.credentials[0]!;
    expect(added.account).toBe(`0x${toHex(smartAccountAddress(first.publicKey, first.id, 1))}`);
    expect(added.did).toBe(account.did);
    expect(added.salt).toBe(1);

    const enrols = rpc.paramsOf('tenzro_enrollPasskey');
    const last = enrols[enrols.length - 1] as Record<string, unknown>;
    expect(last.salt).toBe(1);
    expect(last.authorization).toBeDefined();
    expect(last.passkey_public_key_hex).toBe(enrols[0]?.passkey_public_key_hex);

    // The enrolment challenge is keyed to the passkey and bound to its credential.
    const challenges = rpc.paramsOf('tenzro_createCustodyChallenge');
    const c = challenges[challenges.length - 1] as Record<string, string>;
    expect(c.operation).toBe('enroll_passkey');
    expect(c.account_address).toBe(last.passkey_public_key_hex);
    expect(c.target_hex).toBe(last.credential_id_hex);
  });

  it('refuses salt 0 and an identity whose first passkey the account does not hold', async () => {
    const a = setup();
    const account = await a.custody.createWallet({ displayName: 'Ada' });
    await expect(a.custody.addWallet(account, { salt: 0 })).rejects.toBeInstanceOf(PasskeyError);
    await expect(
      a.custody.addWallet({ ...account, did: 'did:tenzro:human:other' }, { salt: 1 }),
    ).rejects.toMatchObject({ kind: 'not-found' });
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

  it('creates with three approvals: create, enrol, proof', async () => {
    const { custody, authenticator } = setup();
    const seen = counted(authenticator);
    const account = await custody.createWallet({ displayName: 'Ada', challenge: code });
    expect(seen.map((s) => s.kind)).toEqual(['create', 'get', 'get']);
    expect(account.proof?.account).toBe(account.account);
    provesFor(account.proof!, code, authenticator);
  });

  it('asks no approval for a proof nobody requested', async () => {
    const { custody, authenticator } = setup();
    const seen = counted(authenticator);
    const account = await custody.createWallet({ displayName: 'Ada' });
    expect(seen.map((s) => s.kind)).toEqual(['create', 'get']);
    expect(account.proof).toBeUndefined();
  });

  it('signs in and proves with one approval once the keystore is on chain', async () => {
    const { custody, authenticator } = setup();
    const account = await custody.createWallet({ displayName: 'Ada' });
    await custody.linkDevice({ account, label: 'Key', approver: { id: account.credentialId } });
    authenticator.preferred = account.credentialId;
    const seen = counted(authenticator);
    const found = await custody.signIn({ challenge: code });
    expect(seen).toHaveLength(1);
    expect(found.proof?.account).toBe(account.account);
    provesFor(found.proof!, code, authenticator);
  });

  it('passes the phone hint to every approval of the flow', async () => {
    const { custody, authenticator } = setup();
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
  it('asks the phone to create over QR, the phone to prove it, and this device to send', async () => {
    const { custody, authenticator: auth, net } = setup();
    const first = await custody.createWallet({ displayName: 'Ada' });
    const seen = counted(auth);
    const allowSeen: string[][] = [];
    const get = auth.get.bind(auth);
    auth.get = async (o) => {
      allowSeen.push((o.allow ?? []).map((c) => c.id));
      return get(o);
    };
    await custody.linkDevice({
      account: first,
      label: 'Phone',
      crossPlatform: true,
      hints: ['hybrid'],
      approver: { id: first.credentialId },
    });
    expect(seen.map((s) => s.kind)).toEqual(['create', 'get', 'get']);
    expect(seen[0]?.hints).toEqual(['hybrid']);
    expect(allowSeen[0]).toEqual([toHex(auth.credentials[1]!.id)]);
    expect(allowSeen[1]).toEqual([first.credentialId]);
    expect(toHex(net.sent[0]!.key)).toBe(toHex(auth.credentials[0]!.publicKey));
  });
});
