/**
 * CaipPort — chain-agnostic identifiers per the submitted `tenzro` CASA
 * namespace (`ChainAgnostic/namespaces#184`).
 *
 * - CAIP-2 chain id: `tenzro:<lowercase hex of first 16 bytes of
 *   genesis block hash>`. An EVM-compatible `evm_chain_id` sidecar is
 *   returned for tooling that needs the 64-bit EIP-155 chain id.
 * - CAIP-10 account id: accepts hex or base58btc input, normalises to
 *   canonical 64-hex Tenzro address form.
 * - CAIP-19 asset id: `slip44` (SLIP-44 coin index 1414421071),
 *   `token` (Tenzro token registry id, 32-byte hex), or `nft`
 *   (collection id + nft_token_id suffix).
 *
 * Wallet usage: the dApp connect / agent handshake flows return CAIP
 * identifiers so the host can present an unambiguous chain + account
 * label in every UI surface.
 */

export interface Caip2Info {
  readonly chain_id: string;
  readonly namespace: string;
  readonly reference: string;
  readonly evm_chain_id: number;
}

export interface Caip10Info {
  readonly account_id: string;
  readonly chain_id: string;
  readonly address: string;
}

export interface Caip19Request {
  /** One of `"slip44"`, `"token"`, `"nft"`. */
  readonly kind: 'slip44' | 'token' | 'nft' | string;
  readonly token_id?: string;
  readonly collection_id?: string;
  readonly nft_token_id?: string;
}

export interface Caip19Info {
  readonly asset_id: string;
  readonly chain_id: string;
  readonly asset_namespace: string;
  readonly asset_reference: string;
  readonly token_id?: string | null;
}

export interface CaipPort {
  caip2(): Promise<Caip2Info>;
  caip10(address: string): Promise<Caip10Info>;
  caip19(params: Caip19Request): Promise<Caip19Info>;
}
