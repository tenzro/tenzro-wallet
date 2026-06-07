import { describe, expect, it } from 'vitest';
import { SecureMintAdapter, type SecureMintClientLike } from './adapter.ts';

function fakeClient(): { client: SecureMintClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    setPolicy: record('setPolicy'),
    getPolicy: record('getPolicy'),
    clearPolicy: record('clearPolicy'),
    check: record('check'),
    apply: record('apply'),
    recordBurn: record('recordBurn'),
  } as unknown as SecureMintClientLike;
  return { client, calls };
}

describe('SecureMintAdapter', () => {
  it('forwards calls and translates port names to SDK names', async () => {
    const { client, calls } = fakeClient();
    const adapter = new SecureMintAdapter(client);

    await adapter.setPolicy({
      asset_id: '0xasset',
      reserve: '1000',
      por_feed_id: 'feed-1',
      attester_did: 'did:tenzro:human:attester',
      attestation_hash: '0xhash',
      attested_at: 1,
      ttl_secs: 3600,
    });
    await adapter.getPolicy('0xasset');
    await adapter.clearPolicy('0xasset');
    await adapter.checkMint('0xasset', '100');
    await adapter.applyMint('0xasset', '100');
    await adapter.recordBurn('0xasset', '50');

    expect(calls.map(([m]) => m)).toEqual([
      'setPolicy',
      'getPolicy',
      'clearPolicy',
      'check',
      'apply',
      'recordBurn',
    ]);
  });
});
