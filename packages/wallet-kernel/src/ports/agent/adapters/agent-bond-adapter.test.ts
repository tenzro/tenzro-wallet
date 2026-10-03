/**
 * Pin AgentBond adapter — writes are the network's typed transactions, read methods
 * normalise snake/camel field shapes and status strings, return null on
 * unknown bond id.
 */

import type { HybridSigner, TypedTransaction } from 'tenzro-sdk';
import { describe, expect, it } from 'vitest';
import { AgentBondSdkAdapter, type BondClientLike } from './agent-bond-adapter.ts';
import type { TypedTxSender } from './typed-tx.ts';

const signer = {} as HybridSigner;

function fakeSender(): { sender: TypedTxSender; sent: TypedTransaction[] } {
  const sent: TypedTransaction[] = [];
  return {
    sent,
    sender: {
      send: async (s, tx) => {
        expect(s).toBe(signer);
        sent.push(tx);
        return '0xtxhash';
      },
    },
  };
}

function fakeClient(overrides: Partial<BondClientLike> = {}): {
  client: BondClientLike;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: BondClientLike = {
    getAgentBond: async (bondId) => {
      calls.push({ method: 'getAgentBond', args: [bondId] });
      return null;
    },
    listAgentBondsByController: async (controllerDid) => {
      calls.push({
        method: 'listAgentBondsByController',
        args: [controllerDid],
      });
      return { controller_did: controllerDid, count: 0, aggregate_bond: '0', bonds: [] };
    },
    ...overrides,
  };
  return { client, calls };
}

describe('AgentBondSdkAdapter writes', () => {
  it('post sends PostAgentBond with the network field names', async () => {
    const { sender, sent } = fakeSender();
    const adapter = new AgentBondSdkAdapter(fakeClient().client, sender, signer);
    const hash = await adapter.post({
      agentDid: 'did:tenzro:agent:a',
      controllerDid: 'did:tenzro:human:c',
      amount: 2_000_000_000_000_000_000n,
    });
    expect(hash).toBe('0xtxhash');
    expect(sent[0]).toEqual({
      kind: 'PostAgentBond',
      fields: { agent_did: 'did:tenzro:agent:a', controller_did: 'did:tenzro:human:c', amount: 2e18 },
    });
  });

  it('increase and withdraw name the agent', async () => {
    const { sender, sent } = fakeSender();
    const adapter = new AgentBondSdkAdapter(fakeClient().client, sender, signer);
    await adapter.increase({ agentDid: 'did:tenzro:agent:a', amount: 7n });
    await adapter.withdraw({ agentDid: 'did:tenzro:agent:a' });
    expect(sent).toEqual([
      { kind: 'IncreaseAgentBond', fields: { agent_did: 'did:tenzro:agent:a', amount: 7 } },
      { kind: 'WithdrawAgentBond', fields: { agent_did: 'did:tenzro:agent:a' } },
    ]);
  });
});

describe('AgentBondSdkAdapter.get', () => {
  it('returns null on unknown bond id', async () => {
    const { client } = fakeClient();
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
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
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
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
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
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
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
    expect(await adapter.get('0xabc')).toBeNull();
  });
});

describe('AgentBondSdkAdapter.listByController', () => {
  it('returns [] for null/undefined response', async () => {
    const { client } = fakeClient({
      listAgentBondsByController: async () => null as never,
    });
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
    expect(await adapter.listByController('did:tenzro:human:xyz')).toEqual([]);
  });

  it('decodes a list of bonds, dropping rows missing bond_id', async () => {
    const { client } = fakeClient({
      listAgentBondsByController: async () => ({
        controller_did: 'did:tenzro:human:xyz',
        count: 3,
        aggregate_bond: '3',
        bonds: [
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
      }),
    });
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
    const list = await adapter.listByController('did:tenzro:human:xyz');
    expect(list.map((r) => r.bondId)).toEqual(['0xa', '0xb']);
    expect(list[1]?.status).toBe('slashed');
  });
});
