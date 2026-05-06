/**
 * FeeEstimatorSdkAdapter — wraps `TenzroClient` for EIP-1559 fee market
 * reads.
 *
 * Wire:
 *   gasPrice              → TenzroClient.getGasPrice()
 *   maxPriorityFeePerGas  → TenzroClient.getMaxPriorityFeePerGas()
 *   feeHistory            → TenzroClient.getFeeHistory(blockCount, newest, percentiles)
 *
 * `suggestFees()` is a derived policy: it pulls the last 4 blocks of fee
 * history with `[25, 50, 75]` reward percentiles, picks the matching
 * percentile per `FeeSpeed`, and returns
 *   maxFeePerGas         = nextBlockBaseFee × buffer + tip
 *   maxPriorityFeePerGas = tip
 *
 * The `buffer` is a flat 1.5× multiplier on the predicted base fee — the
 * usual headroom to absorb a single +12.5% block adjustment without the
 * tx becoming under-priced.
 */

import type { FeeHistory, TenzroClient } from 'tenzro-sdk';
import type {
  FeeEstimatorPort,
  FeeHistoryRecord,
  FeeSpeed,
  SuggestedFees,
} from '../fee-estimator.ts';

export type FeeEstimatorClientLike = Pick<
  TenzroClient,
  'getGasPrice' | 'getMaxPriorityFeePerGas' | 'getFeeHistory'
>;

const BASE_FEE_BUFFER_NUM = 3n;
const BASE_FEE_BUFFER_DEN = 2n; // 1.5×

const SPEED_PERCENTILES: ReadonlyArray<number> = [25, 50, 75];

export class FeeEstimatorSdkAdapter implements FeeEstimatorPort {
  constructor(private readonly client: FeeEstimatorClientLike) {}

  gasPrice(): Promise<bigint> {
    return this.client.getGasPrice();
  }

  maxPriorityFeePerGas(): Promise<bigint> {
    return this.client.getMaxPriorityFeePerGas();
  }

  async feeHistory(
    blockCount: number,
    newestBlock = 'latest',
    rewardPercentiles?: number[],
  ): Promise<FeeHistoryRecord> {
    const raw = await this.client.getFeeHistory(blockCount, newestBlock, rewardPercentiles);
    return decodeFeeHistory(raw);
  }

  async suggestFees(speed: FeeSpeed = 'normal'): Promise<SuggestedFees> {
    let hist: FeeHistoryRecord;
    try {
      hist = await this.feeHistory(4, 'latest', [...SPEED_PERCENTILES]);
    } catch {
      // No fee history → fall back to single-field gasPrice.
      const gp = await this.gasPrice();
      return {
        maxFeePerGas: gp,
        maxPriorityFeePerGas: 0n,
        nextBlockBaseFee: gp,
      };
    }

    if (hist.baseFeePerGas.length === 0) {
      const gp = await this.gasPrice();
      return {
        maxFeePerGas: gp,
        maxPriorityFeePerGas: 0n,
        nextBlockBaseFee: gp,
      };
    }

    // Trailing entry is the predicted next-block base fee.
    const nextBaseFee = hist.baseFeePerGas[hist.baseFeePerGas.length - 1] ?? 0n;
    const tip = pickPriorityTip(hist, speed) ?? (await this.maxPriorityFeePerGas());
    const maxFee = (nextBaseFee * BASE_FEE_BUFFER_NUM) / BASE_FEE_BUFFER_DEN + tip;

    return {
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: tip,
      nextBlockBaseFee: nextBaseFee,
    };
  }
}

function decodeFeeHistory(raw: FeeHistory): FeeHistoryRecord {
  const baseFeesSrc: string[] = raw.baseFeePerGas ?? [];
  const baseFees = baseFeesSrc.map((s: string) => BigInt(s));
  const ratios: number[] = raw.gasUsedRatio ?? [];
  const reward = raw.reward
    ? Object.freeze(
        raw.reward.map((row: string[]) => Object.freeze(row.map((s: string) => BigInt(s)))),
      )
    : undefined;
  return {
    oldestBlock: raw.oldestBlock,
    baseFeePerGas: Object.freeze(baseFees),
    gasUsedRatio: Object.freeze([...ratios]),
    ...(reward !== undefined ? { reward } : {}),
  };
}

function pickPriorityTip(hist: FeeHistoryRecord, speed: FeeSpeed): bigint | null {
  if (hist.reward === undefined || hist.reward.length === 0) return null;
  const colIdx = speed === 'slow' ? 0 : speed === 'normal' ? 1 : 2;
  // Average the chosen percentile across the window for stability.
  let sum = 0n;
  let count = 0n;
  for (const row of hist.reward) {
    const v = row[colIdx];
    if (v !== undefined) {
      sum += v;
      count += 1n;
    }
  }
  if (count === 0n) return null;
  return sum / count;
}
