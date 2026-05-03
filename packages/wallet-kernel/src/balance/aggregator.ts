/**
 * Unified balance aggregator. Group by asset, not by surface — this is the
 * single most user-visible feature of Tenzro Wallet.
 *
 * For Tenzro-on-Tenzro assets (TNZO), one balance is exposed under multiple
 * surfaces; the aggregator MUST NOT double-count, so the source of truth is the
 * native balance and the EVM/SVM/canton-internal views just describe how it
 * surfaces.
 */

import type { AssetId, AssetView, UnifiedBalance } from '../types/asset.ts';
import { SURFACE_NATIVE_DECIMALS } from '../types/surface.ts';

export interface BalanceProvider {
  /** Per-surface balance fetch — returns AssetViews discovered on that surface. */
  fetchViews(): Promise<readonly AssetView[]>;
}

export async function aggregateBalances(
  providers: readonly BalanceProvider[],
): Promise<readonly UnifiedBalance[]> {
  const allViews = (await Promise.all(providers.map((p) => p.fetchViews()))).flat();
  const byAsset = new Map<string, AssetView[]>();
  for (const v of allViews) {
    const key = assetKey(v.asset);
    const existing = byAsset.get(key);
    if (existing) existing.push(v);
    else byAsset.set(key, [v]);
  }

  const out: UnifiedBalance[] = [];
  for (const [, views] of byAsset) {
    const asset = views[0]!.asset;
    const total = computeTotal(asset, views);
    const warnings = computeWarnings(asset, views);
    out.push({ asset, total, views, warnings });
  }
  return out;
}

function assetKey(a: AssetId): string {
  return `${a.scope}/${a.symbol}/${a.nativeId ?? ''}`;
}

/**
 * For tenzro-native assets, all on-Tenzro views are pointers at the same
 * native balance — return the native view as the total, falling back to the
 * largest view if no native one is present. For everything else, sum.
 */
function computeTotal(asset: AssetId, views: readonly AssetView[]): bigint {
  if (asset.scope === 'tenzro-native') {
    const nativeView = views.find((v) => v.surface === 'tenzro-native');
    if (nativeView) return nativeView.balance;
    // No native view in this snapshot; trust the canonical-decimal view.
    let max = 0n;
    for (const v of views) if (v.balance > max) max = v.balance;
    return max;
  }
  let sum = 0n;
  for (const v of views) sum += v.balance;
  return sum;
}

function computeWarnings(asset: AssetId, views: readonly AssetView[]): readonly string[] {
  const w: string[] = [];
  if (asset.scope === 'tenzro-native') {
    const native = views.find((v) => v.surface === 'tenzro-native')?.balance;
    const svm = views.find((v) => v.surface === 'svm-on-tenzro')?.balance;
    if (native !== undefined && svm !== undefined) {
      // SVM truncates to 9 decimals; sub-9-decimal dust on native won't appear there.
      const svmDecimals = SURFACE_NATIVE_DECIMALS['svm-on-tenzro'];
      const div = 10n ** BigInt(asset.decimals - svmDecimals);
      const truncated = (native / div) * div;
      if (truncated !== native) {
        w.push('sub-lamport dust on Tenzro native is not visible to Solana programs');
      }
    }
  }
  return w;
}
