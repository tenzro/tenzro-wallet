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
 * Writes are CreateEscrow/ReleaseEscrow/RefundEscrow typed transactions the
 * holder signs (`TypedTxClient.send`); the signer's account is the payer.
 * Reads go through the SDK's `SettlementClient`.
 */

export type EscrowReleaseMode =
  | 'timeout'
  | 'provider'
  | 'consumer'
  | 'both'
  | 'verifier'
  | 'custom';

export interface CreateEscrowRequest {
  /** Recipient account on successful release (32-byte hex). */
  readonly payee: string;
  /** Amount to lock (smallest unit; 1 TNZO = 10^18 wei). */
  readonly amount: bigint;
  /** Asset id, e.g. "TNZO". */
  readonly asset: string;
  /** USD price of the amount in micro-units; required for an asset other than TNZO. */
  readonly usdE6?: bigint;
  /** Unix-ms expiry. After this, refund unlocks (with appropriate mode). */
  readonly expiresAt: bigint;
  readonly releaseMode: EscrowReleaseMode;
  /** The condition text, required when `releaseMode` is `custom`. */
  readonly customCondition?: string;
}

/** A signature over a service proof, by one of the escrow's parties. */
export interface ServiceProofSignature {
  /** Signer account (32-byte hex). */
  readonly signer: string;
  /** Signature bytes (hex). */
  readonly signature: string;
  /** The signer's role as the network names it, e.g. "Provider". */
  readonly role: string;
}

/** Proof of service a release carries. */
export interface ServiceProof {
  /** Proof type as the network names it, e.g. "Cryptographic". */
  readonly proofType: string;
  /** Proof bytes (hex). */
  readonly proofData: string;
  readonly signatures?: readonly ServiceProofSignature[];
  /** Attestation bytes (hex). */
  readonly attestation?: string;
}

export interface ReleaseEscrowRequest {
  /** 32-byte escrow id (hex with or without `0x`). */
  readonly escrowId: string;
  readonly proof: ServiceProof;
}

export interface RefundEscrowRequest {
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

  /**
   * Enumerate all escrows where `payer` is the locker. Backed by the
   * `escrow_payer:` secondary index in CF_SETTLEMENTS. Order is unspecified.
   * Returns `[]` if the payer has no escrows.
   */
  listByPayer(payer: string): Promise<EscrowRecord[]>;

  /**
   * Enumerate all escrows where `payee` is the destination on release. Backed
   * by the `escrow_payee:` secondary index in CF_SETTLEMENTS. Order is
   * unspecified. Returns `[]` if the payee has none.
   */
  listByPayee(payee: string): Promise<EscrowRecord[]>;
}
