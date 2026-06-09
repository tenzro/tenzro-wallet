/**
 * WormholeNttAdapter — `WormholeNttPort` backed by `tenzro-sdk`
 * `WormholeNttClient`.
 */

import type { WormholeNttClient } from 'tenzro-sdk';
import type {
  WormholeNttCatalog,
  WormholeNttPort,
} from './wormhole-ntt.ts';

export type WormholeNttClientLike = Pick<WormholeNttClient, 'listChains'>;

export class WormholeNttAdapter implements WormholeNttPort {
  constructor(private readonly client: WormholeNttClientLike) {}

  async listChains(): Promise<WormholeNttCatalog> {
    const r = await this.client.listChains();
    return {
      chains: r.chains.map((c) => ({
        wormholeChainId: c.wormhole_chain_id,
        name: c.name,
      })),
      transceiverKinds: r.transceiver_kinds,
      scaffolding: r.scaffolding,
      ...(r.note !== undefined ? { note: r.note } : {}),
    };
  }
}
