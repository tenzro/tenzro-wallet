/**
 * CcipBridgeAdapter — `BridgeRoutePort` backed by Chainlink CCIP (M8).
 *
 * **Status (2026-05):** detect-via-presence. See
 * `bridge-adapter-base.ts` for the shared shape and endpoint contracts.
 *
 * Tenzro endpoints map to `/v1/bridge/ccip/{quote,build,track}` —
 * documented in `lifi-adapter.ts` JSDoc, identical shape across all
 * three vendors.
 *
 * CCIP-specific notes for the SDK implementer:
 *   - Chain identifiers on CCIP are 64-bit chain selectors, not chain
 *     ids. The SDK is expected to translate `BridgeChainRef.chain` /
 *     `chainId` to the selector — the kernel does not hold the table.
 *   - CCIP's `Router.ccipSend` returns a 32-byte `messageId`; the SDK
 *     surfaces it as `tracker_id` for parity with LI.FI/LayerZero.
 *
 * Spec ref: https://docs.chain.link/ccip
 */

import type { BridgeRoutePort } from '../bridge.ts';
import { type BridgeClientLike, bridgeAdapterFromClient } from './bridge-adapter-base.ts';

export class CcipBridgeAdapter implements BridgeRoutePort {
  readonly adapterId = 'ccip' as const;
  private readonly impl: BridgeRoutePort;

  constructor(client?: BridgeClientLike) {
    this.impl = bridgeAdapterFromClient('ccip', client);
  }

  quote = (req: Parameters<BridgeRoutePort['quote']>[0]) => this.impl.quote(req);
  build = (req: Parameters<BridgeRoutePort['build']>[0]) => this.impl.build(req);
  track = (id: string) => this.impl.track(id);
}
