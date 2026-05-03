/**
 * Pin the WebAuthnAuthenticatorAdapter wire shape against the WebAuthn
 * `navigator.credentials.get` API. No real authenticator — the
 * `CredentialsContainer` is captured so we can assert the request shape
 * each mode produces.
 *
 *   - PRF mode passes `prf.eval.first` salt + asks for user verification.
 *   - largeBlob mode passes `largeBlob: { read: true }`.
 *   - Escrow mode uses the server-issued nonce as the challenge.
 *   - All modes encode the credentialId allow-list entry as bytes,
 *     not as the base64url string.
 *   - The returned assertion is base64url-encoded buffers — what the
 *     `PasskeyAssertion` shape expects.
 */

import { describe, expect, it } from 'vitest';
import type {
  CredentialsContainer,
  PublicKeyCredentialLike,
  PublicKeyCredentialRequestOptionsLike,
} from './webauthn-adapter.ts';
import { WebAuthnAuthenticatorAdapter } from './webauthn-adapter.ts';

function bytesFromU8(u: Uint8Array): ArrayBuffer {
  // Vitest's jsdom polyfills sometimes lose ArrayBuffer typing; copy.
  const ab = new ArrayBuffer(u.byteLength);
  new Uint8Array(ab).set(u);
  return ab;
}

function makeCredentials(
  cred: PublicKeyCredentialLike,
): { creds: CredentialsContainer; lastOptions: { value?: PublicKeyCredentialRequestOptionsLike } } {
  const lastOptions: { value?: PublicKeyCredentialRequestOptionsLike } = {};
  return {
    lastOptions,
    creds: {
      async get(options) {
        lastOptions.value = options;
        return cred;
      },
    },
  };
}

const REQ = {
  // base64url 'cred-1' = 'Y3JlZC0x'
  credentialId: 'Y3JlZC0x',
  surfaceKeyId: 'tenzro-native#0',
  scheme: 'ed25519' as const,
};

describe('WebAuthnAuthenticatorAdapter.prfAssertion', () => {
  it('passes prf eval salt + UV required, returns prfOutput + assertion', async () => {
    const PRF_OUT = new Uint8Array(32).fill(0xaa);
    const cred: PublicKeyCredentialLike = {
      rawId: bytesFromU8(new Uint8Array([1, 2, 3])),
      response: {
        clientDataJSON: bytesFromU8(new Uint8Array([4])),
        authenticatorData: bytesFromU8(new Uint8Array([5, 5])),
        signature: bytesFromU8(new Uint8Array([6, 6, 6])),
      },
      getClientExtensionResults() {
        return { prf: { results: { first: bytesFromU8(PRF_OUT) } } };
      },
    };
    const { creds, lastOptions } = makeCredentials(cred);

    const adapter = new WebAuthnAuthenticatorAdapter({
      rpId: 'wallet.tenzro.test',
      credentials: creds,
      // Deterministic salt for assertion.
      prfSalt: () => new Uint8Array([0x42, 0x43]),
    });
    const r = await adapter.prfAssertion(REQ);

    expect(Array.from(r.prfOutput)).toEqual(Array.from(PRF_OUT));
    expect(r.assertion.credentialId).toBe('AQID'); // base64url of [1,2,3]

    const opts = lastOptions.value!;
    expect(opts.publicKey.rpId).toBe('wallet.tenzro.test');
    expect(opts.publicKey.userVerification).toBe('required');
    const salt = opts.publicKey.extensions?.prf?.eval.first as Uint8Array;
    expect(Array.from(salt)).toEqual([0x42, 0x43]);
    // allowCredentials uses the *bytes* of the base64url cred id.
    const allowed = opts.publicKey.allowCredentials?.[0]?.id as Uint8Array;
    // 'Y3JlZC0x' = 'cred-1' in base64url
    expect(new TextDecoder().decode(allowed)).toBe('cred-1');
  });

  it('throws if PRF result missing — caller falls back to escrow', async () => {
    const cred: PublicKeyCredentialLike = {
      rawId: bytesFromU8(new Uint8Array([1])),
      response: {
        clientDataJSON: bytesFromU8(new Uint8Array(0)),
        authenticatorData: bytesFromU8(new Uint8Array(0)),
        signature: bytesFromU8(new Uint8Array(0)),
      },
      getClientExtensionResults() {
        return {}; // no prf
      },
    };
    const { creds } = makeCredentials(cred);
    const adapter = new WebAuthnAuthenticatorAdapter({
      rpId: 'wallet.tenzro.test',
      credentials: creds,
      prfSalt: () => new Uint8Array(),
    });
    await expect(adapter.prfAssertion(REQ)).rejects.toThrow(/PRF unavailable/);
  });
});

describe('WebAuthnAuthenticatorAdapter.readLargeBlob', () => {
  it('asks for largeBlob.read and returns the blob bytes', async () => {
    const BLOB = new Uint8Array([7, 7, 7, 7]);
    const cred: PublicKeyCredentialLike = {
      rawId: bytesFromU8(new Uint8Array([1])),
      response: {
        clientDataJSON: bytesFromU8(new Uint8Array(0)),
        authenticatorData: bytesFromU8(new Uint8Array(0)),
        signature: bytesFromU8(new Uint8Array(0)),
      },
      getClientExtensionResults() {
        return { largeBlob: { blob: bytesFromU8(BLOB) } };
      },
    };
    const { creds, lastOptions } = makeCredentials(cred);
    const adapter = new WebAuthnAuthenticatorAdapter({
      rpId: 'wallet.tenzro.test',
      credentials: creds,
    });
    const r = await adapter.readLargeBlob(REQ);
    expect(Array.from(r.blob)).toEqual([7, 7, 7, 7]);
    expect(lastOptions.value?.publicKey.extensions?.largeBlob?.read).toBe(true);
  });

  it('throws when largeBlob blob is empty', async () => {
    const cred: PublicKeyCredentialLike = {
      rawId: bytesFromU8(new Uint8Array([1])),
      response: {
        clientDataJSON: bytesFromU8(new Uint8Array(0)),
        authenticatorData: bytesFromU8(new Uint8Array(0)),
        signature: bytesFromU8(new Uint8Array(0)),
      },
      getClientExtensionResults() {
        return {}; // no largeBlob
      },
    };
    const { creds } = makeCredentials(cred);
    const adapter = new WebAuthnAuthenticatorAdapter({
      rpId: 'wallet.tenzro.test',
      credentials: creds,
    });
    await expect(adapter.readLargeBlob(REQ)).rejects.toThrow(/largeBlob/);
  });
});

describe('WebAuthnAuthenticatorAdapter.basicAssertion', () => {
  it('uses server nonce as challenge, no extensions, returns base64url assertion', async () => {
    const cred: PublicKeyCredentialLike = {
      rawId: bytesFromU8(new Uint8Array([0x01, 0x02])),
      response: {
        clientDataJSON: bytesFromU8(new Uint8Array([0x10])),
        authenticatorData: bytesFromU8(new Uint8Array([0x20])),
        signature: bytesFromU8(new Uint8Array([0x30])),
      },
    };
    const { creds, lastOptions } = makeCredentials(cred);
    const adapter = new WebAuthnAuthenticatorAdapter({
      rpId: 'wallet.tenzro.test',
      credentials: creds,
    });

    const a = await adapter.basicAssertion({ ...REQ, nonce: 'bm9uY2U' /* 'nonce' */ });

    expect(a.credentialId).toBe('AQI'); // base64url [1,2]
    expect(a.clientDataJson).toBe('EA'); // base64url [0x10]
    expect(a.authenticatorData).toBe('IA');
    expect(a.signature).toBe('MA');

    const opts = lastOptions.value!;
    expect(opts.publicKey.extensions).toBeUndefined();
    const challenge = opts.publicKey.challenge as Uint8Array;
    expect(new TextDecoder().decode(challenge)).toBe('nonce');
  });
});

describe('WebAuthnAuthenticatorAdapter — environment guard', () => {
  it('throws if navigator.credentials missing and none injected', async () => {
    const adapter = new WebAuthnAuthenticatorAdapter({
      rpId: 'wallet.tenzro.test',
    });
    // jsdom may or may not surface navigator.credentials; if it does,
    // skip the assertion (the path we want to cover is "no creds at all").
    const hasNavCreds =
      typeof navigator !== 'undefined' &&
      (navigator as unknown as { credentials?: unknown }).credentials !== undefined;
    if (hasNavCreds) return;
    await expect(
      adapter.basicAssertion({ ...REQ, nonce: 'bm9uY2U' }),
    ).rejects.toThrow(/navigator\.credentials/);
  });
});
