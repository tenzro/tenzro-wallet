import { describe, expect, it } from 'vitest';
import type { AssetId, AssetView } from '../types/asset.ts';
import { aggregateBalances } from './aggregator.ts';

const TNZO: AssetId = { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 };
const USDC: AssetId = { scope: 'tenzro-asset', symbol: 'USDC', decimals: 6 };

describe('balance aggregator', () => {
  it('returns the native balance once for tenzro-native, even with multiple views', async () => {
    const balances = await aggregateBalances([
      {
        fetchViews: async () =>
          [
            { asset: TNZO, surface: 'tenzro-native', balance: 100n * 10n ** 18n },
            { asset: TNZO, surface: 'evm-on-tenzro', balance: 100n * 10n ** 18n },
            { asset: TNZO, surface: 'svm-on-tenzro', balance: 100n * 10n ** 9n },
          ] satisfies AssetView[],
      },
    ]);
    const tnzo = balances.find((b) => b.asset.symbol === 'TNZO');
    expect(tnzo).toBeDefined();
    // Native is the source of truth, NOT the sum of views.
    expect(tnzo!.total).toBe(100n * 10n ** 18n);
    expect(tnzo!.views).toHaveLength(3);
  });

  it('flags sub-lamport dust visible on native but not on SVM', async () => {
    const balances = await aggregateBalances([
      {
        fetchViews: async () =>
          [
            // 100 TNZO + 1 wei
            { asset: TNZO, surface: 'tenzro-native', balance: 100n * 10n ** 18n + 1n },
            { asset: TNZO, surface: 'svm-on-tenzro', balance: 100n * 10n ** 9n },
          ] satisfies AssetView[],
      },
    ]);
    const tnzo = balances.find((b) => b.asset.symbol === 'TNZO')!;
    expect(tnzo.warnings.some((w) => w.includes('dust'))).toBe(true);
  });

  it('sums non-tenzro-native assets across views', async () => {
    const balances = await aggregateBalances([
      {
        fetchViews: async () =>
          [
            { asset: USDC, surface: 'tenzro-native', balance: 10n },
            { asset: USDC, surface: 'evm-on-tenzro', balance: 5n },
          ] satisfies AssetView[],
      },
    ]);
    expect(balances[0]!.total).toBe(15n);
  });
});
