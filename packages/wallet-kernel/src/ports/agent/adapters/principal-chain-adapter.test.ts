/**
 * Pin PrincipalChain adapter — read-only Spec 5 receipt + controller
 * queries. Both snake_case and camelCase shapes decode; null/undefined
 * optional fields collapse cleanly; bigint widening on bond + value
 * fields preserves precision.
 */

import { describe, expect, it } from 'vitest';
import {
  type PrincipalChainClientLike,
  PrincipalChainSdkAdapter,
} from './principal-chain-adapter.ts';

function fakeClient(overrides: Partial<PrincipalChainClientLike> = {}): {
  client: PrincipalChainClientLike;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: PrincipalChainClientLike = {
    getReceiptPrincipalChain: async (id) => {
      calls.push({ method: 'getReceiptPrincipalChain', args: [id] });
      return null;
    },
    listReceiptsByActor: async (did) => {
      calls.push({ method: 'listReceiptsByActor', args: [did] });
      return [];
    },
    listReceiptsByController: async (did) => {
      calls.push({ method: 'listReceiptsByController', args: [did] });
      return [];
    },
    summarizeController: async (did) => {
      calls.push({ method: 'summarizeController', args: [did] });
      return null;
    },
    ...overrides,
  };
  return { client, calls };
}

describe('PrincipalChainSdkAdapter.getReceiptPrincipalChain', () => {
  it('returns null on unknown receipt', async () => {
    const { client } = fakeClient();
    const adapter = new PrincipalChainSdkAdapter(client);
    expect(await adapter.getReceiptPrincipalChain('0xnope')).toBeNull();
  });

  it('decodes a controller-direct chain (depth 0)', async () => {
    const { client } = fakeClient({
      getReceiptPrincipalChain: async () => ({
        actor: 'did:tenzro:human:xyz',
        chain: [],
        controller: {
          did: 'did:tenzro:human:xyz',
          identity_type: 'Human',
          role: 'Controller',
          tombstone: false,
        },
        controller_kyc_tier: 2,
        controller_bond: '5000000000000000000',
        delegation_depth: 0,
        frozen_at_block: '12345',
      }),
    });
    const adapter = new PrincipalChainSdkAdapter(client);
    const rec = await adapter.getReceiptPrincipalChain('0xrec');
    expect(rec?.actor).toBe('did:tenzro:human:xyz');
    expect(rec?.chain).toEqual([]);
    expect(rec?.controller.role).toBe('controller');
    expect(rec?.controller.identityType).toBe('human');
    expect(rec?.controllerBond).toBe(5_000_000_000_000_000_000n);
    expect(rec?.delegationDepth).toBe(0);
    expect(rec?.frozenAtBlock).toBe(12345n);
  });

  it('decodes a delegated chain with tombstoned middle link', async () => {
    const { client } = fakeClient({
      getReceiptPrincipalChain: async () => ({
        actor: 'did:tenzro:machine:0xc:agent',
        chain: [
          {
            did: 'did:tenzro:human:xyz',
            identity_type: 'Human',
            role: 'Controller',
            tombstone: false,
          },
          {
            did: 'did:tenzro:machine:0xc:middle',
            identity_type: 'Machine',
            delegation_scope_id: '0xscope',
            role: 'DelegatedAgent',
            tombstone: true,
          },
        ],
        controller: {
          did: 'did:tenzro:human:xyz',
          identity_type: 'Human',
          role: 'Controller',
          tombstone: false,
        },
        controller_kyc_tier: 3,
        controller_bond: '1000',
        actor_bond: '500',
        controller_bond_aggregate: '6000',
        delegation_depth: 2,
        frozen_at_block: 99,
      }),
    });
    const adapter = new PrincipalChainSdkAdapter(client);
    const rec = await adapter.getReceiptPrincipalChain('0xrec');
    expect(rec?.delegationDepth).toBe(2);
    expect(rec?.chain.length).toBe(2);
    expect(rec?.chain[1]?.tombstone).toBe(true);
    expect(rec?.chain[1]?.delegationScopeId).toBe('0xscope');
    expect(rec?.actorBond).toBe(500n);
    expect(rec?.controllerBondAggregate).toBe(6000n);
  });
});

describe('PrincipalChainSdkAdapter.listReceiptsByActor', () => {
  it('returns [] for null response', async () => {
    const { client } = fakeClient({
      listReceiptsByActor: async () => null as unknown as never[],
    });
    const adapter = new PrincipalChainSdkAdapter(client);
    expect(await adapter.listReceiptsByActor('did:tenzro:machine:0xc:a')).toEqual([]);
  });

  it('decodes a list of summary records', async () => {
    const { client } = fakeClient({
      listReceiptsByActor: async () => [
        {
          actor: 'did:tenzro:machine:0xc:a',
          controller: 'did:tenzro:human:xyz',
          controller_kyc_tier: 2,
          delegation_depth: 1,
          has_tombstone: false,
          frozen_at_block: 1,
        },
        {
          actor: 'did:tenzro:machine:0xc:a',
          controller: 'did:tenzro:human:xyz',
          controller_kyc_tier: 2,
          delegation_depth: 1,
          has_tombstone: true,
          frozen_at_block: 2,
        },
      ],
    });
    const adapter = new PrincipalChainSdkAdapter(client);
    const list = await adapter.listReceiptsByActor('did:tenzro:machine:0xc:a');
    expect(list.length).toBe(2);
    expect(list[1]?.hasTombstone).toBe(true);
  });
});

describe('PrincipalChainSdkAdapter.summarizeController', () => {
  it('returns null on unknown controller', async () => {
    const { client } = fakeClient();
    const adapter = new PrincipalChainSdkAdapter(client);
    expect(await adapter.summarizeController('did:tenzro:human:xyz')).toBeNull();
  });

  it('decodes a controller activity summary', async () => {
    const { client } = fakeClient({
      summarizeController: async () => ({
        controller_did: 'did:tenzro:human:xyz',
        receipt_count: 42,
        total_value_tnzo: '12345678901234567890',
        agents_acted_under: ['did:tenzro:machine:0xc:a', 'did:tenzro:machine:0xc:b'],
        kill_switch_events: 1,
        kyc_tier_at_oldest: 1,
        kyc_tier_at_newest: 2,
        bond_min: '1000',
        bond_max: '5000',
        since: 1700000000,
        until: null,
      }),
    });
    const adapter = new PrincipalChainSdkAdapter(client);
    const rec = await adapter.summarizeController('did:tenzro:human:xyz');
    expect(rec?.receiptCount).toBe(42n);
    expect(rec?.totalValueTnzo).toBe(12345678901234567890n);
    expect(rec?.agentsActedUnder.length).toBe(2);
    expect(rec?.kycTierAtOldest).toBe(1);
    expect(rec?.kycTierAtNewest).toBe(2);
    expect(rec?.since).toBe(1700000000);
    expect(rec?.until).toBeUndefined();
  });
});
