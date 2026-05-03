/**
 * Erc7802Port — SuperchainERC20 cross-chain supply consistency.
 *
 * ERC-7802 lets a token minted on chain A be burned on chain A and
 * re-minted on chain B, keeping total supply constant across chains.
 * Tenzro's BridgeRouter uses this for native cross-chain TNZO and
 * compatible SuperchainERC20s; the wallet exposes it so dApps can
 * bypass aggregators when the asset itself implements ERC-7802.
 *
 * **Implementation note (2026-05).** `tenzro-sdk@0.1.0` `Erc7802Client`
 * actually performs the operation server-side via the node's
 * `tenzro_signAndSendTransaction` hybrid-signing path — it does not
 * return raw calldata. The wallet kernel's `Erc7802Port` mirrors that
 * shape: callers receive a `tx_hash` directly, no `prepare → sign →
 * submit` lifecycle to drive on the wallet side. This is consistent
 * with how `client.sendTransaction` works for native TNZO transfers
 * (the wallet's keys live in the node TEE; the wire never carries them).
 *
 * SDK methods (per `tenzro-sdk` `src/erc7802.ts`):
 *   - `client.erc7802().crosschainMint(token, recipient, amount, sourceChain)`
 *   - `client.erc7802().crosschainBurn(token, from, amount, targetChain)`
 *   - `client.erc7802().getCrossChainSupply(token)`
 *
 * Tenzro RPC endpoints:
 *   - `tenzro_erc7802CrosschainMint`
 *   - `tenzro_erc7802CrosschainBurn`
 *   - `tenzro_erc7802GetCrossChainSupply`
 */

export interface Erc7802MintResult {
  /** Transaction hash on the destination chain (where the mint happened). */
  readonly txHash: string;
  readonly token: string;
  readonly recipient: string;
  /** Decimal amount string (matches SDK wire shape). */
  readonly amount: string;
  /** Source chain that authorised the mint. */
  readonly sourceChain: string;
  /** Mint status (`'pending'`, `'finalized'`, etc — SDK-defined). */
  readonly status: string;
}

export interface Erc7802BurnResult {
  /** Transaction hash on the source chain (where the burn happened). */
  readonly txHash: string;
  readonly token: string;
  readonly from: string;
  readonly amount: string;
  /** Target chain where the corresponding mint may happen. */
  readonly targetChain: string;
  /** Burn status (`'pending'`, `'finalized'`, etc — SDK-defined). */
  readonly status: string;
}

export interface Erc7802SupplyBreakdown {
  readonly token: string;
  /** Total supply across all chains, decimal string. */
  readonly totalSupply: string;
  /** Per-chain supply (chain slug → decimal string). */
  readonly chainSupplies: Readonly<Record<string, string>>;
}

export interface CrosschainMintRequest {
  readonly token: string;
  /** Recipient address on the chain where minting happens. */
  readonly recipient: string;
  /** Decimal amount string in token smallest units. */
  readonly amount: string;
  /** Source chain slug that authorises this mint (must show a prior burn). */
  readonly sourceChain: string;
}

export interface CrosschainBurnRequest {
  readonly token: string;
  /** Address whose balance is debited on the current chain. */
  readonly from: string;
  /** Decimal amount string in token smallest units. */
  readonly amount: string;
  /** Target chain slug where re-minting will be authorised. */
  readonly targetChain: string;
}

export interface Erc7802Port {
  /**
   * Burn `amount` of `token` from the current chain, authorising a
   * crosschain mint on `targetChain`. Returns the source-chain tx hash;
   * the destination-chain mint is driven by `crosschainMint` once the
   * messenger has propagated the burn.
   */
  crosschainBurn(req: CrosschainBurnRequest): Promise<Erc7802BurnResult>;

  /**
   * Mint `amount` of `token` on the current chain, authorised by a prior
   * burn on `sourceChain`. The Tenzro node validates the source-chain
   * burn proof through the SuperchainERC20 messenger before signing.
   */
  crosschainMint(req: CrosschainMintRequest): Promise<Erc7802MintResult>;

  /** Per-chain supply breakdown for a SuperchainERC20 token. */
  getCrossChainSupply(token: string): Promise<Erc7802SupplyBreakdown>;
}
