/**
 * DeBridgeBridgeAdapter — `BridgeRoutePort` backed by deBridge DLN.
 *
 * Tenzro's BridgeRouter exposes deBridge alongside the other vendors
 * (per docs/bridge). All vendor adapters share the same shared
 * `client.bridge` shape — see `bridge-adapter-base.ts` for the
 * detect-via-presence body and the SDK contract.
 *
 * deBridge-specific notes for the SDK implementer:
 *   - deBridge is intent-based (DLN orders) and supports post-fulfilment
 *     hooks (`create_order_with_hook`). The hook payload travels in the
 *     `opaque` field through `BridgeQuote → BridgeBuildRequest`.
 *   - `tracker_id` is the DLN order id.
 *
 * Spec ref: https://docs.debridge.finance/dln-the-debridge-liquidity-network-protocol
 */

import type { BridgeRoutePort } from '../bridge.ts';
import { type BridgeClientLike, bridgeAdapterFromClient } from './bridge-adapter-base.ts';

export class DeBridgeBridgeAdapter implements BridgeRoutePort {
  readonly adapterId = 'debridge' as const;
  private readonly impl: BridgeRoutePort;

  constructor(client?: BridgeClientLike) {
    this.impl = bridgeAdapterFromClient('debridge', client);
  }

  quote = (req: Parameters<BridgeRoutePort['quote']>[0]) => this.impl.quote(req);
  build = (req: Parameters<BridgeRoutePort['build']>[0]) => this.impl.build(req);
  track = (id: string) => this.impl.track(id);
}
