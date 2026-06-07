import { describe, expect, it } from 'vitest';
import { Erc7683Adapter, type Erc7683ClientLike } from './adapter.ts';

function fakeClient(): { client: Erc7683ClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    getOrder: record('getOrder'),
    listOrders: record('listOrders'),
    recordFill: record('recordFill'),
    getFill: record('getFill'),
    listFills: record('listFills'),
  } as unknown as Erc7683ClientLike;
  return { client, calls };
}

describe('Erc7683Adapter', () => {
  it('forwards calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new Erc7683Adapter(client);

    await adapter.getOrder('0xorder');
    await adapter.listOrders({ state: 'open', destChain: 8453, limit: 25 });
    await adapter.listOrders();
    await adapter.recordFill({
      orderId: '0xorder',
      originChainId: 1,
      originSettler: '0xsettler',
      filler: '0xfiller',
      recipient: '0xrecipient',
      fillTxHash: '0xtx',
      filledAtMs: Date.now(),
      proofRoute: 'layerzero',
      outputs: [],
    });
    await adapter.getFill('0xorder', 1);
    await adapter.listFills();

    expect(calls.map(([m]) => m)).toEqual([
      'getOrder',
      'listOrders',
      'listOrders',
      'recordFill',
      'getFill',
      'listFills',
    ]);
  });
});
