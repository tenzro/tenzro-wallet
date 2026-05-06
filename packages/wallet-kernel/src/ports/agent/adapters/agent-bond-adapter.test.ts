/**
 * Pin AgentBond adapter — write methods forward verbatim, read methods
 * normalise snake/camel field shapes and status strings, return null on
 * unknown bond id.
 */

import { describe, expect, it } from 'vitest';
import { AgentBondSdkAdapter, type BondClientLike } from './agent-bond-adapter.ts';

function fakeClient(overrides: Partial<BondClientLike> = {}): {
  client: BondClientLike;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: BondClientLike = {
    postAgentBond: async (controller, agentDid, controllerDid, amount) => {
      calls.push({
        method: 'postAgentBond',
        args: [controller, agentDid, controllerDid, amount],
      });
      return '0xtxhash-post';
    },
    increaseAgentBond: async (controller, agentDid, amount) => {
      calls.push({
        method: 'increaseAgentBond',
        args: [controller, agentDid, amount],
      });
      return '0xtxhash-increase';
    },
    withdrawAgentBond: async (controller, agentDid) => {
      calls.push({ method: 'withdrawAgentBond', args: [controller, agentDid] });
      return '0xtxhash-withdraw';
    },
    getAgentBond: async (bondId) => {
      calls.push({ method: 'getAgentBond', args: [bondId] });
      return null;
    },
    listAgentBondsByController: async (controllerDid) => {
      calls.push({
        method: 'listAgentBondsByController',
        args: [controllerDid],
      });
      return [];
    },
    ...overrides,
  };
  return { client, calls };
}

describe('AgentBondSdkAdapter.post', () => {
  it('forwards every field', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AgentBondSdkAdapter(client);
    const hash = await adapter.post({
      controller: '0xctl',
      agentDid: 'did:tenzro:machine:0xctl:abc',
      controllerDid: 'did:tenzro:human:xyz',
      amount: 5_000_000_000_000_000_000n,
    });
    expect(hash).toBe('0xtxhash-post');
    expect(calls[0]?.args).toEqual([
      '0xctl',
      'did:tenzro:machine:0xctl:abc',
      'did:tenzro:human:xyz',
      5_000_000_000_000_000_000n,
    ]);
  });
});

describe('AgentBondSdkAdapter.increase', () => {
  it('forwards (controller, agentDid, amount)', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AgentBondSdkAdapter(client);
    const hash = await adapter.increase({
      controller: '0xctl',
      agentDid: 'did:tenzro:machine:0xctl:abc',
      amount: 1_000_000_000_000_000_000n,
    });
    expect(hash).toBe('0xtxhash-increase');
    expect(calls[0]?.args).toEqual([
      '0xctl',
      'did:tenzro:machine:0xctl:abc',
      1_000_000_000_000_000_000n,
    ]);
  });
});

describe('AgentBondSdkAdapter.withdraw', () => {
  it('forwards (controller, agentDid)', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AgentBondSdkAdapter(client);
    const hash = await adapter.withdraw({
      controller: '0xctl',
      agentDid: 'did:tenzro:machine:0xctl:abc',
    });
    expect(hash).toBe('0xtxhash-withdraw');
    expect(calls[0]?.args).toEqual(['0xctl', 'did:tenzro:machine:0xctl:abc']);
  });
});

describe('AgentBondSdkAdapter.get', () => {
  it('returns null on unknown bond id', async () => {
    const { client } = fakeClient();
    const adapter = new AgentBondSdkAdapter(client);
    expect(await adapter.get('0xdeadbeef')).toBeNull();
  });

  it('decodes snake_case fields, normalises active status', async () => {
    const { client } = fakeClient({
      getAgentBond: async () => ({
        bond_id: '0xabc',
        agent_did: 'did:tenzro:machine:0xctl:abc',
        controller_did: 'did:tenzro:human:xyz',
        controller: '0xctl',
        amount: '5000000000000000000',
        slashed_amount: '0',
        status: 'Active',
        posted_at: 1700000000,
      }),
    });
    const adapter = new AgentBondSdkAdapter(client);
    const rec = await adapter.get('0xabc');
    expect(rec).toEqual({
      bondId: '0xabc',
      agentDid: 'did:tenzro:machine:0xctl:abc',
      controllerDid: 'did:tenzro:human:xyz',
      controller: '0xctl',
      amount: 5_000_000_000_000_000_000n,
      slashedAmount: 0n,
      status: 'active',
      postedAt: 1700000000,
      withdrawInitiatedAt: undefined,
      cooldownEndsAt: undefined,
    });
  });

  it('decodes cooldown record with cooldown_ends_at', async () => {
    const { client } = fakeClient({
      getAgentBond: async () => ({
        bond_id: '0xabc',
        agent_did: 'did:tenzro:machine:0xctl:abc',
        controller: '0xctl',
        amount: 1n.toString(),
        status: 'cooldown',
        posted_at: 1700000000,
        withdraw_initiated_at: 1700100000,
        cooldown_ends_at: 1700700000,
      }),
    });
    const adapter = new AgentBondSdkAdapter(client);
    const rec = await adapter.get('0xabc');
    expect(rec?.status).toBe('cooldown');
    expect(rec?.withdrawInitiatedAt).toBe(1700100000);
    expect(rec?.cooldownEndsAt).toBe(1700700000);
  });

  it('returns null when bond_id is missing', async () => {
    const { client } = fakeClient({
      getAgentBond: async () =>
        ({
          agent_did: 'did:tenzro:machine:0xctl:abc',
        }) as unknown as null,
    });
    const adapter = new AgentBondSdkAdapter(client);
    expect(await adapter.get('0xabc')).toBeNull();
  });
});

describe('AgentBondSdkAdapter.listByController', () => {
  it('returns [] for null/undefined response', async () => {
    const { client } = fakeClient({
      listAgentBondsByController: async () => null as unknown as never[],
    });
    const adapter = new AgentBondSdkAdapter(client);
    expect(await adapter.listByController('did:tenzro:human:xyz')).toEqual([]);
  });

  it('decodes a list of bonds, dropping rows missing bond_id', async () => {
    const { client } = fakeClient({
      listAgentBondsByController: async () => [
        {
          bond_id: '0xa',
          agent_did: 'did:tenzro:machine:0xctl:a',
          controller: '0xctl',
          amount: '1',
          status: 'active',
          posted_at: 1,
        },
        { agent_did: 'no-bond-id' }, // dropped
        {
          bond_id: '0xb',
          agent_did: 'did:tenzro:machine:0xctl:b',
          controller: '0xctl',
          amount: '2',
          status: 'slashed',
          posted_at: 2,
        },
      ],
    });
    const adapter = new AgentBondSdkAdapter(client);
    const list = await adapter.listByController('did:tenzro:human:xyz');
    expect(list.map((r) => r.bondId)).toEqual(['0xa', '0xb']);
    expect(list[1]?.status).toBe('slashed');
  });
});
