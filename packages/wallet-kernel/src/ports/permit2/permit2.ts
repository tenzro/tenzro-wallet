/**
 * Permit2Port — EIP-712 SignatureTransfer over the canonical Tenzro
 * Permit2 contract (`0x0000…00001023`).
 *
 * Wallet usage: a user signs one EIP-712 message authorizing a token
 * transfer (optionally bound to a 32-byte witness — used by ERC-7683
 * origin opens to bind the permit to a specific cross-chain order).
 * The wallet asks the node for the domain separator + digest, signs
 * via the EVM custody quorum, then submits the verify-and-consume
 * call out of band.
 */

export interface Permit2DomainSeparator {
  readonly domain_separator: string;
  readonly verifying_contract: string;
  readonly chain_id: number;
}

export interface Permit2DigestRequest {
  readonly chain_id: number;
  readonly owner: string;
  readonly token: string;
  readonly amount: string;
  readonly spender: string;
  readonly nonce: string;
  readonly deadline: number;
  readonly witness?: string;
  readonly witness_type_string?: string;
}

export interface Permit2Digest {
  readonly digest: string;
  readonly struct_hash: string;
  readonly domain_separator: string;
}

export interface Permit2VerifyAndConsumeRequest extends Permit2DigestRequest {
  readonly signature: string;
}

export interface Permit2VerifyAndConsumeResult {
  readonly consumed: boolean;
  readonly word_pos: string;
  readonly bit_pos: number;
}

export interface Permit2NonceUsed {
  readonly used: boolean;
  readonly owner: string;
  readonly nonce: string;
}

export interface Permit2Port {
  domainSeparator(chainId: number): Promise<Permit2DomainSeparator>;
  digest(req: Permit2DigestRequest): Promise<Permit2Digest>;
  verifyAndConsume(
    req: Permit2VerifyAndConsumeRequest,
  ): Promise<Permit2VerifyAndConsumeResult>;
  nonceUsed(owner: string, nonce: string): Promise<Permit2NonceUsed>;
}
