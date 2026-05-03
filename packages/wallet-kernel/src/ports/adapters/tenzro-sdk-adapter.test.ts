/**
 * The adapter is the only place in the kernel that knows about the SDK's
 * shape, so these tests pin the wire-shape mapping and the inferred-status
 * behaviour. If the SDK changes shape under us, these break first and tell
 * us where the seam is.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenzroClient } from 'tenzro-sdk';
import {
  TenzroNotInstalledError,
  TenzroSdkAdapter,
  type TenzroClientLike,
} from './tenzro-sdk-adapter.ts';

interface FakeCall {
  readonly method: string;
  readonly args: unknown;
}

function fakeClient(
  overrides: Partial<TenzroClientLike> = {},
): { client: TenzroClientLike; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client: TenzroClientLike = {
    getNonce: async (address) => {
      calls.push({ method: 'getNonce', args: address });
      return 7;
    },
    getChainId: async () => {
      calls.push({ method: 'getChainId', args: null });
      return 1337;
    },
    getFinalizedBlock: async () => {
      calls.push({ method: 'getFinalizedBlock', args: null });
      return 100;
    },
    getTransaction: async (hash) => {
      calls.push({ method: 'getTransaction', args: hash });
      return null;
    },
    sendTransaction: async (params) => {
      calls.push({ method: 'sendTransaction', args: params });
      return '0xdeadbeef';
    },
    ...overrides,
  };
  return { client, calls };
}

describe('TenzroSdkAdapter', () => {
  it('passes through getNonce and getChainId verbatim', async () => {
    const { client, calls } = fakeClient();
    const adapter = new TenzroSdkAdapter(client);
    expect(await adapter.getNonce('0xabc')).toBe(7);
    expect(await adapter.getChainId()).toBe(1337);
    expect(calls.map((c) => c.method)).toEqual(['getNonce', 'getChainId']);
  });

  it('maps camelCase send args to the SDK snake_case shape', async () => {
    const { client, calls } = fakeClient();
    const adapter = new TenzroSdkAdapter(client);
    await adapter.sendTransaction({
      from: '0xfrom',
      to: '0xto',
      value: 5n * 10n ** 18n,
      gasLimit: 30000,
      gasPrice: 2_000_000_000,
      nonce: 4,
      chainId: 1337,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({
      from: '0xfrom',
      to: '0xto',
      value: 5n * 10n ** 18n,
      gas_limit: 30000,
      gas_price: 2_000_000_000,
      nonce: 4,
      chain_id: 1337,
    });
  });

  it('omits optional fields when not provided', async () => {
    const { client, calls } = fakeClient();
    const adapter = new TenzroSdkAdapter(client);
    await adapter.sendTransaction({
      from: '0xfrom',
      to: '0xto',
      value: 1n,
    });
    expect(calls[0]?.args).toEqual({
      from: '0xfrom',
      to: '0xto',
      value: 1n,
    });
  });

  it('returns null when the node has no record of the tx', async () => {
    const { client } = fakeClient({ getTransaction: async () => null });
    const adapter = new TenzroSdkAdapter(client);
    expect(await adapter.getTransaction('deadbeef')).toBeNull();
  });

  it('infers pending when blockHeight is undefined', async () => {
    const { client } = fakeClient({
      getTransaction: async () => ({ hash: 'abc' }),
    });
    const adapter = new TenzroSdkAdapter(client);
    const status = await adapter.getTransaction('abc');
    expect(status).toEqual({ hash: 'abc', status: 'pending' });
  });

  it('infers included when blockHeight > finalizedBlock', async () => {
    const { client } = fakeClient({
      getFinalizedBlock: async () => 100,
      getTransaction: async () => ({ hash: 'abc', blockHeight: 150 }),
    });
    const adapter = new TenzroSdkAdapter(client);
    expect(await adapter.getTransaction('abc')).toEqual({
      hash: 'abc',
      status: 'included',
      blockHeight: 150,
    });
  });

  it('infers finalized when blockHeight <= finalizedBlock', async () => {
    const { client } = fakeClient({
      getFinalizedBlock: async () => 100,
      getTransaction: async () => ({ hash: 'abc', blockHeight: 80 }),
    });
    const adapter = new TenzroSdkAdapter(client);
    expect(await adapter.getTransaction('abc')).toEqual({
      hash: 'abc',
      status: 'finalized',
      blockHeight: 80,
    });
  });
});

describe('TenzroSdkAdapter.fromInjected (M6 — injected-provider path)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps the SDK-built TenzroClient when discovery succeeds', async () => {
    // The SDK owns DOM-touching EIP-6963 discovery; the adapter just has
    // to forward the result. We stub fromInjected so the test stays in a
    // node environment, then verify the adapter exposes RPC methods on
    // the wrapped client.
    const { client } = fakeClient();
    const spy = vi
      .spyOn(TenzroClient, 'fromInjected')
      .mockResolvedValue(client as unknown as TenzroClient);

    const adapter = await TenzroSdkAdapter.fromInjected({
      timeoutMs: 250,
      rdns: 'network.tenzro.wallet',
    });

    expect(spy).toHaveBeenCalledWith({
      timeoutMs: 250,
      rdns: 'network.tenzro.wallet',
    });
    // The adapter should now route RPC through the (fake) injected client.
    expect(await adapter.getChainId()).toBe(1337);
  });

  it('propagates TenzroNotInstalledError so callers can render an install CTA', async () => {
    vi.spyOn(TenzroClient, 'fromInjected').mockRejectedValue(
      new TenzroNotInstalledError('Tenzro provider not announced'),
    );
    await expect(TenzroSdkAdapter.fromInjected()).rejects.toBeInstanceOf(
      TenzroNotInstalledError,
    );
  });
});
