/**
 * SecureMintPort — per-token 1:1 reserve-attestation invariant for
 * tokenized real-world assets (xStocks-class equities, treasuries,
 * stablecoins). Enforces `circulating + amount ≤ reserve` at every mint.
 *
 * Policies are keyed on-chain by the token's 20-byte EVM address;
 * `assetId` is a human-readable label (ISIN, symbol).
 *
 * Wallet usage: the wallet does not mint RWAs itself, but it surfaces
 * the policy + reserve state for assets the user holds and lets the
 * issuer's UI check / apply the invariant.
 */

export interface SecureMintPolicy {
  /** Token's 20-byte EVM address (hex, `0x`-prefixed). Primary key. */
  readonly token: string;
  /** Human-readable asset label (e.g. ISIN, symbol). */
  readonly assetId: string;
  /** Attested reserve, base units. */
  readonly reserve: bigint;
  /** Current circulating supply, base units. */
  readonly circulating?: bigint;
  /** Proof-of-reserve feed id this policy reads from. */
  readonly porFeedId: string;
  /** Attester DID whose attestation gates this policy. */
  readonly attesterDid: string;
  /** 32-byte attestation hash (hex, `0x`-prefixed). */
  readonly attestationHash: string;
  /** Unix seconds the attestation was made. */
  readonly attestedAt: number;
  /** Attestation freshness window in seconds. */
  readonly ttlSecs: number;
}

/** Read-only invariant test result. */
export interface SecureMintCheck {
  readonly allowed: boolean;
  readonly token: string;
  readonly amount: bigint;
  /** Unix seconds the node evaluated the check. */
  readonly now: number;
  readonly reason?: string;
}

/** Invariant test + circulating-supply mutation result. */
export interface SecureMintApply {
  readonly applied: boolean;
  readonly token: string;
  readonly amount: bigint;
  readonly policy: SecureMintPolicy;
}

export interface SecureMintPort {
  /** Install or refresh a token's reserve-attestation policy. */
  setPolicy(policy: SecureMintPolicy): Promise<SecureMintPolicy>;
  /** Read the active policy for a token's EVM address. Null if unset. */
  getPolicy(token: string): Promise<SecureMintPolicy | null>;
  /** Drop the policy for a token. Returns true if one was cleared. */
  clearPolicy(token: string): Promise<boolean>;
  /** Read-only: would minting `amount` of `token` stay within reserve? */
  checkMint(token: string, amount: bigint): Promise<SecureMintCheck>;
  /** Apply the invariant and increment circulating supply on success. */
  applyMint(token: string, amount: bigint): Promise<SecureMintApply>;
  /** Decrement circulating supply on redemption/burn. */
  recordBurn(token: string, amount: bigint): Promise<SecureMintApply>;
}
