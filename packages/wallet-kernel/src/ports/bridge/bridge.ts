/**
 * BridgeRoutePort — cross-chain bridge route abstraction (M8 milestone).
 *
 * The kernel never picks a bridge itself; it asks each registered adapter
 * for a quote and lets the consumer (router UI / agent policy) pick the
 * winner. Adapters wrap third-party SDKs (LI.FI, CCIP, LayerZero) — none
 * of which are browser-clean as a class. Each adapter file in
 * `./adapters/` lives as a stub (`*-pending.ts`-style: shape + throws)
 * until the third-party SDK shape is pinned and we decide whether to
 * embed via dynamic import, run server-side, or wrap a Tenzro RPC proxy.
 *
 * Per DESIGN.md §10 milestone 8 — "mostly assembly", not new design work.
 *
 * Per `reference_agentic_payments_2026.md`: the wallet's *unique* multi-VM
 * value lands at the kernel's route layer (one consent flow across
 * EVM/SVM/Canton/Tenzro), so we keep the *port* shape stable now even
 * though the adapters wait for M8.
 */

/**
 * Vendor adapters Tenzro's BridgeRouter supports (per docs/bridge):
 *   - `lifi` — LI.FI aggregator (27+ bridges, 58+ chains)
 *   - `ccip` — Chainlink CCIP (DON-verified)
 *   - `layerzero` — LayerZero v2 (cross-chain messaging)
 *   - `wormhole` — Wormhole (rolled out in the latest Tenzro update)
 *   - `debridge` — deBridge DLN (intent-based, post-fulfilment hooks)
 *   - `canton` — Canton-side adapter for Canton/external-chain corridors
 */
export type BridgeAdapterId = 'lifi' | 'ccip' | 'layerzero' | 'wormhole' | 'debridge' | 'canton';

/**
 * Identifies a destination chain in a bridge-vendor-neutral way. The
 * adapter maps this onto the vendor's own ID space (LI.FI uses chain ids,
 * CCIP uses 64-bit selectors, LayerZero uses endpoint ids — the kernel
 * does not care).
 */
export interface BridgeChainRef {
  /**
   * Tenzro-side surface name when the source/destination is on Tenzro.
   * For external chains, this is the canonical chain slug
   * (`'ethereum'`, `'polygon'`, `'solana'`, `'canton-mainnet'`, etc.).
   */
  readonly chain: string;
  /**
   * Optional — chain id (EVM 1, 137; non-EVM "solana"). Carried only when
   * the adapter needs it; canonical chain slug above is the primary key.
   */
  readonly chainId?: number;
}

export interface BridgeQuoteRequest {
  readonly fromChain: BridgeChainRef;
  readonly toChain: BridgeChainRef;
  /** Sender address (chain-native shape). */
  readonly fromAddress: string;
  /** Receiver address (chain-native shape). */
  readonly toAddress: string;
  /** Asset on the source side. Adapter resolves the destination asset. */
  readonly fromAsset: string;
  /** Decimal amount in source-asset smallest units. */
  readonly amount: bigint;
  /**
   * Optional preference — caller can ask for the cheapest, fastest, or
   * lowest-trust route. Adapters may ignore unknown values and return
   * their default ordering.
   */
  readonly prefer?: 'cheapest' | 'fastest' | 'safest';
}

export interface BridgeQuote {
  readonly adapter: BridgeAdapterId;
  /** Estimated arrival on destination, in source-asset smallest units. */
  readonly toAmount: bigint;
  /** Estimated total fees in source-asset smallest units. */
  readonly fees: bigint;
  /** ETA in seconds. */
  readonly etaSec: number;
  /** Adapter-specific opaque payload — the wallet hands it back to `build`. */
  readonly opaque: Readonly<Record<string, unknown>>;
  /**
   * One-line human description shown in the route picker
   * (e.g. "LI.FI · Stargate USDC · ~30s · $0.42").
   */
  readonly summary: string;
}

export interface BridgeBuildRequest {
  /** A `BridgeQuote.opaque` returned by the same adapter. */
  readonly opaque: Readonly<Record<string, unknown>>;
}

/**
 * The transactions the wallet must sign + submit to start the bridge. The
 * kernel hands these to the source surface for signing; the adapter does
 * NOT sign on its own. Most adapters return one tx; some (e.g. ERC-20
 * approve + bridge call) return two.
 */
export interface BridgeBuildResult {
  readonly transactions: ReadonlyArray<{
    readonly chain: string;
    /**
     * Surface-shaped tx body — opaque to the kernel. EVM bridges return
     * `{ to, data, value }`; SVM bridges return `{ instructions: [...] }`;
     * Canton bridges return `{ command: ... }`. The source surface narrows.
     */
    readonly body: Readonly<Record<string, unknown>>;
    /** Free-form label for the consent screen ("Approve USDC", "Bridge"). */
    readonly label: string;
  }>;
  /** Bridge identifier the adapter uses to track delivery. */
  readonly trackerId: string;
}

export type BridgeStatusPhase = 'pending-source' | 'in-flight' | 'delivered' | 'failed';

export interface BridgeStatus {
  readonly trackerId: string;
  readonly phase: BridgeStatusPhase;
  /** Source-chain tx hash, when known. */
  readonly sourceTx?: string;
  /** Destination-chain tx hash, when known. */
  readonly destinationTx?: string;
  readonly error?: string;
}

export interface BridgeRoutePort {
  readonly adapterId: BridgeAdapterId;
  quote(req: BridgeQuoteRequest): Promise<BridgeQuote>;
  build(req: BridgeBuildRequest): Promise<BridgeBuildResult>;
  track(trackerId: string): AsyncIterable<BridgeStatus>;
}
