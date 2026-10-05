/**
 * The custody transport over the network's discovered endpoints: a node's
 * JSON-RPC error keeps its code and data, and an endpoint on another chain
 * is never used.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { JsonRpcError, NetworkTransport } from './rpc.ts';

type Answer = { result?: unknown; error?: { code: number; message: string; data?: unknown } };

function fakeNetwork(chain: number, answer: (method: string) => Answer) {
  const seen: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const { method, id } = JSON.parse(String(init.body)) as { method: string; id: number };
    seen.push(`${url} ${method}`);
    const body =
      method === 'eth_chainId'
        ? { result: `0x${chain.toString(16)}` }
        : method === 'tenzro_listRoleEndpoints'
          ? { result: { endpoints: [] } }
          : method === 'tenzro_getCheckpointCertificate'
            ? { result: { index: 7, digest: 'ab'.repeat(32) } }
            : answer(method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NetworkTransport', () => {
  it('keeps a node error’s code and data, so held actions carry their step-up', async () => {
    fakeNetwork(13380, () => ({
      error: { code: -32010, message: 'step-up required', data: { step_up: 1 } },
    }));
    const rpc = new NetworkTransport({ bootstrap: ['https://hint.example/'], chainId: 13380 });
    const err = await rpc.call('tenzro_agentAct', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    expect((err as JsonRpcError).code).toBe(-32010);
    expect((err as JsonRpcError).message).toBe('step-up required');
    expect((err as JsonRpcError).data).toEqual({ step_up: 1 });
    expect(rpc.endpoints()).toEqual(['https://hint.example/']);
  });

  it('refuses a network on another chain', async () => {
    const seen = fakeNetwork(1, () => ({ result: '0x1' }));
    const rpc = new NetworkTransport({ bootstrap: ['https://hint.example/'], chainId: 13380 });
    const err = await rpc.call('eth_blockNumber').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    expect((err as JsonRpcError).message).toMatch(/could not be reached/);
    expect(seen.some((s) => s.endsWith('eth_blockNumber'))).toBe(false);
  });
});
