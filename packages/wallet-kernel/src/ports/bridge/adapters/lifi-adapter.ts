/**
 * LiFiBridgeAdapter — `BridgeRoutePort` backed by LI.FI (M8 SDK gap).
 *
 * **Status (2026-05):** detect-via-presence. Constructor accepts an
 * optional `LiFiClientLike` (typically `tenzro-sdk` `BridgeClient.lifi`).
 * When the client is present and exposes a method, calls forward; when
 * not, calls throw "M8 pending — LI.FI SDK wrapper not wired (DESIGN.md
 * §10 + §11.6)". Lets consumers compile against the port today and
 * light up at SDK-swap time without re-wiring.
 *
 * The plan (DESIGN.md §10 milestone 8):
 *   - either embed `@lifi/sdk` via dynamic import behind a feature flag,
 *   - or wrap a Tenzro-hosted LI.FI proxy returning the same quote shape.
 *
 * Either way, the SDK's `BridgeClient.lifi.{quote,build,track}` is the
 * single source of truth — the adapter only normalises wire shapes.
 *
 * Tenzro endpoints (Tenzro implements; SDK proxies; kernel consumes —
 * applies symmetrically to all three bridge adapters):
 *
 *   1. `POST /v1/bridge/{vendor}/quote`
 *      Body: `{from_chain, to_chain, from_address, to_address,
 *              from_asset, amount, prefer?}`.
 *      Response: `{vendor, to_amount, fees, eta_sec, opaque, summary}`.
 *
 *   2. `POST /v1/bridge/{vendor}/build`
 *      Body: `{opaque}` from a previous quote.
 *      Response: `{transactions: [{chain, body, label}], tracker_id}`.
 *
 *   3. `GET  /v1/bridge/{vendor}/track/{trackerId}` (long-poll, SSE, or
 *      websocket — adapter wrapper hides the transport)
 *      Stream of `{tracker_id, phase, source_tx?, destination_tx?, error?}`.
 *
 * `vendor` ∈ `{lifi, ccip, layerzero}` per DESIGN.md §10.
 *
 * Spec ref: https://docs.li.fi/
 */

import type { BridgeRoutePort } from '../bridge.ts';
import { type BridgeClientLike, bridgeAdapterFromClient } from './bridge-adapter-base.ts';

export class LiFiBridgeAdapter implements BridgeRoutePort {
  readonly adapterId = 'lifi' as const;
  private readonly impl: BridgeRoutePort;

  constructor(client?: BridgeClientLike) {
    this.impl = bridgeAdapterFromClient('lifi', client);
  }

  quote = (req: Parameters<BridgeRoutePort['quote']>[0]) => this.impl.quote(req);
  build = (req: Parameters<BridgeRoutePort['build']>[0]) => this.impl.build(req);
  track = (id: string) => this.impl.track(id);
}
