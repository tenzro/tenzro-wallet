/**
 * Effective-limit enforcement.
 *
 * Effective limit = sessionPolicy ∩ delegationScope.
 * The kernel's `sign()` calls `enforcePolicy` before invoking the surface
 * module's `sign()`. A policy violation throws — there's no "warn and proceed."
 */

import type { Consent, KycTier, SpendingPolicy } from '../types/consent.ts';
import { compareKycTier } from '../types/consent.ts';
import type { Intent } from '../types/intent.ts';

export class PolicyViolationError extends Error {
  constructor(reason: string) {
    super(`policy violation: ${reason}`);
    this.name = 'PolicyViolationError';
  }
}

export interface PolicyContext {
  /** Identity-level scope set by the user when delegating to this session. */
  readonly delegationScope?: SpendingPolicy;
  /** Per-session policy set when the session was opened. */
  readonly sessionPolicy?: SpendingPolicy;
  /** Total spend already debited under the active session, in canonical units. */
  readonly spentSoFarToday?: bigint;
  /**
   * Current KYC tier of the signing identity. When `effective.minKycTier`
   * is set, this must be ≥ that tier. Defaults to `Unverified` when omitted.
   */
  readonly signerKycTier?: KycTier;
}

export function enforcePolicy(intent: Intent, consent: Consent, ctx: PolicyContext): void {
  if (intent.kind !== 'send') return;

  const effective = intersect(ctx.delegationScope, ctx.sessionPolicy);
  if (!effective) return;

  if (effective.expiresAt !== undefined && consent.approvedAt > effective.expiresAt) {
    throw new PolicyViolationError('session expired');
  }
  if (effective.maxPerTx !== undefined && intent.amount > effective.maxPerTx) {
    throw new PolicyViolationError(`amount exceeds maxPerTx (${effective.maxPerTx})`);
  }
  if (effective.maxPerDay !== undefined) {
    const projected = (ctx.spentSoFarToday ?? 0n) + intent.amount;
    if (projected > effective.maxPerDay) {
      throw new PolicyViolationError(
        `daily cap exceeded (would total ${projected}, cap ${effective.maxPerDay})`,
      );
    }
  }
  if (effective.assetWhitelist && effective.assetWhitelist.length > 0) {
    const allowed = effective.assetWhitelist.some(
      (a) => a.symbol === intent.asset.symbol && a.scope === intent.asset.scope,
    );
    if (!allowed) throw new PolicyViolationError(`asset ${intent.asset.symbol} not in whitelist`);
  }
  if (effective.minKycTier !== undefined) {
    const signerTier: KycTier = ctx.signerKycTier ?? 'Unverified';
    if (compareKycTier(signerTier, effective.minKycTier) < 0) {
      throw new PolicyViolationError(
        `signer KYC tier ${signerTier} is below required ${effective.minKycTier}`,
      );
    }
  }
}

/**
 * The intersection is the more-restrictive of any two limits, and the union
 * (well, intersection) of any whitelists. Undefined means "no limit on this
 * dimension".
 */
function intersect(
  a: SpendingPolicy | undefined,
  b: SpendingPolicy | undefined,
): SpendingPolicy | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;

  const out: Record<string, unknown> = {};
  const maxPerTx = minBigint(a.maxPerTx, b.maxPerTx);
  if (maxPerTx !== undefined) out.maxPerTx = maxPerTx;
  const maxPerDay = minBigint(a.maxPerDay, b.maxPerDay);
  if (maxPerDay !== undefined) out.maxPerDay = maxPerDay;
  const assets = intersectWhitelist(a.assetWhitelist, b.assetWhitelist);
  if (assets !== undefined) out.assetWhitelist = assets;
  const contracts = intersectStringList(a.contractWhitelist, b.contractWhitelist);
  if (contracts !== undefined) out.contractWhitelist = contracts;
  const ops = intersectStringList(a.operationWhitelist, b.operationWhitelist);
  if (ops !== undefined) out.operationWhitelist = ops;
  const expiresAt = minNumber(a.expiresAt, b.expiresAt);
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  const minKycTier = maxKycTier(a.minKycTier, b.minKycTier);
  if (minKycTier !== undefined) out.minKycTier = minKycTier;
  return out as SpendingPolicy;
}

/**
 * Intersection picks the *more restrictive* KYC requirement: when both
 * sides specify a tier, the higher one wins. Undefined on a side means
 * "no KYC requirement from this layer".
 */
function maxKycTier(a: KycTier | undefined, b: KycTier | undefined): KycTier | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return compareKycTier(a, b) >= 0 ? a : b;
}

function minBigint(a: bigint | undefined, b: bigint | undefined): bigint | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a < b ? a : b;
}
function minNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a < b ? a : b;
}
function intersectWhitelist<T extends { symbol: string; scope: string }>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
): readonly T[] | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.filter((x) => b.some((y) => y.symbol === x.symbol && y.scope === x.scope));
}
function intersectStringList(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.filter((x) => b.includes(x));
}
