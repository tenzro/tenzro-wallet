/**
 * WormholeBridgeAdapter — `BridgeRoutePort` backed by Wormhole.
 *
 * Tenzro's BridgeRouter exposes Wormhole alongside LI.FI/CCIP/LayerZero
 * (per docs/bridge). All vendor adapters share the same shared
 * `client.bridge` shape — see `bridge-adapter-base.ts` for the
 * detect-via-presence body and the SDK contract.
 *
 * Wormhole-specific notes for the SDK implementer:
 *   - Wormhole VAAs are the delivery primitive; the SDK surfaces the
 *     `tracker_id` as the source-chain emitter sequence until the
 *     destination delivery hash is observed.
 *
 * Spec ref: https://docs.wormhole.com/
 */

import type { BridgeRoutePort } from '../bridge.ts';
import { type BridgeClientLike, bridgeAdapterFromClient } from './bridge-adapter-base.ts';

export class WormholeBridgeAdapter implements BridgeRoutePort {
  readonly adapterId = 'wormhole' as const;
  private readonly impl: BridgeRoutePort;

  constructor(client?: BridgeClientLike) {
    this.impl = bridgeAdapterFromClient('wormhole', client);
  }

  quote = (req: Parameters<BridgeRoutePort['quote']>[0]) => this.impl.quote(req);
  build = (req: Parameters<BridgeRoutePort['build']>[0]) => this.impl.build(req);
  track = (id: string) => this.impl.track(id);
}
