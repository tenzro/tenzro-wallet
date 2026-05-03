/**
 * HtlcEscrowPort — hashed-timelock cross-chain escrow (v2-pending).
 *
 * Per DESIGN.md §11.7: cross-chain escrow is punted for v1 (the wallet
 * uses AP2 + bridge). The v2 plan is hashed-timelock-style: lock funds
 * on Tenzro under a secret hash + expiry, the counterparty unlocks on
 * Canton on proof of delivery, then redeems the Tenzro side by revealing
 * the preimage. If the timeout elapses without redemption, the payer
 * refunds.
 *
 * **Status (2026-05):** port shape only. No adapter, no kernel wiring.
 * Gated on:
 *   1. Splice allocation-contract maturity for the Canton-side commitment
 *      (the receiving side needs a Canton primitive that emits a verifiable
 *      "delivered" event the Tenzro VM can accept as the unlock witness).
 *   2. A Tenzro VM tx_type for HTLC create/redeem/refund (the existing
 *      `EscrowPort` is single-chain; HTLC needs new selectors that bind
 *      the secret hash + counter-chain proof shape).
 *   3. `tenzro-sdk` exposing the corresponding client methods.
 *
 * Wire shape pinned now so the v2 implementation can light up an adapter
 * without re-shaping the consumers.
 */

export type HtlcStatus =
  | 'locked'
  | 'redeemed'
  | 'refunded'
  | 'expired'
  /** Timed out but neither redeemed nor refunded yet — payer can refund. */
  | 'timeout-pending';

export interface HtlcLockRequest {
  /** Source payer address (Tenzro side). */
  readonly payer: string;
  /** Destination payee — typically a Canton party id or external address;
   *  opaque to the kernel, the SDK validates against the chosen corridor. */
  readonly payee: string;
  /** Amount in smallest units. */
  readonly amount: bigint;
  /** Asset id (e.g. "TNZO", "USDC-on-Tempo"). */
  readonly asset: string;
  /**
   * SHA-256 of the secret preimage. The redeemer reveals the preimage on
   * the destination chain; the wallet uses the same preimage to unlock the
   * Tenzro side. 32 raw bytes (not hex).
   */
  readonly secretHash: Uint8Array;
  /** Unix-ms expiry. After this, only `refund` is callable. */
  readonly expiresAt: number;
  /**
   * Counter-chain corridor identifier — `'canton-mainnet'`, `'ethereum'`,
   * etc. The SDK validates the payee shape against the corridor.
   */
  readonly destinationCorridor: string;
}

export interface HtlcLockResult {
  readonly htlcId: string;
  readonly txHash: string;
  readonly status: HtlcStatus;
}

export interface HtlcRedeemRequest {
  readonly htlcId: string;
  /** Raw secret preimage — SHA-256 over this must equal `secretHash`. */
  readonly secret: Uint8Array;
  /**
   * Proof-of-delivery from the destination chain. Shape depends on the
   * corridor (Canton command-completion, EVM event log, etc.). Opaque to
   * the kernel; the VM verifies it via the corridor's light-client logic.
   */
  readonly proof: Readonly<Record<string, unknown>>;
}

export interface HtlcRefundRequest {
  readonly htlcId: string;
  /** Refund is only legal after `expiresAt`; the VM enforces. */
}

export interface HtlcRecord {
  readonly htlcId: string;
  readonly payer: string;
  readonly payee: string;
  readonly amount: bigint;
  readonly asset: string;
  readonly secretHash: Uint8Array;
  readonly expiresAt: number;
  readonly destinationCorridor: string;
  readonly status: HtlcStatus;
}

export interface HtlcEscrowPort {
  /** Lock funds on Tenzro under the secret hash + expiry. */
  lock(req: HtlcLockRequest): Promise<HtlcLockResult>;
  /** Redeem the lock by revealing the preimage + counter-chain proof. */
  redeem(req: HtlcRedeemRequest): Promise<{ readonly txHash: string }>;
  /** Refund after expiry. Only the original payer can call. */
  refund(req: HtlcRefundRequest): Promise<{ readonly txHash: string }>;
  get(htlcId: string): Promise<HtlcRecord | null>;
}
