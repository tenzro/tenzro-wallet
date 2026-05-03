/**
 * Erc8004Port — agent identity / reputation / validation registries on EVM.
 *
 * ERC-8004 went mainnet on January 29 2026. Three registries:
 *   • IdentityRegistry  — ERC-721 NFT-style agent ids
 *   • ReputationRegistry — feedback (0-100 score + auth id + URI)
 *   • ValidationRegistry — third-party validation requests/responses
 *
 * The Tenzro SDK's `Erc8004Client` only ABI-encodes / decodes; it never
 * holds keys or signs. The wallet kernel takes the calldata produced here
 * and routes it through the existing `evm-on-tenzro` surface (real
 * EIP-1559 + secp256k1 signing already lives there). That keeps signing
 * in one place and lets the wallet treat ERC-8004 as "just another EVM
 * call."
 *
 * The wallet does NOT re-implement registry semantics; it consumes the
 * SDK encoder/decoder via this port and signs the resulting calldata.
 */

/** 32-byte hex agent id (ERC-721 token id, padded). */
export type Erc8004AgentIdHex = `0x${string}`;

/** Result of `deriveAgentId` — owner+salt are echoed back for round-tripping. */
export interface Erc8004DerivedAgentId {
  readonly agentId: Erc8004AgentIdHex;
  readonly owner: `0x${string}`;
  readonly salt: `0x${string}`;
}

/** Hex-encoded ABI calldata ready for `eth_sendTransaction` or `eth_call`. */
export interface Erc8004Calldata {
  /** 4-byte function selector. */
  readonly selector: `0x${string}`;
  /** Full hex calldata: selector + ABI-encoded args. */
  readonly calldata: `0x${string}`;
}

/** Decoded agent record returned by `IdentityRegistry.getAgent()`. */
export interface Erc8004Agent {
  readonly registrationDataUri: string;
  readonly owner: `0x${string}`;
}

export interface Erc8004Port {
  /** Derive `keccak256(abi.encode("TENZRO_ERC8004_AGENT", owner, salt))`. */
  deriveAgentId(
    owner: `0x${string}`,
    salt: `0x${string}`,
  ): Promise<Erc8004DerivedAgentId>;

  /** Encode `IdentityRegistry.register(agentId, registrationDataURI, owner)`. */
  encodeRegister(
    agentId: Erc8004AgentIdHex,
    registrationDataUri: string,
    owner: `0x${string}`,
  ): Promise<Erc8004Calldata>;

  /** Encode `IdentityRegistry.getAgent(agentId)`. Use with `eth_call`. */
  encodeGetAgent(agentId: Erc8004AgentIdHex): Promise<Erc8004Calldata>;

  /** Decode return data from a `getAgent()` `eth_call`. */
  decodeGetAgent(returndata: `0x${string}`): Promise<Erc8004Agent>;

  /** Encode `ReputationRegistry.submitFeedback(agentId, score, authId, uri)`.
   *  `score` must be 0–100. */
  encodeFeedback(
    agentId: Erc8004AgentIdHex,
    score: number,
    feedbackAuthId: string,
    feedbackUri: string,
  ): Promise<Erc8004Calldata>;

  /** Encode `ValidationRegistry.requestValidation(agentId, validatorId, uri, dataHash)`. */
  encodeRequestValidation(
    agentId: Erc8004AgentIdHex,
    validatorId: string,
    requestUri: string,
    dataHash: `0x${string}`,
  ): Promise<Erc8004Calldata>;

  /** Encode `ValidationRegistry.submitValidation(dataHash, response, uri, tag)`.
   *  `response` is a 0–100 score. */
  encodeSubmitValidation(
    dataHash: `0x${string}`,
    response: number,
    responseUri: string,
    tag: string,
  ): Promise<Erc8004Calldata>;
}
