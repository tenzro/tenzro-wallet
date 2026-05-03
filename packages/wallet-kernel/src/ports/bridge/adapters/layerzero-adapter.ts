/**
 * LayerZeroBridgeAdapter — `BridgeRoutePort` backed by LayerZero v2 (M8).
 *
 * **Status (2026-05):** detect-via-presence. See
 * `bridge-adapter-base.ts` for the shared shape and endpoint contracts.
 *
 * Tenzro endpoints map to `/v1/bridge/layerzero/{quote,build,track}` —
 * documented in `lifi-adapter.ts` JSDoc, identical shape across all
 * three vendors.
 *
 * LayerZero-specific notes for the SDK implementer:
 *   - LayerZero v2 uses `endpoint id` (eid) for chain selection. The
 *     SDK translates `BridgeChainRef.chain`/`chainId` to the eid.
 *   - The `tracker_id` should be the destination-chain delivery hash
 *     once available, falling back to the source-chain `nonce` until
 *     delivery confirms.
 *
 * Spec ref: https://docs.layerzero.network/v2
 */

import {
  bridgeAdapterFromClient,
  type BridgeClientLike,
} from './bridge-adapter-base.ts';
import type { BridgeRoutePort } from '../bridge.ts';

export class LayerZeroBridgeAdapter implements BridgeRoutePort {
  readonly adapterId = 'layerzero' as const;
  private readonly impl: BridgeRoutePort;

  constructor(client?: BridgeClientLike) {
    this.impl = bridgeAdapterFromClient('layerzero', client);
  }

  quote = (req: Parameters<BridgeRoutePort['quote']>[0]) => this.impl.quote(req);
  build = (req: Parameters<BridgeRoutePort['build']>[0]) => this.impl.build(req);
  track = (id: string) => this.impl.track(id);
}
