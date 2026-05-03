/**
 * WebAuthnAuthenticatorAdapter — browser implementation of the
 * `PasskeyAuthenticatorAdapter` port. Wraps `navigator.credentials.get`
 * for the three modes the unwrapper consumes:
 *
 *   1. PRF (preferred). CTAP2.1 hmac-secret exposed through the WebAuthn
 *      `prf` extension. Authenticator returns a 32-byte symmetric key
 *      via `clientExtensionResults.prf.results.first` that the
 *      unwrapper uses to AEAD-decrypt the wrapped FROST share.
 *
 *      `prf.eval.first` is set to a stable per-surface salt so the
 *      authenticator-derived key is bound to a specific surface key.
 *      Per WebAuthn L3 §10.1.4, the salt is hashed inside the
 *      authenticator with a domain-separation prefix, so we don't
 *      pre-hash here.
 *
 *   2. largeBlob. Read-mode call with `largeBlob: { read: true }`.
 *      Returns the wrapped share blob. We don't write to largeBlob
 *      here — that happens at provisioning time.
 *
 *   3. Basic assertion (escrow fallback). No extensions. The challenge
 *      is the Tenzro-issued nonce so the assertion is replay-bound.
 *
 * All three paths surface the assertion in the same shape the
 * `PasskeyAssertion` port expects (base64url strings — that's what the
 * native browser API hands us already; we just rewrap the buffers).
 *
 * Browser-only. Importing this file in a Node environment is a host
 * configuration mistake — the kernel itself never imports it. Keep all
 * `navigator` access behind methods so the module file itself is safe
 * to import for tree-shaking.
 */

import type {
  PasskeyAssertion,
  PasskeyAuthenticatorAdapter,
  ShareUnwrapRequest,
} from './unwrapper.ts';

export interface WebAuthnAdapterConfig {
  /** Relying-party id (`rp.id`) — usually the wallet's apex domain. */
  readonly rpId: string;
  /**
   * Resolves the salt fed to the PRF extension for a given surface key.
   * Default: SHA-256 of `surfaceKeyId` UTF-8 bytes. Hosts wanting a
   * versioned/rotation-safe scheme can override.
   */
  readonly prfSalt?: (req: ShareUnwrapRequest) => Promise<Uint8Array> | Uint8Array;
  /**
   * Override `navigator.credentials` for tests. In production, leave
   * unset — the adapter reads `globalThis.navigator.credentials`.
   */
  readonly credentials?: CredentialsContainer;
}

/**
 * Subset of `CredentialsContainer` we exercise. Mirrors the lib.dom
 * shape so passing the real `navigator.credentials` works directly.
 */
export interface CredentialsContainer {
  get(options: PublicKeyCredentialRequestOptionsLike): Promise<PublicKeyCredentialLike | null>;
}

/** Subset of `CredentialRequestOptions` we set. */
export interface PublicKeyCredentialRequestOptionsLike {
  publicKey: {
    challenge: ArrayBuffer | Uint8Array;
    rpId: string;
    allowCredentials?: ReadonlyArray<{
      id: ArrayBuffer | Uint8Array;
      type: 'public-key';
    }>;
    userVerification?: 'required' | 'preferred' | 'discouraged';
    extensions?: {
      prf?: { eval: { first: ArrayBuffer | Uint8Array } };
      largeBlob?: { read?: boolean };
    };
  };
}

/** Subset of `PublicKeyCredential` + `AuthenticatorAssertionResponse` shape. */
export interface PublicKeyCredentialLike {
  rawId: ArrayBuffer;
  response: {
    clientDataJSON: ArrayBuffer;
    authenticatorData: ArrayBuffer;
    signature: ArrayBuffer;
  };
  getClientExtensionResults?(): {
    prf?: { results?: { first?: ArrayBuffer } };
    largeBlob?: { blob?: ArrayBuffer };
  };
}

export class WebAuthnAuthenticatorAdapter implements PasskeyAuthenticatorAdapter {
  readonly #cfg: WebAuthnAdapterConfig;

  constructor(cfg: WebAuthnAdapterConfig) {
    this.#cfg = cfg;
  }

  async prfAssertion(req: ShareUnwrapRequest): Promise<{
    prfOutput: Uint8Array;
    assertion: PasskeyAssertion;
  }> {
    const salt = await this.#prfSalt(req);
    // PRF binds to an authenticator-derived hmac key, so the WebAuthn
    // challenge itself is independent of the salt. Use 32 random bytes
    // to keep the assertion fresh; the unwrapper wraps the round in a
    // server-issued envelope fetch so replay is bounded there.
    const challenge = randomBytes(32);
    const cred = await this.#get({
      publicKey: {
        challenge,
        rpId: this.#cfg.rpId,
        allowCredentials: [
          { id: base64UrlDecode(req.credentialId), type: 'public-key' },
        ],
        userVerification: 'required',
        extensions: { prf: { eval: { first: salt } } },
      },
    });
    const ext = cred.getClientExtensionResults?.();
    const first = ext?.prf?.results?.first;
    if (!first) {
      throw new Error(
        'WebAuthn PRF unavailable on this credential — caller must fall back to escrow',
      );
    }
    return {
      prfOutput: new Uint8Array(first),
      assertion: toAssertion(cred),
    };
  }

  async readLargeBlob(req: ShareUnwrapRequest): Promise<{
    blob: Uint8Array;
    assertion: PasskeyAssertion;
  }> {
    const cred = await this.#get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: this.#cfg.rpId,
        allowCredentials: [
          { id: base64UrlDecode(req.credentialId), type: 'public-key' },
        ],
        userVerification: 'required',
        extensions: { largeBlob: { read: true } },
      },
    });
    const ext = cred.getClientExtensionResults?.();
    const blob = ext?.largeBlob?.blob;
    if (!blob) {
      throw new Error(
        'WebAuthn largeBlob read returned empty — caller must fall back to escrow',
      );
    }
    return { blob: new Uint8Array(blob), assertion: toAssertion(cred) };
  }

  async basicAssertion(
    req: ShareUnwrapRequest & { readonly nonce: string },
  ): Promise<PasskeyAssertion> {
    // Escrow path: server-issued nonce becomes the WebAuthn challenge,
    // so the resulting signature is replay-bound to that nonce.
    const cred = await this.#get({
      publicKey: {
        challenge: base64UrlDecode(req.nonce),
        rpId: this.#cfg.rpId,
        allowCredentials: [
          { id: base64UrlDecode(req.credentialId), type: 'public-key' },
        ],
        userVerification: 'required',
      },
    });
    return toAssertion(cred);
  }

  // --- internals ---

  async #get(
    options: PublicKeyCredentialRequestOptionsLike,
  ): Promise<PublicKeyCredentialLike> {
    const creds =
      this.#cfg.credentials ??
      (globalThis as unknown as { navigator?: { credentials?: CredentialsContainer } })
        .navigator?.credentials;
    if (!creds) {
      throw new Error(
        'navigator.credentials unavailable — WebAuthnAuthenticatorAdapter requires a browser context',
      );
    }
    const cred = await creds.get(options);
    if (!cred) throw new Error('WebAuthn assertion cancelled or returned null');
    return cred;
  }

  async #prfSalt(req: ShareUnwrapRequest): Promise<Uint8Array> {
    if (this.#cfg.prfSalt) {
      const out = await this.#cfg.prfSalt(req);
      return out;
    }
    return defaultPrfSalt(req.surfaceKeyId);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function toAssertion(cred: PublicKeyCredentialLike): PasskeyAssertion {
  return {
    credentialId: base64UrlEncode(new Uint8Array(cred.rawId)),
    clientDataJson: base64UrlEncode(new Uint8Array(cred.response.clientDataJSON)),
    authenticatorData: base64UrlEncode(
      new Uint8Array(cred.response.authenticatorData),
    ),
    signature: base64UrlEncode(new Uint8Array(cred.response.signature)),
  };
}

async function defaultPrfSalt(surfaceKeyId: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(surfaceKeyId);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(digest);
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

// base64url (RFC 4648 §5) — what WebAuthn naturally hands back.
function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(b64u: string): Uint8Array {
  const pad = b64u.length % 4 === 0 ? '' : '='.repeat(4 - (b64u.length % 4));
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
