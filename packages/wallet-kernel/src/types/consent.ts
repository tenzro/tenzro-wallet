/**
 * Consent and policy types. The kernel always enforces
 * `effectiveLimit = sessionPolicy ∩ delegationScope` at sign time.
 */

import type { AssetId } from './asset.ts';

/**
 * KYC verification tier. Mirrors `tenzro_identity::KycTier` exactly:
 * Unverified (0), Basic (1), Enhanced (2), Full (3). When set on a
 * policy, the signing identity must hold a credential at this tier or
 * higher for the policy to satisfy.
 */
export type KycTier = 'Unverified' | 'Basic' | 'Enhanced' | 'Full';

export interface SpendingPolicy {
  readonly maxPerTx?: bigint;
  readonly maxPerDay?: bigint;
  readonly assetWhitelist?: readonly AssetId[];
  /** Allowed contract addresses, for EVM/SVM. */
  readonly contractWhitelist?: readonly string[];
  /** Operations the session may invoke. */
  readonly operationWhitelist?: readonly string[];
  readonly expiresAt?: number;
  /**
   * Minimum KYC tier the *signing identity* must hold for this policy to
   * be satisfied. The kernel reads the identity's tier from the
   * `tenzro-identity` port and compares numerically: signer tier ≥
   * required tier. Undefined = no KYC requirement.
   */
  readonly minKycTier?: KycTier;
}

const KYC_TIER_ORDER: Record<KycTier, number> = {
  Unverified: 0,
  Basic: 1,
  Enhanced: 2,
  Full: 3,
};

/**
 * Compares two KYC tiers numerically. Returns positive when `a > b`,
 * negative when `a < b`, zero when equal.
 */
export function compareKycTier(a: KycTier, b: KycTier): number {
  return KYC_TIER_ORDER[a] - KYC_TIER_ORDER[b];
}

/**
 * A user-confirmed consent envelope passed to `surface.sign(prepared, consent)`.
 * The kernel's `sign()` facade attaches this; surface modules don't construct it.
 */
export interface Consent {
  /** Set when the user is signing under an active session key. */
  readonly sessionId?: string;
  readonly approvedAt: number;
  /** Optional human-typed confirmation phrase for high-value sends. */
  readonly confirmationPhrase?: string;
}
