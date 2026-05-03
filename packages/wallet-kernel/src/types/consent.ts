/**
 * Consent and policy types. The kernel always enforces
 * `effectiveLimit = sessionPolicy ∩ delegationScope` at sign time.
 */

import type { AssetId } from './asset.ts';

export interface SpendingPolicy {
  readonly maxPerTx?: bigint;
  readonly maxPerDay?: bigint;
  readonly assetWhitelist?: readonly AssetId[];
  /** Allowed contract addresses, for EVM/SVM. */
  readonly contractWhitelist?: readonly string[];
  /** Operations the session may invoke. */
  readonly operationWhitelist?: readonly string[];
  readonly expiresAt?: number;
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
