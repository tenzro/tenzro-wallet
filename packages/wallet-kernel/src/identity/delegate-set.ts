/**
 * TDIP social-recovery delegate set — `k of n` configuration.
 *
 * Per DESIGN.md §4.3.6 + §11.10 (deferred): users designate `n` delegates
 * (TDIP-rooted DIDs of trusted parties — friends, family, institutions) and
 * recovery requires `k` of them to co-sign. We ship a 3-of-5 default that
 * matches Argent's model, with k/n configurable at delegate-set creation.
 *
 * The kernel exposes the *shape* + validation here; the actual recovery
 * flow (UI, delegate-onboarding, signature collection) lives in the
 * passkey-quorum custody surface (M5.5).
 *
 * Constraints:
 *   - 1 ≤ k ≤ n
 *   - n ≤ 7 (exchange-grade; UX gets unwieldy beyond this — ship a higher
 *     cap only when there's a documented enterprise need)
 *   - delegates list contains exactly `n` distinct DIDs
 *   - the wallet's own DID cannot appear in the delegate list (prevents
 *     a self-recovery loop where the wallet is also a delegate of itself)
 */

import type { TdipDid } from '../types/identity.ts';

export interface DelegateSetConfig {
  readonly k: number;
  readonly n: number;
  /** Exactly `n` distinct delegate DIDs. Order is the canonical signing order. */
  readonly delegates: readonly TdipDid[];
}

/** Argent-style default. */
export const DELEGATE_SET_DEFAULT_K = 3;
export const DELEGATE_SET_DEFAULT_N = 5;
export const DELEGATE_SET_MAX_N = 7;

export interface DelegateSetSizeOption {
  readonly k: number;
  readonly n: number;
  readonly label: string;
  readonly tier: 'friendly' | 'standard' | 'exchange-grade';
}

/**
 * UX-validated options the social-recovery UI offers. The user can also
 * roll a custom k/n inside the constraints. These three are the curated
 * presets.
 */
export const DELEGATE_SET_OPTIONS: readonly DelegateSetSizeOption[] = [
  { k: 2, n: 3, label: '2 of 3 (friendly)', tier: 'friendly' },
  { k: 3, n: 5, label: '3 of 5 (standard)', tier: 'standard' },
  { k: 5, n: 7, label: '5 of 7 (exchange-grade)', tier: 'exchange-grade' },
];

/**
 * Validate a `DelegateSetConfig` against the recovery rules. Returns the
 * config unchanged on success; throws with a specific reason otherwise.
 *
 * `selfDid` is the wallet's own DID; if provided, the validator rejects
 * configs where the wallet is in its own delegate list.
 */
export function validateDelegateSet(cfg: DelegateSetConfig, selfDid?: TdipDid): DelegateSetConfig {
  if (!Number.isInteger(cfg.k) || !Number.isInteger(cfg.n)) {
    throw new Error(`validateDelegateSet: k and n must be integers; got ${cfg.k}/${cfg.n}`);
  }
  if (cfg.k < 1) {
    throw new Error(`validateDelegateSet: k must be ≥ 1; got ${cfg.k}`);
  }
  if (cfg.k > cfg.n) {
    throw new Error(`validateDelegateSet: k (${cfg.k}) cannot exceed n (${cfg.n})`);
  }
  if (cfg.n > DELEGATE_SET_MAX_N) {
    throw new Error(
      `validateDelegateSet: n (${cfg.n}) exceeds DELEGATE_SET_MAX_N (${DELEGATE_SET_MAX_N}); ` +
        'open an issue if your use case requires more',
    );
  }
  if (cfg.delegates.length !== cfg.n) {
    throw new Error(
      `validateDelegateSet: expected exactly ${cfg.n} delegates, got ${cfg.delegates.length}`,
    );
  }
  const seen = new Set<string>();
  for (const d of cfg.delegates) {
    if (seen.has(d)) {
      throw new Error(`validateDelegateSet: duplicate delegate ${d}`);
    }
    seen.add(d);
  }
  if (selfDid !== undefined && seen.has(selfDid)) {
    throw new Error(
      `validateDelegateSet: wallet DID ${selfDid} cannot appear in its own delegate list`,
    );
  }
  return cfg;
}

/**
 * Build the default 3-of-5 delegate set from a list of candidate delegate
 * DIDs. Throws if fewer than 5 delegates are supplied.
 */
export function defaultDelegateSet(
  delegates: readonly TdipDid[],
  selfDid?: TdipDid,
): DelegateSetConfig {
  if (delegates.length < DELEGATE_SET_DEFAULT_N) {
    throw new Error(
      `defaultDelegateSet: need ${DELEGATE_SET_DEFAULT_N} delegates for the default config, got ${delegates.length}`,
    );
  }
  return validateDelegateSet(
    {
      k: DELEGATE_SET_DEFAULT_K,
      n: DELEGATE_SET_DEFAULT_N,
      delegates: delegates.slice(0, DELEGATE_SET_DEFAULT_N),
    },
    selfDid,
  );
}
