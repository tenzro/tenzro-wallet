/**
 * FeeEstimatorPort — EIP-1559 fee market read access for transaction
 * builders that need to fill `maxFeePerGas` / `maxPriorityFeePerGas`.
 *
 * Tenzro tracks an EIP-1559 fee market: `base_fee_per_gas` adjusts ±12.5%
 * per block against a 15M-gas target, with the burn portion governed by
 * the adaptive-burn dial. Wallet UI flows (transfer, agent-bond post,
 * escrow create, ERC-7683 origin-open) need three things:
 *
 *   1. The current effective gas price (legacy single-field tx, fallback).
 *   2. A suggested priority tip for inclusion within the next ~3 blocks.
 *   3. Base-fee history so the UI can render a "fast/normal/slow" picker.
 *
 * The wallet wraps the SDK's `TenzroClient.getGasPrice` /
 * `getMaxPriorityFeePerGas` / `getFeeHistory`. Three policies are
 * exposed as a derived helper because most callers want
 * `(maxFee, maxPriorityFee)` already-decided rather than the raw
 * series.
 */

export interface FeeHistoryRecord {
  /** Hex height of the oldest block in the returned window. */
  readonly oldestBlock: string;
  /**
   * `blockCount + 1` entries: per-block base fee plus the predicted base
   * fee for the next block (the trailing entry is the floor for a Type-2
   * tx's `maxFeePerGas`). All values in wei.
   */
  readonly baseFeePerGas: readonly bigint[];
  /** Per-block ratio of `gasUsed / gasLimit` ∈ [0, 1]. */
  readonly gasUsedRatio: readonly number[];
  /**
   * `reward[i][j]` = j-th requested percentile of priority tips paid in
   * block `oldestBlock + i`. Absent when no percentiles were requested.
   */
  readonly reward?: readonly (readonly bigint[])[];
}

/** Speed preference for the derived `suggestFees()` helper. */
export type FeeSpeed = 'slow' | 'normal' | 'fast';

export interface SuggestedFees {
  /** EIP-1559 maxFeePerGas, in wei. */
  readonly maxFeePerGas: bigint;
  /** EIP-1559 maxPriorityFeePerGas (tip), in wei. */
  readonly maxPriorityFeePerGas: bigint;
  /** Trailing predicted base fee — the floor used to compute maxFeePerGas. */
  readonly nextBlockBaseFee: bigint;
}

export interface FeeEstimatorPort {
  /**
   * Current effective gas price, in wei. Tracks `eth_gasPrice` —
   * approximately `base_fee + suggested_tip`. Use this only for legacy
   * single-field txs; prefer `suggestFees()` for Type-2 builders.
   */
  gasPrice(): Promise<bigint>;

  /** Suggested priority tip (`maxPriorityFeePerGas`), in wei. */
  maxPriorityFeePerGas(): Promise<bigint>;

  /**
   * Fee-history window for client-side base-fee modelling.
   * @param blockCount - 1..1024
   * @param newestBlock - hex block height or `"latest"`
   * @param rewardPercentiles - e.g. `[25, 50, 75]` for slow/normal/fast tips
   */
  feeHistory(
    blockCount: number,
    newestBlock?: string,
    rewardPercentiles?: number[],
  ): Promise<FeeHistoryRecord>;

  /**
   * Convenience: combine `feeHistory` (last 4 blocks, 25/50/75 percentile)
   * with the trailing predicted base fee to suggest
   * `(maxFeePerGas, maxPriorityFeePerGas)`. Falls back to `gasPrice()`
   * when fee history is unavailable.
   */
  suggestFees(speed?: FeeSpeed): Promise<SuggestedFees>;
}
