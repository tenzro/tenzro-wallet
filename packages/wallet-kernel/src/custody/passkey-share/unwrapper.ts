/**
 * PasskeyShareUnwrapper — turns a passkey assertion into a usable
 * `FrostDeviceShareHolder` that the FROST drivers consume.
 *
 * Two strategies, selected at runtime by capability:
 *
 *   - PRF mode (preferred). Uses the WebAuthn PRF extension
 *     (CTAP2.1 hmac-secret). The authenticator returns
 *     `prfResults.first`, a 32-byte symmetric key that we use to
 *     decrypt a server-stored share envelope. No additional Tenzro
 *     round trip beyond fetching the wrapped envelope.
 *
 *   - largeBlob mode (preferred when prf unavailable but largeBlob is).
 *     Reads the wrapped share directly from the passkey credential's
 *     `largeBlob` storage; no Tenzro round trip at all (the envelope
 *     ships with the passkey).
 *
 *   - Escrow mode (fallback for authenticators without PRF/largeBlob —
 *     e.g. Apple's iOS 17- platform passkeys). The server holds the
 *     share encrypted under a key derived from the assertion + a
 *     Tenzro-issued pepper. Per assertion = per pepper, so each
 *     unwrap is single-use and rate-limited by the node.
 *
 * Tenzro endpoints (Tenzro implements; wallet kernel only consumes):
 *
 *   PRF / largeBlob path:
 *     1. `GET  /wallet/share/envelope?credentialId=...&surfaceKey=...`
 *        Response: `{wrappedShare, alg, salt}`. `wrappedShare` is the
 *        ciphertext over the FROST share `s_i`; the device unwraps it
 *        with the PRF result (or the largeBlob blob).
 *
 *   Escrow path:
 *     1. `POST /wallet/share/escrow/challenge`
 *        Body: `{credentialId, surfaceKey}`.
 *        Response: `{nonce, expiresAt}`.
 *
 *     2. `POST /wallet/share/escrow/unwrap`
 *        Body: `{credentialId, surfaceKey, assertion, nonce}`.
 *        The node verifies the assertion against the registered
 *        passkey, then derives the per-assertion pepper and returns
 *        `{wrappedShare, pepper}`. The device combines them to
 *        recover `s_i`.
 *
 *   Both paths are single-use per round (the node binds the response
 *   to the FROST `sessionId` once known).
 *
 * The unwrapper *itself* is browser-clean (`fetch` + WebCrypto). The
 * authenticator interactions live above this layer in the host app's
 * WebAuthn glue.
 */

import type {
  FrostDeviceShareHolder,
  FrostScheme,
} from '../frost/coordinator.ts';

export type ShareUnwrapMode = 'prf' | 'large-blob' | 'escrow';

/**
 * Capability bag advertised by the host's WebAuthn glue. The host
 * decides at navigator level whether the authenticator supports PRF
 * (CTAP2.1) and largeBlob (CTAP2.1+ extension). The unwrapper consumes
 * these flags and falls back through the priority chain.
 */
export interface PasskeyCapabilities {
  readonly prf: boolean;
  readonly largeBlob: boolean;
  /** Always true — escrow is the universal fallback. */
  readonly escrow: true;
}

export interface ShareUnwrapRequest {
  readonly credentialId: string;
  readonly surfaceKeyId: string;
  readonly scheme: FrostScheme;
}

/**
 * Adapter the unwrapper calls into. Production implementation is the
 * host's WebAuthn layer; tests inject a fake. None of the methods are
 * required by every mode — the unwrapper checks capabilities first.
 */
export interface PasskeyAuthenticatorAdapter {
  /** PRF mode: navigate the assertion ceremony with `prf` extension. */
  prfAssertion?(req: ShareUnwrapRequest): Promise<{
    readonly prfOutput: Uint8Array;
    readonly assertion: PasskeyAssertion;
  }>;
  /** largeBlob mode: read the wrapped share blob from the credential. */
  readLargeBlob?(req: ShareUnwrapRequest): Promise<{
    readonly blob: Uint8Array;
    readonly assertion: PasskeyAssertion;
  }>;
  /** Escrow mode: do an assertion ceremony with no extension. */
  basicAssertion(req: ShareUnwrapRequest & { readonly nonce: string }): Promise<PasskeyAssertion>;
}

/** Same wire shape as `pairing/port.ts` — duplicated here to avoid coupling. */
export interface PasskeyAssertion {
  readonly credentialId: string;
  readonly clientDataJson: string;
  readonly authenticatorData: string;
  readonly signature: string;
}

/**
 * Server transport. Implements the four `/wallet/share/*` endpoints
 * documented in this file's header. Tenzro provides; kernel consumes.
 */
export interface ShareEnvelopePort {
  /** GET /wallet/share/envelope */
  fetchEnvelope(req: ShareUnwrapRequest): Promise<{
    readonly wrappedShare: Uint8Array;
    /** AEAD identifier — `aes-256-gcm` baseline for M5. */
    readonly alg: string;
    /** Salt used by the wrapping HKDF. */
    readonly salt: Uint8Array;
  }>;

  /** POST /wallet/share/escrow/challenge */
  startEscrow(req: ShareUnwrapRequest): Promise<{
    readonly nonce: string;
    readonly expiresAt: number;
  }>;

  /** POST /wallet/share/escrow/unwrap */
  finishEscrow(req: ShareUnwrapRequest & {
    readonly assertion: PasskeyAssertion;
    readonly nonce: string;
  }): Promise<{
    readonly wrappedShare: Uint8Array;
    readonly pepper: Uint8Array;
  }>;
}

/**
 * Builds a `FrostDeviceShareHolder` from a passkey assertion. The
 * actual FROST commit/respond computation runs inside the device's
 * FROST library, fed with the unwrapped share `s_i`.
 *
 * Production needs a real FROST library binding (zk-crypto WASM,
 * frost-core, etc.) injected as `runFrost`. This module only
 * orchestrates the unwrap → bind → dispose sequence, so the FROST
 * library can be swapped without touching the kernel.
 */
export interface FrostBackend {
  commit(args: { share: Uint8Array; scheme: FrostScheme }): Promise<Uint8Array>;
  respond(args: {
    readonly share: Uint8Array;
    readonly scheme: FrostScheme;
    readonly preimage: Uint8Array;
    readonly groupCommitment: Uint8Array;
    readonly signerSet: readonly string[];
    readonly lambda: Uint8Array;
  }): Promise<Uint8Array>;
}

export interface PasskeyShareUnwrapperOptions {
  readonly capabilities: PasskeyCapabilities;
  readonly authenticator: PasskeyAuthenticatorAdapter;
  readonly envelope: ShareEnvelopePort;
  readonly frost: FrostBackend;
  /**
   * Selects the symmetric-decrypt routine. WebCrypto is the default;
   * tests inject a stub. Returns the raw share bytes.
   */
  readonly aeadDecrypt: (args: {
    readonly key: Uint8Array;
    readonly ciphertext: Uint8Array;
    readonly alg: string;
    readonly salt: Uint8Array;
  }) => Promise<Uint8Array>;
}

export class PasskeyShareUnwrapper {
  constructor(private readonly opts: PasskeyShareUnwrapperOptions) {}

  /** Capability-driven mode selection. PRF > largeBlob > escrow. */
  pickMode(): ShareUnwrapMode {
    if (this.opts.capabilities.prf && this.opts.authenticator.prfAssertion) {
      return 'prf';
    }
    if (
      this.opts.capabilities.largeBlob &&
      this.opts.authenticator.readLargeBlob
    ) {
      return 'large-blob';
    }
    return 'escrow';
  }

  async unwrap(req: ShareUnwrapRequest): Promise<FrostDeviceShareHolder> {
    const mode = this.pickMode();
    const share = await this.unwrapShare(mode, req);
    return this.bindHolder(share, req.scheme);
  }

  private async unwrapShare(
    mode: ShareUnwrapMode,
    req: ShareUnwrapRequest,
  ): Promise<Uint8Array> {
    if (mode === 'prf') {
      const { prfOutput } = await this.opts.authenticator.prfAssertion!(req);
      const env = await this.opts.envelope.fetchEnvelope(req);
      return this.opts.aeadDecrypt({
        key: prfOutput,
        ciphertext: env.wrappedShare,
        alg: env.alg,
        salt: env.salt,
      });
    }

    if (mode === 'large-blob') {
      const { blob } = await this.opts.authenticator.readLargeBlob!(req);
      // The largeBlob carries the share already decrypted at provision
      // time (the credential acts as the trust boundary). The blob is
      // the share bytes; pass through.
      return blob;
    }

    // escrow
    const challenge = await this.opts.envelope.startEscrow(req);
    const assertion = await this.opts.authenticator.basicAssertion({
      ...req,
      nonce: challenge.nonce,
    });
    const { wrappedShare, pepper } = await this.opts.envelope.finishEscrow({
      ...req,
      assertion,
      nonce: challenge.nonce,
    });
    return this.opts.aeadDecrypt({
      key: pepper,
      ciphertext: wrappedShare,
      alg: 'aes-256-gcm',
      salt: new Uint8Array(0),
    });
  }

  private bindHolder(
    share: Uint8Array,
    scheme: FrostScheme,
  ): FrostDeviceShareHolder {
    const { frost } = this.opts;
    let disposed = false;
    const wipe = () => {
      if (disposed) return;
      share.fill(0);
      disposed = true;
    };
    return {
      scheme,
      async commit() {
        if (disposed) throw new Error('share holder already disposed');
        return frost.commit({ share, scheme });
      },
      async respond(args) {
        if (disposed) throw new Error('share holder already disposed');
        return frost.respond({ share, scheme, ...args });
      },
      dispose: wipe,
    };
  }
}
