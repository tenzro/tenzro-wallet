import { describe, expect, it } from 'vitest';

import { authorize, createAccount, sameAccount, signIn } from './account';
import { SoftAuthenticator, scriptedRpc, verifies } from './testing';

const RP = 'wallet.example';
const ACCOUNT = `0x${'ab'.repeat(20)}`;
const CHALLENGE = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';

function node(account = ACCOUNT) {
  const enrolled: Record<string, unknown>[] = [];
  const { rpc, calls } = scriptedRpc({
    tenzro_createCustodyChallenge: () => ({ challenge_id: 'c1', webauthn_challenge: CHALLENGE }),
    tenzro_enrollPasskey: (p) => {
      enrolled.push(p as Record<string, unknown>);
      const q = p as { passkey_public_key_hex: string; credential_id_hex: string };
      return {
        did: 'did:tenzro:human:alex',
        smart_account_address: account,
        credential_id_hex: q.credential_id_hex,
        anchor: {
          rp_id: RP,
          credential_id: q.credential_id_hex.slice(2),
          public_key: q.passkey_public_key_hex.slice(2),
          aaguid: 'aa'.repeat(16),
          backup_eligible: false,
          backup_state: false,
          salt: 0,
        },
      };
    },
    tenzro_getKeystore: (p) => ({ account: (p as { account: string }).account, on_chain: false }),
  });
  return { rpc, calls, enrolled };
}

function second(account: string) {
  return scriptedRpc({ tenzro_getKeystore: () => ({ account, on_chain: false }) }).rpc;
}

describe('account', () => {
  it('creates an account from one passkey, proven to the node', async () => {
    const api = new SoftAuthenticator();
    const { rpc, calls, enrolled } = node();
    const w = await createAccount(rpc, second(ACCOUNT), {
      rpId: RP,
      rpName: 'Example',
      name: 'Alex',
      deviceLabel: 'Laptop',
      api,
    });
    expect(w.account).toBe(ACCOUNT);
    expect(w.did).toBe('did:tenzro:human:alex');
    expect(w.anchor?.public_key).toBe(w.passkey.publicKey);
    expect(w.passkey).not.toHaveProperty('registrationAuthenticatorData');
    const challenge = calls.find((c) => c.method === 'tenzro_createCustodyChallenge')!.params as {
      operation: string;
      target_hex: string;
    };
    expect(challenge.operation).toBe('enroll_passkey');
    expect(challenge.target_hex).toBe(`0x${w.passkey.credentialId}`);
    const e = enrolled[0]!;
    expect(e.rp_id).toBe(RP);
    expect(e.registration_authenticator_data_hex).toMatch(/^0x[0-9a-f]+$/);
    expect(api.assertions[0]!.challenge).toBe(CHALLENGE);
    expect(await verifies(w.passkey.publicKey, api.assertions[0]!)).toBe(true);
  });

  it('refuses an account a second node does not derive from the same passkey', async () => {
    const api = new SoftAuthenticator();
    const { rpc } = node();
    await expect(
      createAccount(rpc, second(`0x${'cd'.repeat(20)}`), {
        rpId: RP,
        rpName: 'Example',
        name: 'Alex',
        deviceLabel: 'Laptop',
        api,
      }),
    ).rejects.toThrow(/different accounts/);
  });

  it('signs in from any passkey the account links, through the network', async () => {
    const api = new SoftAuthenticator();
    const { rpc: creator } = node();
    const made = await createAccount(creator, null, {
      rpId: RP,
      rpName: 'Example',
      name: 'Alex',
      deviceLabel: 'Laptop',
      api,
    });
    const { rpc } = scriptedRpc({
      tenzro_resolveCredential: (p) => {
        expect(p).toEqual({ credential_id: made.passkey.credentialId, rp_id: RP });
        return { accounts: [ACCOUNT] };
      },
      tenzro_getKeystore: () => ({
        account: ACCOUNT,
        on_chain: true,
        keystore: {
          owner_did: 'did:tenzro:human:alex',
          credentials: [
            {
              rp_id: RP,
              credential_id: made.passkey.credentialId,
              public_key: made.passkey.publicKey,
              aaguid: made.passkey.aaguid,
              backup_eligible: false,
              backup_state: false,
              counts_as_root_from_ms: 0,
              label: 'Laptop',
            },
          ],
        },
      }),
    });
    const w = await signIn(rpc, RP, api);
    expect(w.account).toBe(ACCOUNT);
    expect(w.passkey.publicKey).toBe(made.passkey.publicKey);
    expect(w.anchor).toBeNull();
  });

  it('carries the anchor in custody authorizations until the keystore is on chain', async () => {
    const api = new SoftAuthenticator();
    const { rpc } = node();
    const w = await createAccount(rpc, null, {
      rpId: RP,
      rpName: 'Example',
      name: 'Alex',
      deviceLabel: 'Laptop',
      api,
    });
    const { PasskeySigner } = await import('./passkey');
    const auth = await authorize(
      w,
      { challenge_id: 'c2', webauthn_challenge: CHALLENGE },
      new PasskeySigner(w.passkey, api),
    );
    expect(auth.credential_id_hex).toBe(`0x${w.passkey.credentialId}`);
    expect(auth).toHaveProperty('anchor');
    const settled = await authorize(
      { ...w, anchor: null },
      { challenge_id: 'c3', webauthn_challenge: CHALLENGE },
      new PasskeySigner(w.passkey, api),
    );
    expect(settled).not.toHaveProperty('anchor');
  });

  it('compares 20-byte accounts with their 32-byte ledger slots', () => {
    expect(sameAccount(ACCOUNT, `${ACCOUNT}${'00'.repeat(12)}`)).toBe(true);
    expect(sameAccount(ACCOUNT, `0x${'cd'.repeat(20)}`)).toBe(false);
  });
});
