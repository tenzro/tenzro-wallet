/**
 * Eip7702Port — EIP-7702 (Pectra Type-4) Set EOA Account Code helpers.
 *
 * Wallet usage: lets an EOA temporarily delegate its code to a smart-
 * contract address. The 23-byte designator (`0xef0100 || delegate`) is
 * written into the EOA's code slot once the authorization (signed
 * client-side by the EOA's secp256k1 key) is accepted.
 *
 * The wallet:
 *   - asks the node for the signing hash,
 *   - signs it with the EOA's secp256k1 key (via the custody quorum),
 *   - submits the authorization out of band,
 *   - parses delegate codes on incoming accounts to flag delegated EOAs.
 */

export interface Eip7702SigningHash {
  readonly signing_hash: string;
  readonly signing_data: string;
  readonly magic_byte: string;
}

export interface Eip7702Designator {
  readonly designator: string;
  readonly length: number;
  readonly prefix: string;
  readonly delegate_address: string;
}

export interface Eip7702ParsedDesignator {
  readonly is_designator: boolean;
  readonly delegate_address: string | null;
}

export interface Eip7702ProtocolInfo {
  readonly tx_type: number;
  readonly magic_byte: string;
  readonly designator_prefix: string;
  readonly designator_length: number;
  readonly signing_scheme: string;
  readonly signature_format: string;
  readonly preimage: string;
  readonly note: string;
}

export interface Eip7702Port {
  signingHash(
    chainId: number,
    delegateAddress: string,
    nonce: number,
  ): Promise<Eip7702SigningHash>;
  buildDesignator(delegateAddress: string): Promise<Eip7702Designator>;
  parseDesignator(code: string): Promise<Eip7702ParsedDesignator>;
  protocolInfo(): Promise<Eip7702ProtocolInfo>;
}
