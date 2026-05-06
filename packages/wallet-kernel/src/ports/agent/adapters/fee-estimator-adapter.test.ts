/**
 * Pin FeeEstimator adapter — gasPrice / maxPriorityFeePerGas pass-through,
 * feeHistory snake_case → BigInt decode, and the derived suggestFees()
 * policy: nextBaseFee × 1.5 + tip, picked per speed from the [25,50,75]
 * percentile columns. Falls back cleanly when fee history is unavailable.
 */

import { describe, expect, it } from 'vitest';
import { type FeeEstimatorClientLike, FeeEstimatorSdkAdapter } from './fee-estimator-adapter.ts';

function fakeClient(overrides: Partial<FeeEstimatorClientLike> = {}): {
  client: FeeEstimatorClientLike;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: FeeEstimatorClientLike = {
    getGasPrice: async () => {
      calls.push({ method: 'getGasPrice', args: [] });
      return 0n;
    },
    getMaxPriorityFeePerGas: async () => {
      calls.push({ method: 'getMaxPriorityFeePerGas', args: [] });
      return 0n;
    },
    getFeeHistory: async (blockCount, newestBlock, rewardPercentiles) => {
      calls.push({
        method: 'getFeeHistory',
        args: [blockCount, newestBlock, rewardPercentiles],
      });
      return {
        oldestBlock: '0x0',
        baseFeePerGas: [],
        gasUsedRatio: [],
      };
    },
    ...overrides,
  };
  return { client, calls };
}

describe('FeeEstimatorSdkAdapter.gasPrice', () => {
  it('forwards to TenzroClient.getGasPrice', async () => {
    const { client } = fakeClient({
      getGasPrice: async () => 1_500_000_000n,
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    expect(await adapter.gasPrice()).toBe(1_500_000_000n);
  });
});

describe('FeeEstimatorSdkAdapter.maxPriorityFeePerGas', () => {
  it('forwards to TenzroClient.getMaxPriorityFeePerGas', async () => {
    const { client } = fakeClient({
      getMaxPriorityFeePerGas: async () => 2_000_000_000n,
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    expect(await adapter.maxPriorityFeePerGas()).toBe(2_000_000_000n);
  });
});

describe('FeeEstimatorSdkAdapter.feeHistory', () => {
  it('decodes snake_case raw payload into BigInt-widened record', async () => {
    const { client } = fakeClient({
      getFeeHistory: async () => ({
        oldestBlock: '0x100',
        baseFeePerGas: ['1000', '1100', '1210', '1331', '1464'],
        gasUsedRatio: [0.5, 0.6, 0.55, 0.7],
        reward: [
          ['10', '20', '30'],
          ['11', '21', '31'],
          ['12', '22', '32'],
          ['13', '23', '33'],
        ],
      }),
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    const hist = await adapter.feeHistory(4, 'latest', [25, 50, 75]);
    expect(hist.oldestBlock).toBe('0x100');
    expect(hist.baseFeePerGas.length).toBe(5);
    expect(hist.baseFeePerGas[0]).toBe(1000n);
    expect(hist.baseFeePerGas[4]).toBe(1464n);
    expect(hist.gasUsedRatio.length).toBe(4);
    expect(hist.reward?.[0]?.[1]).toBe(20n);
    expect(hist.reward?.[3]?.[2]).toBe(33n);
  });

  it('handles missing optional fields gracefully', async () => {
    const { client } = fakeClient({
      getFeeHistory: async () => ({
        oldestBlock: '0x0',
        baseFeePerGas: [],
        gasUsedRatio: [],
      }),
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    const hist = await adapter.feeHistory(1);
    expect(hist.baseFeePerGas).toEqual([]);
    expect(hist.gasUsedRatio).toEqual([]);
    expect(hist.reward).toBeUndefined();
  });
});

describe('FeeEstimatorSdkAdapter.suggestFees', () => {
  it('computes nextBaseFee × 1.5 + tip for normal speed (col 1)', async () => {
    const { client } = fakeClient({
      getFeeHistory: async () => ({
        oldestBlock: '0x100',
        // 4 historical + 1 predicted-next = 5 entries
        baseFeePerGas: ['1000', '1100', '1210', '1331', '1464'],
        gasUsedRatio: [0.5, 0.6, 0.55, 0.7],
        reward: [
          ['10', '20', '30'],
          ['12', '22', '32'],
          ['14', '24', '34'],
          ['16', '26', '36'],
        ],
      }),
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    const fees = await adapter.suggestFees('normal');
    // tip = avg(20, 22, 24, 26) = 23
    // maxFee = 1464 × 3 / 2 + 23 = 2196 + 23 = 2219
    expect(fees.nextBlockBaseFee).toBe(1464n);
    expect(fees.maxPriorityFeePerGas).toBe(23n);
    expect(fees.maxFeePerGas).toBe(2219n);
  });

  it("picks col 0 for 'slow' and col 2 for 'fast'", async () => {
    const { client } = fakeClient({
      getFeeHistory: async () => ({
        oldestBlock: '0x100',
        baseFeePerGas: ['1000', '1100'],
        gasUsedRatio: [0.5],
        reward: [['10', '20', '30']],
      }),
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    const slow = await adapter.suggestFees('slow');
    const fast = await adapter.suggestFees('fast');
    // slow tip = 10; fast tip = 30
    // nextBaseFee = 1100; maxFee_slow = 1650 + 10 = 1660; maxFee_fast = 1650 + 30 = 1680
    expect(slow.maxPriorityFeePerGas).toBe(10n);
    expect(slow.maxFeePerGas).toBe(1660n);
    expect(fast.maxPriorityFeePerGas).toBe(30n);
    expect(fast.maxFeePerGas).toBe(1680n);
  });

  it('falls back to gasPrice when fee history throws', async () => {
    const { client } = fakeClient({
      getFeeHistory: async () => {
        throw new Error('rpc unavailable');
      },
      getGasPrice: async () => 5_000_000_000n,
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    const fees = await adapter.suggestFees('normal');
    expect(fees.maxFeePerGas).toBe(5_000_000_000n);
    expect(fees.maxPriorityFeePerGas).toBe(0n);
    expect(fees.nextBlockBaseFee).toBe(5_000_000_000n);
  });

  it('falls back to gasPrice when baseFeePerGas window is empty', async () => {
    const { client } = fakeClient({
      getFeeHistory: async () => ({
        oldestBlock: '0x0',
        baseFeePerGas: [],
        gasUsedRatio: [],
      }),
      getGasPrice: async () => 7_777n,
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    const fees = await adapter.suggestFees('fast');
    expect(fees.maxFeePerGas).toBe(7_777n);
    expect(fees.maxPriorityFeePerGas).toBe(0n);
    expect(fees.nextBlockBaseFee).toBe(7_777n);
  });

  it('falls back to maxPriorityFeePerGas() when reward column is absent', async () => {
    const { client } = fakeClient({
      getFeeHistory: async () => ({
        oldestBlock: '0x100',
        baseFeePerGas: ['1000', '1100'],
        gasUsedRatio: [0.5],
        // No reward field at all
      }),
      getMaxPriorityFeePerGas: async () => 99n,
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    const fees = await adapter.suggestFees('normal');
    // nextBaseFee = 1100, tip via fallback = 99
    // maxFee = 1100 × 3 / 2 + 99 = 1650 + 99 = 1749
    expect(fees.nextBlockBaseFee).toBe(1100n);
    expect(fees.maxPriorityFeePerGas).toBe(99n);
    expect(fees.maxFeePerGas).toBe(1749n);
  });

  it('requests last 4 blocks with [25,50,75] percentiles', async () => {
    let captured: {
      blockCount: number;
      newest: string | undefined;
      pcts: number[] | undefined;
    } | null = null;
    const { client } = fakeClient({
      getFeeHistory: async (blockCount, newestBlock, rewardPercentiles) => {
        captured = {
          blockCount,
          newest: newestBlock,
          pcts: rewardPercentiles,
        };
        return {
          oldestBlock: '0x0',
          baseFeePerGas: ['100', '110'],
          gasUsedRatio: [0.5],
          reward: [['1', '2', '3']],
        };
      },
    });
    const adapter = new FeeEstimatorSdkAdapter(client);
    await adapter.suggestFees();
    expect(captured).not.toBeNull();
    expect(captured!.blockCount).toBe(4);
    expect(captured!.newest).toBe('latest');
    expect(captured!.pcts).toEqual([25, 50, 75]);
  });
});
