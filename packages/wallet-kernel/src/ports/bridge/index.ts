/**
 * Bridge router ports + adapter stubs (M8). All adapters throw "M8 pending"
 * until the third-party SDK wiring lands; the port shape is stable.
 */

export type {
  BridgeAdapterId,
  BridgeChainRef,
  BridgeQuoteRequest,
  BridgeQuote,
  BridgeBuildRequest,
  BridgeBuildResult,
  BridgeStatusPhase,
  BridgeStatus,
  BridgeRoutePort,
} from './bridge.ts';

export { LiFiBridgeAdapter } from './adapters/lifi-adapter.ts';
export { CcipBridgeAdapter } from './adapters/ccip-adapter.ts';
export { LayerZeroBridgeAdapter } from './adapters/layerzero-adapter.ts';
export { WormholeBridgeAdapter } from './adapters/wormhole-adapter.ts';
export { DeBridgeBridgeAdapter } from './adapters/debridge-adapter.ts';
export { CantonBridgeAdapter } from './adapters/canton-bridge-adapter.ts';
export type { BridgeClientLike } from './adapters/bridge-adapter-base.ts';
