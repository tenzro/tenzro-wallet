import { describe, expect, it } from 'vitest';
import { SecureMintAdapter, type SecureMintClientLike } from './adapter.ts';
import type { SecureMintPolicy } from './secure-mint.ts';

const TOKEN = '0x00000000000000000000000000000000000000aa';

const sdkPolicy = {
  token: TOKEN,
  asset_id: 'US0378331005',
  reserve: '1000',
  circulating: '250',
  por_feed_id: 'feed-1',
  attester_did: 'did:tenzro:human:attester',
  attestation_hash: '0xhash',
  attested_at: 1,
  ttl_secs: 3600,
};

function fakeClient(): { client: SecureMintClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    setPolicy: async (...args: unknown[]) => {
      calls.push(['setPolicy', args]);
      return { installed: true, token: TOKEN, policy: sdkPolicy };
    },
    getPolicy: async (...args: unknown[]) => {
      calls.push(['getPolicy', args]);
      return { found: true, token: TOKEN, policy: sdkPolicy };
    },
    clearPolicy: async (...args: unknown[]) => {
      calls.push(['clearPolicy', args]);
      return { cleared: true, token: TOKEN };
    },
    check: async (...args: unknown[]) => {
      calls.push(['check', args]);
      return { allowed: true, token: TOKEN, amount: '100', now: 42 };
    },
    apply: async (...args: unknown[]) => {
      calls.push(['apply', args]);
      return { applied: true, token: TOKEN, amount: '100', policy: sdkPolicy };
    },
    recordBurn: async (...args: unknown[]) => {
      calls.push(['recordBurn', args]);
      return { recorded: true, token: TOKEN, amount: '50', policy: sdkPolicy };
    },
  } as unknown as SecureMintClientLike;
  return { client, calls };
}

const port: SecureMintPolicy = {
  token: TOKEN,
  assetId: 'US0378331005',
  reserve: 1000n,
  circulating: 250n,
  porFeedId: 'feed-1',
  attesterDid: 'did:tenzro:human:attester',
  attestationHash: '0xhash',
  attestedAt: 1,
  ttlSecs: 3600,
};

describe('SecureMintAdapter', () => {
  it('forwards calls and translates port names to SDK names', async () => {
    const { client, calls } = fakeClient();
    const adapter = new SecureMintAdapter(client);

    await adapter.setPolicy(port);
    await adapter.getPolicy(TOKEN);
    await adapter.clearPolicy(TOKEN);
    await adapter.checkMint(TOKEN, 100n);
    await adapter.applyMint(TOKEN, 100n);
    await adapter.recordBurn(TOKEN, 50n);

    expect(calls.map(([m]) => m)).toEqual([
      'setPolicy',
      'getPolicy',
      'clearPolicy',
      'check',
      'apply',
      'recordBurn',
    ]);
  });

  it('encodes camelCase/bigint port policy to snake_case/string SDK shape', async () => {
    const { client, calls } = fakeClient();
    const adapter = new SecureMintAdapter(client);
    await adapter.setPolicy(port);
    const encoded = calls[0]?.[1][0];
    expect(encoded).toEqual(sdkPolicy);
  });

  it('decodes SDK wrapper envelopes into port types', async () => {
    const { client } = fakeClient();
    const adapter = new SecureMintAdapter(client);

    expect(await adapter.getPolicy(TOKEN)).toEqual(port);
    expect(await adapter.clearPolicy(TOKEN)).toBe(true);

    const check = await adapter.checkMint(TOKEN, 100n);
    expect(check).toEqual({ allowed: true, token: TOKEN, amount: 100n, now: 42 });

    const applied = await adapter.applyMint(TOKEN, 100n);
    expect(applied).toEqual({ applied: true, token: TOKEN, amount: 100n, policy: port });

    const burned = await adapter.recordBurn(TOKEN, 50n);
    expect(burned).toEqual({ applied: true, token: TOKEN, amount: 50n, policy: port });
  });

  it('returns null when getPolicy reports not found', async () => {
    const adapter = new SecureMintAdapter({
      getPolicy: async () => ({ found: false, token: TOKEN }),
    } as unknown as SecureMintClientLike);
    expect(await adapter.getPolicy(TOKEN)).toBeNull();
  });
});
