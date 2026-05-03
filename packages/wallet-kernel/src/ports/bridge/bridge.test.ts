/**
 * Pin the bridge adapters' wiring against the actual `tenzro-sdk@0.1.0`
 * `BridgeClient` shape:
 *   - `getRoutes(fromChain, toChain, token?)` → `BridgeRoute[]`
 *   - `bridgeTokens(fromChain, toChain, token, amount, recipient, adapter?)` → `BridgeTransfer`
 *   - `getTransferStatus(transferId)` → `TransferStatus`
 *
 * Each per-vendor adapter (LI.FI / CCIP / LayerZero / Wormhole / deBridge /
 * Canton) forwards to the same `BridgeClient` and filters / passes its
 * `adapterId` through the SDK's `adapter` arg.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CantonBridgeAdapter } from './adapters/canton-bridge-adapter.ts';
import { CcipBridgeAdapter } from './adapters/ccip-adapter.ts';
import { DeBridgeBridgeAdapter } from './adapters/debridge-adapter.ts';
import { LayerZeroBridgeAdapter } from './adapters/layerzero-adapter.ts';
import { LiFiBridgeAdapter } from './adapters/lifi-adapter.ts';
import { WormholeBridgeAdapter } from './adapters/wormhole-adapter.ts';
import type { BridgeClientLike } from './adapters/bridge-adapter-base.ts';
import type {
  BridgeBuildRequest,
  BridgeQuoteRequest,
  BridgeRoutePort,
} from './bridge.ts';

const SAMPLE_QUOTE: BridgeQuoteRequest = {
  fromChain: { chain: 'tenzro' },
  toChain: { chain: 'ethereum', chainId: 1 },
  fromAddress: '0xpayer',
  toAddress: '0xpayee',
  fromAsset: 'TNZO',
  amount: 1_000_000_000n,
};

const SAMPLE_BUILD: BridgeBuildRequest = {
  opaque: {
    fromChain: 'tenzro',
    toChain: 'ethereum',
    token: 'TNZO',
    amount: '1000000000',
    recipient: '0xpayee',
  },
};

const adapters: ReadonlyArray<{
  name: string;
  make: (client?: BridgeClientLike) => BridgeRoutePort;
}> = [
  { name: 'LiFi', make: (c) => new LiFiBridgeAdapter(c) },
  { name: 'CCIP', make: (c) => new CcipBridgeAdapter(c) },
  { name: 'LayerZero', make: (c) => new LayerZeroBridgeAdapter(c) },
  { name: 'Wormhole', make: (c) => new WormholeBridgeAdapter(c) },
  { name: 'deBridge', make: (c) => new DeBridgeBridgeAdapter(c) },
  { name: 'Canton', make: (c) => new CantonBridgeAdapter(c) },
];

describe.each(adapters)('$name bridge adapter (no client → SDK pending)', ({ make }) => {
  const adapter = make();

  it('exposes its adapterId', () => {
    expect(adapter.adapterId).toMatch(
      /^(lifi|ccip|layerzero|wormhole|debridge|canton)$/,
    );
  });

  it('quote() throws "SDK pending"', async () => {
    await expect(adapter.quote(SAMPLE_QUOTE)).rejects.toThrow(/SDK pending/);
  });

  it('build() throws "SDK pending"', async () => {
    await expect(adapter.build(SAMPLE_BUILD)).rejects.toThrow(/SDK pending/);
  });

  it('track() throws "SDK pending" when iterated', async () => {
    const iter = adapter.track('t-1');
    await expect(
      (async () => {
        for await (const _ of iter) {
          break;
        }
      })(),
    ).rejects.toThrow(/SDK pending/);
  });
});

describe('Bridge adapter — present client forwards + normalises', () => {
  function fakeClient(seenAdapters: string[]): BridgeClientLike {
    return {
      async getRoutes(fromChain: string, toChain: string, token?: string) {
        return [
          {
            from_chain: fromChain,
            to_chain: toChain,
            adapter: 'lifi',
            estimated_fee: '5',
            estimated_time_secs: 30,
            supported_tokens: [token ?? 'TNZO'],
          },
          {
            from_chain: fromChain,
            to_chain: toChain,
            adapter: 'ccip',
            estimated_fee: '7',
            estimated_time_secs: 60,
            supported_tokens: [token ?? 'TNZO'],
          },
          {
            from_chain: fromChain,
            to_chain: toChain,
            adapter: 'layerzero',
            estimated_fee: '4',
            estimated_time_secs: 45,
            supported_tokens: [token ?? 'TNZO'],
          },
          {
            from_chain: fromChain,
            to_chain: toChain,
            adapter: 'wormhole',
            estimated_fee: '6',
            estimated_time_secs: 120,
            supported_tokens: [token ?? 'TNZO'],
          },
          {
            from_chain: fromChain,
            to_chain: toChain,
            adapter: 'debridge',
            estimated_fee: '3',
            estimated_time_secs: 20,
            supported_tokens: [token ?? 'TNZO'],
          },
          {
            from_chain: fromChain,
            to_chain: toChain,
            adapter: 'canton',
            estimated_fee: '2',
            estimated_time_secs: 90,
            supported_tokens: [token ?? 'TNZO'],
          },
        ];
      },
      async bridgeTokens(_fromChain, _toChain, _token, _amount, _recipient, adapter) {
        seenAdapters.push(adapter ?? '');
        return {
          id: `tx-${adapter}`,
          sourceChain: 1,
          targetChain: 2,
          assetId: 'TNZO',
          amount: '1000000000',
          sender: '0xpayer',
          recipient: '0xpayee',
          status: 'pending',
          txHash: `0x${adapter}-tx`,
          bridgeFee: '5',
        };
      },
      async getTransferStatus(transferId: string) {
        return {
          transfer_id: transferId,
          status: 'delivered' as const,
          source_tx_hash: '0xsrc',
          destination_tx_hash: '0xdst',
          updated_at: 1714521600,
        };
      },
    };
  }

  it('LiFi.quote filters routes to lifi vendor and synthesises summary', async () => {
    const seen: string[] = [];
    const adapter = new LiFiBridgeAdapter(fakeClient(seen));
    const q = await adapter.quote(SAMPLE_QUOTE);
    expect(q.adapter).toBe('lifi');
    expect(q.fees).toBe(5n);
    expect(q.etaSec).toBe(30);
    expect(q.summary).toContain('lifi');
  });

  it('Wormhole.quote picks the wormhole row', async () => {
    const adapter = new WormholeBridgeAdapter(fakeClient([]));
    const q = await adapter.quote(SAMPLE_QUOTE);
    expect(q.adapter).toBe('wormhole');
    expect(q.fees).toBe(6n);
    expect(q.etaSec).toBe(120);
  });

  it('deBridge.build forwards adapter=debridge to bridgeTokens + returns trackerId', async () => {
    const seen: string[] = [];
    const adapter = new DeBridgeBridgeAdapter(fakeClient(seen));
    const r = await adapter.build(SAMPLE_BUILD);
    expect(seen).toEqual(['debridge']);
    expect(r.trackerId).toBe('tx-debridge');
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]?.body).toEqual({ txHash: '0xdebridge-tx' });
  });

  it('CCIP.build + LayerZero.build pass distinct adapter args', async () => {
    const seen: string[] = [];
    const client = fakeClient(seen);
    await new CcipBridgeAdapter(client).build(SAMPLE_BUILD);
    await new LayerZeroBridgeAdapter(client).build(SAMPLE_BUILD);
    expect(seen).toEqual(['ccip', 'layerzero']);
  });

  it('Canton.track yields a single normalised "delivered" status and stops', async () => {
    const adapter = new CantonBridgeAdapter(fakeClient([]));
    const out = [];
    for await (const s of adapter.track('trk-1')) {
      out.push(s);
    }
    expect(out).toHaveLength(1);
    expect(out[0]?.phase).toBe('delivered');
    expect(out[0]?.sourceTx).toBe('0xsrc');
    expect(out[0]?.destinationTx).toBe('0xdst');
  });

  it('quote rejects when SDK route list lacks the vendor', async () => {
    const partial: BridgeClientLike = {
      async getRoutes() {
        return [
          {
            from_chain: 'tenzro',
            to_chain: 'ethereum',
            adapter: 'lifi',
            estimated_fee: '5',
            estimated_time_secs: 30,
            supported_tokens: ['TNZO'],
          },
        ];
      },
    };
    const adapter = new WormholeBridgeAdapter(partial);
    await expect(adapter.quote(SAMPLE_QUOTE)).rejects.toThrow(
      /vendor not in SDK route list/,
    );
  });

  it('partial client (getRoutes only) keeps build/track in SDK pending', async () => {
    const partial: BridgeClientLike = {
      async getRoutes() {
        return [
          {
            from_chain: 'tenzro',
            to_chain: 'ethereum',
            adapter: 'lifi',
            estimated_fee: '5',
            estimated_time_secs: 30,
            supported_tokens: ['TNZO'],
          },
        ];
      },
    };
    const adapter = new LiFiBridgeAdapter(partial);
    await expect(adapter.quote(SAMPLE_QUOTE)).resolves.toBeDefined();
    await expect(adapter.build(SAMPLE_BUILD)).rejects.toThrow(/SDK pending/);
  });
});

describe('Bridge adapter — track polls until terminal phase', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits one event per phase change and stops on delivered', async () => {
    const calls: string[] = [];
    let i = 0;
    const phases = ['pending', 'in_transit', 'in_transit', 'delivered'];
    const client: BridgeClientLike = {
      async getTransferStatus(transferId: string) {
        const status = (phases[i++] ?? 'delivered') as
          | 'pending'
          | 'in_transit'
          | 'delivered'
          | 'failed';
        calls.push(status);
        return {
          transfer_id: transferId,
          status,
          updated_at: 1714521600,
        };
      },
    };
    const adapter = new LiFiBridgeAdapter(client);
    const out: string[] = [];
    const consume = (async () => {
      for await (const s of adapter.track('trk-1')) {
        out.push(s.phase);
      }
    })();
    await vi.advanceTimersByTimeAsync(10_000);
    await consume;
    expect(out).toEqual(['pending-source', 'in-flight', 'delivered']);
    expect(calls).toEqual(['pending', 'in_transit', 'in_transit', 'delivered']);
  });
});
