/**
 * CantonBridgeAdapter — `BridgeRoutePort` backed by Tenzro's Canton
 * bridge corridor.
 *
 * Tenzro's BridgeRouter includes Canton as a first-class adapter (per
 * docs/bridge). It's the corridor the wallet uses for Tenzro↔Canton
 * MainNet moves — settlement on the Canton side runs through DAML
 * commands, not an EVM-style transfer.
 *
 * Canton-specific notes for the SDK implementer:
 *   - The build step emits a DAML command body, not an EVM tx — the
 *     `transactions[].body` carries `{command: ...}` and the
 *     `chain` field is `'canton-mainnet'` (or the configured
 *     synchronizer slug).
 *   - The `canton-internal` and `canton-external` wallet surfaces
 *     are the natural sources/destinations for this adapter.
 *
 * Spec ref: docs/canton + docs/bridge.
 */

import {
  bridgeAdapterFromClient,
  type BridgeClientLike,
} from './bridge-adapter-base.ts';
import type { BridgeRoutePort } from '../bridge.ts';

export class CantonBridgeAdapter implements BridgeRoutePort {
  readonly adapterId = 'canton' as const;
  private readonly impl: BridgeRoutePort;

  constructor(client?: BridgeClientLike) {
    this.impl = bridgeAdapterFromClient('canton', client);
  }

  quote = (req: Parameters<BridgeRoutePort['quote']>[0]) => this.impl.quote(req);
  build = (req: Parameters<BridgeRoutePort['build']>[0]) => this.impl.build(req);
  track = (id: string) => this.impl.track(id);
}
