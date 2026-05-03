/**
 * Asset model. Balances are always stored in canonical native units (bigint);
 * decimal conversion happens at the UI edge.
 *
 * `scope` distinguishes:
 *  - "tenzro-native"  — the canonical TNZO balance (one ledger, three views)
 *  - "tenzro-asset"   — any other asset registered on Tenzro (USDC on Tempo, etc.)
 *  - "external-evm"   — assets on an external EVM chain (Ethereum, Base, ...)
 *  - "external-svm"   — assets on Solana mainnet
 *  - "canton-mainnet" — CIP-56 holdings on Canton Network MainNet
 */

import type { SurfaceName } from './surface.ts';

export type AssetScope =
  | 'tenzro-native'
  | 'tenzro-asset'
  | 'external-evm'
  | 'external-svm'
  | 'canton-mainnet';

/**
 * Canonical asset identifier. For multi-surface assets (TNZO), the same AssetId
 * appears under multiple SurfaceName entries in the unified balance.
 */
export interface AssetId {
  readonly scope: AssetScope;
  /** Symbol as displayed: TNZO, USDC, CC, etc. */
  readonly symbol: string;
  /** Chain-specific identifier (contract addr, mint addr, package+template, etc.). */
  readonly nativeId?: string;
  /** Decimal count for canonical-unit storage. */
  readonly decimals: number;
}

export interface AssetView {
  readonly asset: AssetId;
  readonly surface: SurfaceName;
  readonly balance: bigint;
}

/**
 * The unified balance card the UI renders. One entry per asset, with all
 * surface-views collapsed and any precision warnings attached.
 */
export interface UnifiedBalance {
  readonly asset: AssetId;
  /** Sum across all surfaces, in canonical units of `asset.decimals`. */
  readonly total: bigint;
  readonly views: readonly AssetView[];
  readonly warnings: readonly string[];
}
