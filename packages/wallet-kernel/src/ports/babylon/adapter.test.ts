import { describe, expect, it } from 'vitest';
import { BabylonAdapter, type BabylonClientLike } from './adapter.ts';

function fakeClient(): { client: BabylonClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    registerFinalityProvider: record('registerFinalityProvider'),
    getFinalityProvider: record('getFinalityProvider'),
    listFinalityProviders: record('listFinalityProviders'),
    totalStakeForProvider: record('totalStakeForProvider'),
    submitFinalitySignature: record('submitFinalitySignature'),
    listDelegations: record('listDelegations'),
  } as unknown as BabylonClientLike;
  return { client, calls };
}

describe('BabylonAdapter', () => {
  it('forwards calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new BabylonAdapter(client);

    await adapter.registerFinalityProvider({
      validator: 'tenzro-validator-0',
      btc_pk: '0xbtcpk',
      commission_bps: 500,
    });
    await adapter.getFinalityProvider('tenzro-validator-0');
    await adapter.listFinalityProviders();
    await adapter.totalStakeForProvider('tenzro-validator-0');
    await adapter.submitFinalitySignature({
      validator: 'tenzro-validator-0',
      block_hash: '0xblock',
      eots_signature: '0xeots',
    });
    await adapter.listDelegations('tenzro-validator-0');

    expect(calls.map(([m]) => m)).toEqual([
      'registerFinalityProvider',
      'getFinalityProvider',
      'listFinalityProviders',
      'totalStakeForProvider',
      'submitFinalitySignature',
      'listDelegations',
    ]);
  });
});
