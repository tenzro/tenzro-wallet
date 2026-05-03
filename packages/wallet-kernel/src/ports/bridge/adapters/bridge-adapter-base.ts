/**
 * Shared body for the wallet's per-vendor bridge adapters. Each adapter
 * (LI.FI, CCIP, LayerZero, Wormhole, deBridge, Canton) is the wallet's
 * UX-side abstraction — one row in the route picker per vendor. Under
 * the hood they all forward to the same `tenzro-sdk` `BridgeClient`,
 * filtering by `adapter` (the SDK's name for `vendor`).
 *
 * SDK shape this targets (verified against `tenzro-sdk@0.1.0`
 * `src/bridge.ts`):
 *
 *   - `client.bridge().getRoutes(fromChain, toChain, token?)`
 *      → `BridgeRoute[]` (one entry per available vendor; the wallet
 *      filters to its own `adapterId` and synthesises the `BridgeQuote`).
 *   - `client.bridge().bridgeTokens(fromChain, toChain, token, amount,
 *      recipient, adapter?)`
 *      → `BridgeTransfer { id, sourceChain, targetChain, assetId, amount,
 *      sender, recipient, status, txHash, bridgeFee, completedAt? }`.
 *      The wallet maps this to a `BridgeBuildResult` whose single
 *      transaction wraps the SDK-returned tx hash for surface display.
 *   - `client.bridge().getTransferStatus(transferId)`
 *      → `TransferStatus { transfer_id, status, source_tx_hash?,
 *      destination_tx_hash?, updated_at }`.
 *      The wallet wraps this in an async-iterable that polls until a
 *      terminal phase (`delivered` / `failed`).
 *
 * The wallet's `BridgeRoutePort` surface (quote → build → track) is
 * UX-shaped; it doesn't perfectly match the SDK's flatter API. The
 * adapter does the mapping:
 *
 *   - `quote()` calls `getRoutes()` and finds the entry matching
 *     `adapterId`. The route's `opaque` payload carries the original
 *     request fields the wallet needs to call `bridgeTokens` later.
 *   - `build()` reads the `opaque` payload, calls `bridgeTokens`,
 *     and returns the SDK transfer's `id` as `trackerId`.
 *   - `track()` polls `getTransferStatus(trackerId)` on a 2 s tick
 *     until the transfer is `delivered` or `failed`.
 */

import type { BridgeClient } from 'tenzro-sdk';
import type {
  BridgeAdapterId,
  BridgeBuildRequest,
  BridgeBuildResult,
  BridgeQuote,
  BridgeQuoteRequest,
  BridgeRoutePort,
  BridgeStatus,
  BridgeStatusPhase,
} from '../bridge.ts';

/**
 * Type alias for the SDK's `BridgeClient`. We take a structural
 * super-type for testability (the test suite injects a fake), but the
 * real adapter accepts the SDK class instance as-is.
 */
export type BridgeClientLike = Partial<
  Pick<
    BridgeClient,
    'getRoutes' | 'bridgeTokens' | 'getTransferStatus' | 'listAdapters'
  >
>;

/** Fields the adapter stashes in `BridgeQuote.opaque` so `build()` can
 *  reconstruct the `bridgeTokens` call without round-tripping the user. */
interface OpaqueBuildPayload {
  readonly fromChain: string;
  readonly toChain: string;
  readonly token: string;
  readonly amount: string;
  readonly recipient: string;
}

/** Default poll interval for `track()` in milliseconds. */
const TRACK_POLL_MS = 2_000;

/** Default max polls before track() gives up (5 minutes at 2 s). */
const TRACK_MAX_POLLS = 150;

export function bridgeAdapterFromClient(
  vendor: BridgeAdapterId,
  client: BridgeClientLike | undefined,
): BridgeRoutePort {
  const pending = (method: string): Error =>
    new Error(
      `${vendor}BridgeAdapter.${method}: SDK pending — tenzro-sdk BridgeClient.${method} not yet wired (DESIGN.md §10.2 + §11.6)`,
    );

  return {
    adapterId: vendor,

    async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
      if (!client?.getRoutes) throw pending('getRoutes');
      const routes = await client.getRoutes(
        req.fromChain.chain,
        req.toChain.chain,
        req.fromAsset,
      );
      // SDK returns BridgeRoute[]; we filter to our vendor.
      const ours = routes.find(
        (r) => normaliseAdapterName(r.adapter) === vendor,
      );
      if (!ours) {
        throw new Error(
          `${vendor}BridgeAdapter.quote: vendor not in SDK route list for ` +
            `${req.fromChain.chain}→${req.toChain.chain} ${req.fromAsset}`,
        );
      }
      const opaque: OpaqueBuildPayload = {
        fromChain: req.fromChain.chain,
        toChain: req.toChain.chain,
        token: req.fromAsset,
        amount: req.amount.toString(),
        recipient: req.toAddress,
      };
      return {
        adapter: vendor,
        toAmount: req.amount, // SDK getRoutes doesn't quote toAmount — pass through.
        fees: BigInt(ours.estimated_fee ?? 0),
        etaSec: ours.estimated_time_secs ?? 0,
        opaque: opaque as unknown as Readonly<Record<string, unknown>>,
        summary: `${vendor} · ${req.fromAsset} · ~${ours.estimated_time_secs ?? '?'}s`,
      };
    },

    async build(req: BridgeBuildRequest): Promise<BridgeBuildResult> {
      if (!client?.bridgeTokens) throw pending('bridgeTokens');
      const o = req.opaque as unknown as OpaqueBuildPayload;
      const transfer = await client.bridgeTokens(
        o.fromChain,
        o.toChain,
        o.token,
        o.amount,
        o.recipient,
        vendor,
      );
      return {
        transactions: [
          {
            chain: o.fromChain,
            body: { txHash: transfer.txHash } as Readonly<
              Record<string, unknown>
            >,
            label: `Bridge ${o.token} via ${vendor}`,
          },
        ],
        trackerId: transfer.id,
      };
    },

    async *track(trackerId: string): AsyncIterable<BridgeStatus> {
      if (!client?.getTransferStatus) throw pending('getTransferStatus');
      let lastPhase: BridgeStatusPhase | null = null;
      for (let i = 0; i < TRACK_MAX_POLLS; i++) {
        const raw = await client.getTransferStatus(trackerId);
        const phase = normalisePhase(raw.status);
        // Always yield first poll; otherwise yield on phase change.
        if (lastPhase !== phase) {
          lastPhase = phase;
          yield {
            trackerId: raw.transfer_id ?? trackerId,
            phase,
            ...(raw.source_tx_hash !== undefined
              ? { sourceTx: raw.source_tx_hash }
              : {}),
            ...(raw.destination_tx_hash !== undefined
              ? { destinationTx: raw.destination_tx_hash }
              : {}),
          };
        }
        if (phase === 'delivered' || phase === 'failed') return;
        await sleep(TRACK_POLL_MS);
      }
    },
  };
}

function normaliseAdapterName(raw: string | undefined): string {
  return (raw ?? '').toLowerCase();
}

function normalisePhase(raw: string | undefined): BridgeStatusPhase {
  switch ((raw ?? '').toLowerCase()) {
    case 'pending':
    case 'pending-source':
    case 'pending_source':
    case 'source-pending':
      return 'pending-source';
    case 'in_transit':
    case 'in-transit':
    case 'relayed':
    case 'in-flight':
    case 'in_flight':
    case 'inflight':
      return 'in-flight';
    case 'delivered':
    case 'completed':
      return 'delivered';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'pending-source';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
