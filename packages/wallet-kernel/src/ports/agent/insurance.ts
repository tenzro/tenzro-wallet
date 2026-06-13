/**
 * InsurancePort — claims filed against an Agent-Swarm Spec 9 AgentBond
 * and paid out from the protocol insurance pool vault.
 *
 * A claimant submits `{ against_agent_did, amount_requested, receipt_refs,
 * narrative? }`; the node returns a `ClaimRecord` with a deterministic
 * `claim_id` (`SHA-256("tenzro/insurance-claim/id" || claimant_did ||
 * against_agent_did || nonce_le)`). The claim then flows through
 * governance — `Open → Approved | Rejected → Paid` — with payout
 * sourced from the pool vault
 * (`Address(SHA-256("tenzro/insurance-pool/vault" || pool_id))`).
 *
 * The wallet wraps the SDK's `InsuranceClient`. All methods are read +
 * the file-claim endpoint; approval/payout are governance-driven on the
 * node side.
 */

export type ClaimStatus = 'open' | 'approved' | 'rejected' | 'paid';

export interface InsuranceClaimRecord {
  /** 32-byte deterministic claim id (lowercase hex). */
  readonly claimId: string;
  /** DID that filed the claim. */
  readonly claimantDid: string;
  /** Address that will be credited when status reaches `paid`. */
  readonly claimantAddress: string;
  /** DID of the agent the claim is filed against. */
  readonly againstAgentDid: string;
  /** Amount requested, in TNZO base units. */
  readonly amountRequested: bigint;
  /**
   * Spec 5 receipt references — on-chain anchored evidence the
   * governance proposal will be evaluated against.
   */
  readonly receiptRefs: readonly string[];
  /** Optional free-form description (capped 1024 bytes by the RPC). */
  readonly narrative?: string;
  readonly status: ClaimStatus;
  /** Governance proposal id, if one has been opened. */
  readonly governanceRef?: string;
  /** Set when status === 'paid'. */
  readonly paidAmount?: bigint;
  /** Unix-ms when the claim was filed. */
  readonly filedAt: number;
}

export interface FileInsuranceClaimRequest {
  readonly claimantDid: string;
  readonly claimantAddress: string;
  readonly againstAgentDid: string;
  readonly amountRequested: bigint;
  /** Per-claimant nonce — folded into the deterministic claim id. */
  readonly nonce: number;
  readonly receiptRefs: readonly string[];
  readonly narrative?: string;
}

export interface InsurancePort {
  /** File a claim against an agent's bond. Returns the filed record. */
  fileClaim(req: FileInsuranceClaimRequest): Promise<InsuranceClaimRecord>;

  /** Inspect a claim by its 32-byte id. Returns null if unknown. */
  get(claimId: string): Promise<InsuranceClaimRecord | null>;

  /** Enumerate every claim known to the node. */
  list(): Promise<InsuranceClaimRecord[]>;

  /**
   * Current TNZO balance held in the insurance pool vault, in base
   * units. Useful for the wallet UI to display "claim affordable" hints.
   */
  poolBalance(): Promise<bigint>;
}
