/**
 * AgentBond adapter: writes are the network's typed transactions; reads decode
 * the chain bond records the SDK returns.
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
    getAgentBond: async (agentDid) => {
      calls.push({ method: 'getAgentBond', args: [agentDid] });
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
      fields: {
        agent_did: 'did:tenzro:agent:a',
        controller_did: 'did:tenzro:human:c',
        amount: 2e18,
      },
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

const BOND = {
  agent_did: 'did:tenzro:agent:abc',
  controller_did: 'did:tenzro:human:xyz',
  amount: '5000000000000000000',
  state: 'Active' as const,
  cooldown_until_ms: null,
  vault: 'aa'.repeat(20),
};

describe('AgentBondSdkAdapter.get', () => {
  it('returns null for an agent with no bond', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
    expect(await adapter.get('did:tenzro:agent:none')).toBeNull();
    expect(calls).toEqual([{ method: 'getAgentBond', args: ['did:tenzro:agent:none'] }]);
  });

  it('decodes the chain record', async () => {
    const { client } = fakeClient({ getAgentBond: async () => BOND });
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
    expect(await adapter.get(BOND.agent_did)).toEqual({
      agentDid: BOND.agent_did,
      controllerDid: BOND.controller_did,
      amount: 5_000_000_000_000_000_000n,
      state: 'active',
      cooldownUntilMs: null,
      vault: BOND.vault,
    });
  });

  it('carries the cooldown end of a withdrawal', async () => {
    const { client } = fakeClient({
      getAgentBond: async () => ({
        ...BOND,
        state: 'Cooldown' as const,
        cooldown_until_ms: 1700700000,
      }),
    });
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
    const rec = await adapter.get(BOND.agent_did);
    expect(rec?.state).toBe('cooldown');
    expect(rec?.cooldownUntilMs).toBe(1700700000);
  });
});

describe('AgentBondSdkAdapter.listByController', () => {
  it('returns [] when the controller has posted none', async () => {
    const { client } = fakeClient();
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
    expect(await adapter.listByController('did:tenzro:human:xyz')).toEqual([]);
  });

  it('decodes every bond in the list', async () => {
    const { client } = fakeClient({
      listAgentBondsByController: async (controllerDid) => ({
        controller_did: controllerDid,
        count: 2,
        aggregate_bond: '5000000000000000000',
        bonds: [BOND, { ...BOND, agent_did: 'did:tenzro:agent:def', state: 'Slashed' as const }],
      }),
    });
    const adapter = new AgentBondSdkAdapter(client, fakeSender().sender, signer);
    const list = await adapter.listByController('did:tenzro:human:xyz');
    expect(list.map((b) => [b.agentDid, b.state])).toEqual([
      ['did:tenzro:agent:abc', 'active'],
      ['did:tenzro:agent:def', 'slashed'],
    ]);
  });
});
