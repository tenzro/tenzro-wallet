import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  ACCOUNT_OWNER_SIGNATURE_CONTEXT,
  COMPOSITE_LABEL_MLDSA65_P256,
  KeystoreClient,
  compositeMessageRepresentative,
  keystoreDigest,
  passkeyChallenge,
  webauthnChallengeOf,
} from 'tenzro-sdk';
import { describe, expect, it } from 'vitest';

import { PasskeySigner, createPasskey, keystoreCredential } from './passkey';
import { pqKeyFromPrf, prfSalt } from './pq';
import { SoftAuthenticator, scriptedRpc, verifies } from './testing';

const RP = 'wallet.example';

async function make(synced = false) {
  const api = new SoftAuthenticator(synced);
  const created = await createPasskey(
    { rpId: RP, rpName: 'Example', userName: 'alex', label: 'Laptop' },
    api,
  );
  return { api, created };
}

describe('passkey', () => {
  it('creates a passkey and reads its facts from the registration', async () => {
    const { created } = await make(true);
    expect(created.rpId).toBe(RP);
    expect(created.publicKey).toMatch(/^[0-9a-f]{128}$/);
    expect(created.credentialId).toMatch(/^[0-9a-f]{32}$/);
    expect(created.aaguid).toBe('aa'.repeat(16));
    expect(created.backupEligible).toBe(true);
    expect(created.backupState).toBe(true);
    const device = await make(false);
    expect(device.created.backupEligible).toBe(false);
  });

  it('records the provider domain on the keystore credential and leaves timing to the chain', async () => {
    const { created } = await make();
    const c = keystoreCredential(created);
    expect(c.rp_id).toBe(RP);
    expect(c.counts_as_root_from_ms).toBe(0);
    expect(c).not.toHaveProperty('added_at_ms');
  });

  it('signs the challenge the SDK derives, with a signature the key verifies', async () => {
    const { api, created } = await make();
    const signer = new PasskeySigner(created, api);
    const mPrime = await compositeMessageRepresentative(
      ACCOUNT_OWNER_SIGNATURE_CONTEXT,
      new Uint8Array(32).fill(7),
    );
    const [leg, pq] = await signer.signComposite(mPrime);
    // The post-quantum leg: ML-DSA-65 over mPrime, by the key the passkey's PRF derives.
    expect(pq).not.toBeNull();
    expect(pq!.length).toBe(3309);
    const again = (await api.get({
      publicKey: {
        challenge: new Uint8Array(32),
        rpId: RP,
        extensions: { prf: { eval: { first: prfSalt() } } },
      } as unknown as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential;
    const prf = (
      again.getClientExtensionResults() as unknown as { prf: { results: { first: ArrayBuffer } } }
    ).prf.results.first;
    const key = await pqKeyFromPrf(new Uint8Array(prf));
    expect(
      ml_dsa65.verify(pq!, mPrime, key.publicKey, { context: COMPOSITE_LABEL_MLDSA65_P256 }),
    ).toBe(true);
    const a = api.assertions[0]!;
    expect(a.challenge).toBe(await webauthnChallengeOf(mPrime));
    expect(a.credentialId).toBe(created.credentialId);
    expect(await verifies(created.publicKey, a)).toBe(true);
    expect(leg.signature).toEqual(a.signature);
  });

  it('refuses to make an account from a passkey that cannot derive the post-quantum key', async () => {
    const api = new SoftAuthenticator(false, false);
    const created = await createPasskey(
      { rpId: RP, rpName: 'Wallet', userName: 'a', label: 'L' },
      api,
    );
    const signer = new PasskeySigner({ ...created, pqPublicKey: 'ab'.repeat(1952) }, api);
    await expect(signer.signComposite(new Uint8Array(32))).rejects.toThrow(/key derivation/);
  });

  it('approves a keystore change over the digest every SDK computes', async () => {
    const { api, created } = await make();
    const signer = new PasskeySigner(created, api);
    const { rpc } = scriptedRpc({});
    const update = {
      chain_id: 13380,
      account: `0x${'11'.repeat(20)}`,
      anchor: null,
      previous_commitment: `0x${'22'.repeat(32)}`,
      op: 'cancel_recovery' as const,
      approvals: [],
      possession: null,
    };
    const approved = await new KeystoreClient(rpc).approve(update, signer);
    expect(approved.approvals).toHaveLength(1);
    expect(approved.approvals[0]!.public_key).toBe(created.publicKey);
    expect(approved.approvals[0]!.signature.classical.form).toBe('web_authn');
    const digest = await keystoreDigest(
      update.chain_id,
      update.account,
      update.previous_commitment,
      update.op,
    );
    expect(api.assertions[0]!.challenge).toBe(await passkeyChallenge(digest));
  });

  it('answers a custody challenge in the node form', async () => {
    const { api, created } = await make();
    const signer = new PasskeySigner(created, api);
    const challenge = 'q2Fa7Pp5rL0x9mDkS3uVw1cHq2Fa7Pp5rL0x9mDkS3s';
    const json = await signer.assertChallenge(challenge);
    expect(api.assertions[0]!.challenge).toBe(challenge);
    expect(Array.isArray(json.authenticator_data)).toBe(true);
    expect(Array.isArray(json.client_data_json)).toBe(true);
    expect(Array.isArray(json.signature)).toBe(true);
  });
});
