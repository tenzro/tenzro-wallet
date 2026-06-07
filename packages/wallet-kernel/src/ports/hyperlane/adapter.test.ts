import { describe, expect, it } from 'vitest';
import { HyperlaneAdapter, type HyperlaneClientLike } from './adapter.ts';

function fakeClient(): { client: HyperlaneClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    listChains: record('listChains'),
    quoteDispatch: record('quoteDispatch'),
    dispatch: record('dispatch'),
    getMessage: record('getMessage'),
  } as unknown as HyperlaneClientLike;
  return { client, calls };
}

describe('HyperlaneAdapter', () => {
  it('forwards calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new HyperlaneAdapter(client);

    await adapter.listChains();
    await adapter.quoteDispatch({
      origin_domain: 1337,
      destination_domain: 10,
      recipient: '0xrecipient',
      body_hex: '0xdead',
    });
    await adapter.dispatch({
      origin_domain: 1337,
      destination_domain: 10,
      recipient: '0xrecipient',
      body_hex: '0xdead',
    });
    await adapter.getMessage('0xmsgid');

    expect(calls.map(([m]) => m)).toEqual([
      'listChains',
      'quoteDispatch',
      'dispatch',
      'getMessage',
    ]);
  });
});
