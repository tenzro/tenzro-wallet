import { describe, expect, it } from 'vitest';
import { CaipAdapter, type CaipClientLike } from './adapter.ts';

function fakeClient(): { client: CaipClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    caip2: record('caip2'),
    caip10: record('caip10'),
    caip19: record('caip19'),
  } as unknown as CaipClientLike;
  return { client, calls };
}

describe('CaipAdapter', () => {
  it('forwards calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new CaipAdapter(client);

    await adapter.caip2();
    await adapter.caip10('0xaddress');
    await adapter.caip19({ kind: 'slip44' });
    await adapter.caip19({ kind: 'token', token_id: '0xtok' });
    await adapter.caip19({
      kind: 'nft',
      collection_id: '0xcol',
      nft_token_id: '42',
    });

    expect(calls.map(([m]) => m)).toEqual(['caip2', 'caip10', 'caip19', 'caip19', 'caip19']);
    expect(calls[1]?.[1]).toEqual(['0xaddress']);
  });
});
