/**
 * EscrowPort — native VM escrow primitive on Tenzro Ledger.
 *
 * Per `reference_tenzro_architecture.md` and SDK `settlement.ts`:
 *
 *   • CreateEscrow  selector 0x01000010, ~75k gas
 *   • ReleaseEscrow selector 0x01000011, ~60k gas
 *   • RefundEscrow  selector 0x01000012, ~50k gas
 *
 * Vault address is deterministic from `escrow_id`; only the original
 * payer can release or refund. Six release modes, all enforced VM-side.
 *
 * The wallet wraps the SDK's `SettlementClient`; the SDK already owns the
 * canonical CreateEscrow/ReleaseEscrow/RefundEscrow tx_type encoding and
 * routes through `tenzro_signAndSendTransaction` for hybrid signing.
 */

export type EscrowReleaseMode =
  | 'timeout'
  | 'provider'
  | 'consumer'
  | 'both'
  | 'verifier'
  | 'custom';

export interface CreateEscrowRequest {
  /** Payer address (the holder's MPC wallet address). */
  readonly payer: string;
  /** Recipient on successful release. */
  readonly payee: string;
  /** Amount to lock (smallest unit; 1 TNZO = 10^18 wei). */
  readonly amount: bigint;
  /** Asset id, e.g. "TNZO" or a token contract address. */
  readonly asset: string;
  /** Unix-ms expiry. After this, refund unlocks (with appropriate mode). */
  readonly expiresAt: bigint;
  readonly releaseMode: EscrowReleaseMode;
}

export interface ReleaseEscrowRequest {
  readonly payer: string;
  /** 32-byte escrow id (hex with or without `0x`). */
  readonly escrowId: string;
  /** Optional proof bytes (mode-specific). Hex with or without `0x`. */
  readonly proof?: string;
}

export interface RefundEscrowRequest {
  readonly payer: string;
  readonly escrowId: string;
}

export interface EscrowRecord {
  readonly escrowId: string;
  readonly payer: string;
  readonly payee: string;
  readonly amount: bigint;
  readonly asset: string;
  readonly expiresAt: number;
  readonly releaseMode: EscrowReleaseMode;
  readonly status: 'active' | 'released' | 'refunded' | 'expired';
}

export interface EscrowPort {
  /** Lock funds. Returns the submission tx hash. */
  create(req: CreateEscrowRequest): Promise<string>;

  /** Release locked funds to the payee. Returns the tx hash. */
  release(req: ReleaseEscrowRequest): Promise<string>;

  /** Refund locked funds back to the payer. Returns the tx hash. */
  refund(req: RefundEscrowRequest): Promise<string>;

  /** Inspect an escrow record. Returns null if unknown. */
  get(escrowId: string): Promise<EscrowRecord | null>;
}
