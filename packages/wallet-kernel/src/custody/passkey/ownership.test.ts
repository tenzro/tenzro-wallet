/**
 * Ownership proofs and further wallets, against the mocked node and the
 * in-memory authenticator used by custody.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { fromHex, toHex } from './bytes.ts';
import { PasskeyCustody } from './custody.ts';
import { humanDidFromPasskey, recoverAssertionPublicKeys } from './derive.ts';
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
