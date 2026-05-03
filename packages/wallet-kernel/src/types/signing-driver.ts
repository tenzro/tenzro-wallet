/**
 * Signing driver abstraction. Maps to the same shape Splice Wallet Kernel uses
 * (core-signing-internal, core-signing-fireblocks, core-signing-blockdaemon,
 * core-signing-participant) plus a Tenzro-native MPC driver.
 *
 * Surface modules call these; they never see raw key material.
 */

import type { SurfaceKey, TdipDid } from './identity.ts';

/**
 * - `ed25519` — single Ed25519 signature (Tenzro native non-hybrid surfaces,
 *   SVM, Canton).
 * - `secp256k1` — single ECDSA signature (EVM).
 * - `ed25519+ml-dsa-65` — hybrid pair (Tenzro native). Per DESIGN.md §4.3.4
 *   and §11, M5 threshold-signs the Ed25519 leg across the passkey-quorum
 *   (FROST-Ed25519) but the ML-DSA-65 leg is supplied by the node TEE
 *   alone, since threshold ML-DSA has no audited WASM-shippable
 *   implementation as of 2026-04. Device-side `SigningDriver`s therefore
 *   return a *single* Ed25519 signature for this scheme; the ML-DSA leg
 *   is appended server-side and the node submits the hybrid pair. This
 *   means the TEE is in every Tenzro-native signature until threshold
 *   ML-DSA exists. Track NIST IR 8214B and FROST-PQ for when that flips
 *   to a 2-element `signatures` array assembled locally.
 */
export type SigningScheme = 'ed25519' | 'secp256k1' | 'ed25519+ml-dsa-65';

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
  readonly id:
    | 'internal-mpc'
    | 'tenzro-tee'
    | 'fireblocks'
    | 'blockdaemon'
    | 'canton-participant'
    /** Threshold Ed25519 device driver — FROST round-coordinated (M5). */
    | 'frost-ed25519'
    /** Threshold secp256k1 device driver — FROST round-coordinated (M5). */
    | 'frost-secp256k1'
    /** Hybrid driver — FROST-Ed25519 leg + node-TEE ML-DSA-65 leg (M5). */
    | 'hybrid-ed25519-mldsa';
  sign(req: SigningRequest): Promise<SigningResult>;
}
