/**
 * Signing driver abstraction. Maps to the same shape Splice Wallet Kernel uses
 * (core-signing-internal, core-signing-participant, ...) plus the Tenzro
 * passkey driver.
 *
 * Surface modules call these; they never see raw key material. Every key is
 * hardware-rooted: a passkey (WebAuthn P-256 with user verification) or a
 * TPM / Secure Enclave key on the machine running the wallet. Nothing is
 * held by a node.
 */

import type { SurfaceKey, TdipDid } from './identity.ts';

/**
 * - `webauthn-p256` — the Tenzro account scheme. A WebAuthn assertion from
 *   an enrolled passkey; the passkey is the only key. The driver returns ONE
 *   entry: the encoded signature bundle the account's
 *   WebAuthn validator verifies (`userOp.signature`).
 * - `ed25519` — single Ed25519 signature (SVM, Canton, machine keys).
 * - `secp256k1` — single ECDSA signature (external EVM keys).
 * - `ed25519+ml-dsa-65` — composite hybrid pair for machine identities whose
 *   device key signs both legs. Returns two entries.
 */
export type SigningScheme = 'webauthn-p256' | 'ed25519' | 'secp256k1' | 'ed25519+ml-dsa-65';

export interface SigningRequest {
  readonly did: TdipDid;
  readonly surfaceKey: SurfaceKey;
  readonly scheme: SigningScheme;
  /** Canonical preimage bytes — surface module is responsible for canonicalization. */
  readonly preimage: Uint8Array;
  /** Optional context tag for the signing driver's audit log. */
  readonly purpose?: string;
}

export interface SigningResult {
  /** One signature per scheme component. Hybrid signing returns two entries. */
  readonly signatures: readonly Uint8Array[];
}

export interface SigningDriver {
  readonly id: /** Passkey driver: WebAuthn assertion. */
    | 'passkey'
    /** A TPM / Secure Enclave device key supplied by the host. */
    | 'device-key'
    | 'fireblocks'
    | 'blockdaemon'
    | 'canton-participant'
    /** Deterministic in-memory stub for unit tests. */
    | 'test';
  sign(req: SigningRequest): Promise<SigningResult>;
}
