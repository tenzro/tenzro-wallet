/**
 * Erc7683Port — ERC-7683 cross-chain intents settler surface.
 *
 * Wallet usage: the wallet does NOT fill orders; it (1) signs the
 * origin-side open via Permit2 + witness, (2) surfaces order state and
 * fill receipts to the user, and (3) optionally co-signs a destination-
 * side fill record if the host is itself a filler.
 *
 * Order state machine: Open → AwaitingProof → Settled / Refunded /
 * ForceRefundEligible.
 */

export interface Erc7683Output {
  readonly chain: number;
  readonly token: string;
  readonly amount: string;
  readonly recipient: string;
}

export interface RecordFillRequest {
  readonly orderId: string;
  readonly originChainId: number;
  readonly originSettler: string;
  readonly filler: string;
  readonly recipient: string;
  readonly fillTxHash: string;
  readonly filledAtMs: number;
  readonly proofRoute: 'layerzero' | 'wormhole' | 'debridge' | 'hyperlane' | string;
  readonly outputs: readonly Erc7683Output[];
}

export interface ListOrdersOpts {
  readonly state?: string;
  readonly destChain?: number;
  readonly limit?: number;
}

/**
 * BridgeFeeHint — optional addition to TenzroOrderData that lets a
 * single user-signed order be filled by any of the 6 supported
 * bridges. The TNZO ceiling bounds the solver's destination-native
 * fee commitment. The wallet UI surfaces this so the signer can
 * see what TNZO ceiling they're authorizing.
 */
export interface BridgeFeeHint {
  /** Reference quote id from the BridgeFeeOracle (auditable). */
  readonly quoteIdHex: string;
  /** TNZO ceiling the swapper authorized for the destination fee. */
  readonly tnzoAmountWei: string;
  /** Wall-clock expiry — solvers MUST NOT execute fills after expiry. */
  readonly validUntilMs: number;
  /** Adapter the swapper had in mind at quote time (advisory). */
  readonly preferredAdapter: string;
}

export interface Erc7683Port {
  getOrder(orderId: string): Promise<unknown>;
  listOrders(opts?: ListOrdersOpts): Promise<unknown>;
  recordFill(args: RecordFillRequest): Promise<unknown>;
  getFill(orderId: string, originChainId: number): Promise<unknown>;
  listFills(): Promise<unknown>;
}
