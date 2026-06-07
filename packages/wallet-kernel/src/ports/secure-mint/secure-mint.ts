/**
 * SecureMintPort — per-token 1:1 reserve-attestation invariant for
 * tokenized real-world assets (xStocks-class equities, treasuries,
 * stablecoins). Enforces `circulating + amount ≤ reserve` at every mint.
 *
 * Wallet usage: the wallet does not mint RWAs itself, but it surfaces
 * the policy + reserve state for assets the user holds and lets the
 * issuer's UI check / apply the invariant.
 */

export interface SecureMintPolicy {
  readonly asset_id: string;
  readonly reserve: string;
  readonly circulating?: string;
  readonly por_feed_id: string;
  readonly attester_did: string;
  readonly attestation_hash: string;
  readonly attested_at: number;
  readonly ttl_secs: number;
}

export interface SecureMintCheck {
  readonly would_succeed: boolean;
  readonly reserve: string;
  readonly circulating: string;
  readonly headroom: string;
  readonly reason?: string | null;
}

export interface SecureMintApply {
  readonly asset_id: string;
  readonly new_circulating: string;
  readonly reserve: string;
}

export interface SecureMintPort {
  setPolicy(policy: SecureMintPolicy): Promise<SecureMintPolicy>;
  getPolicy(assetId: string): Promise<SecureMintPolicy | null>;
  clearPolicy(assetId: string): Promise<unknown>;
  checkMint(assetId: string, amount: string): Promise<SecureMintCheck>;
  applyMint(assetId: string, amount: string): Promise<SecureMintApply>;
  recordBurn(assetId: string, amount: string): Promise<SecureMintApply>;
}
