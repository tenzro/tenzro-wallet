import { describe, expect, it } from 'vitest';
import { AxelarAdapter, type AxelarClientLike } from './adapter.ts';

function fakeClient(): { client: AxelarClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    listChains: record('listChains'),
    callContract: record('callContract'),
    payGas: record('payGas'),
    getMessage: record('getMessage'),
  } as unknown as AxelarClientLike;
  return { client, calls };
}

describe('AxelarAdapter', () => {
  it('forwards calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AxelarAdapter(client);

    await adapter.listChains();
    await adapter.callContract({
      source_chain: 'tenzro',
      destination_chain: 'osmosis',
      destination_address: 'osmo1xyz',
      payload_hex: '0xdead',
    });
    await adapter.payGas({
      payload_hash: '0xph',
      source_chain: 'tenzro',
      destination_chain: 'osmosis',
      destination_address: 'osmo1xyz',
      gas_token: 'TNZO',
      gas_amount: '1000',
    });
    await adapter.getMessage('0xph');

    expect(calls.map(([m]) => m)).toEqual([
      'listChains',
      'callContract',
      'payGas',
      'getMessage',
    ]);
  });
});
