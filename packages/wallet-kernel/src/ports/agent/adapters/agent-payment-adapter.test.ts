/**
 * Pin the agent-payment adapter's wire-shape mapping. Spending policies are
 * authoritative server-side; the adapter is the wallet's shape-translation
 * layer for getting them in/out as bigints + camelCase.
 */

import { describe, expect, it } from 'vitest';
import { type AgentPaymentClientLike, AgentPaymentSdkAdapter } from './agent-payment-adapter.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeClient(overrides: Partial<AgentPaymentClientLike> = {}): {
  client: AgentPaymentClientLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const policy = {
    agent_did: 'did:tenzro:agent',
    max_per_transaction: '5000000000000000000',
    max_daily_spend: '50000000000000000000',
    allowed_services: ['inference', 'storage'],
    active: true,
  };
  const client: AgentPaymentClientLike = {
    setSpendingPolicy: async (agentDid, body) => {
      calls.push({ method: 'setSpendingPolicy', args: [agentDid, body] });
      return { agent_did: agentDid, status: 'ok' };
    },
    getSpendingPolicy: async (agentDid) => {
      calls.push({ method: 'getSpendingPolicy', args: [agentDid] });
      return policy;
    },
    payForService: async (agentDid, provider, amount, serviceType) => {
      calls.push({
        method: 'payForService',
        args: [agentDid, provider, amount, serviceType],
      });
      return {
        receipt_id: 'rcpt-1',
        agent_did: agentDid,
        provider,
        amount,
        service_type: serviceType,
        tx_hash: '0xabc',
      };
    },
    getDailySpend: async (agentDid) => {
      calls.push({ method: 'getDailySpend', args: [agentDid] });
      return {
        agent_did: agentDid,
        total_spent: '1000000000000000000',
        daily_limit: '50000000000000000000',
        remaining: '49000000000000000000',
        transaction_count: 3,
      };
    },
    listAgentTransactions: async (agentDid, limit) => {
      calls.push({ method: 'listAgentTransactions', args: [agentDid, limit] });
      return [
        {
          tx_id: 't-1',
          agent_did: agentDid,
          recipient: '0xprovider',
          amount: '1000000000000000000',
          service_type: 'inference',
          status: 'confirmed',
        },
      ];
    },
    ...overrides,
  };
  return { client, calls };
}

describe('AgentPaymentSdkAdapter', () => {
  it('setSpendingPolicy maps bigint → decimal string + snake_case body', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AgentPaymentSdkAdapter(client);
    await adapter.setSpendingPolicy({
      agentDid: 'did:tenzro:agent',
      maxPerTransaction: 5n * 10n ** 18n,
      maxDailySpend: 50n * 10n ** 18n,
      allowedServices: ['inference'],
      active: true,
    });
    expect(calls[0]?.args).toEqual([
      'did:tenzro:agent',
      {
        max_per_transaction: '5000000000000000000',
        max_daily_spend: '50000000000000000000',
        allowed_services: ['inference'],
        active: true,
      },
    ]);
  });

  it('getSpendingPolicy round-trips amounts as bigints', async () => {
    const { client } = fakeClient();
    const adapter = new AgentPaymentSdkAdapter(client);
    const policy = await adapter.getSpendingPolicy('did:tenzro:agent');
    expect(policy?.maxPerTransaction).toBe(5n * 10n ** 18n);
    expect(policy?.maxDailySpend).toBe(50n * 10n ** 18n);
    expect(policy?.allowedServices).toEqual(['inference', 'storage']);
  });

  it('returns null when getSpendingPolicy throws (e.g. 404)', async () => {
    const { client } = fakeClient({
      getSpendingPolicy: async () => {
        throw new Error('not found');
      },
    });
    const adapter = new AgentPaymentSdkAdapter(client);
    expect(await adapter.getSpendingPolicy('missing')).toBeNull();
  });

  it('payForService maps decimal amount + service type', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AgentPaymentSdkAdapter(client);
    const receipt = await adapter.payForService({
      agentDid: 'did:tenzro:agent',
      provider: '0xprovider',
      amount: 250_000_000_000_000_000n,
      serviceType: 'inference',
    });
    expect(calls[0]?.args).toEqual([
      'did:tenzro:agent',
      '0xprovider',
      '250000000000000000',
      'inference',
    ]);
    expect(receipt.amount).toBe(250_000_000_000_000_000n);
    expect(receipt.txHash).toBe('0xabc');
  });

  it('getDailySpend maps total_spent/daily_limit/remaining → bigint', async () => {
    const { client } = fakeClient();
    const adapter = new AgentPaymentSdkAdapter(client);
    const spend = await adapter.getDailySpend('did:tenzro:agent');
    expect(spend.totalSpent).toBe(1n * 10n ** 18n);
    expect(spend.dailyLimit).toBe(50n * 10n ** 18n);
    expect(spend.remaining).toBe(49n * 10n ** 18n);
    expect(spend.transactionCount).toBe(3);
  });

  it('listAgentTransactions threads optional limit and maps records', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AgentPaymentSdkAdapter(client);
    const txs = await adapter.listAgentTransactions('did:tenzro:agent', 10);
    expect(calls[0]?.args).toEqual(['did:tenzro:agent', 10]);
    expect(txs[0]?.amount).toBe(1n * 10n ** 18n);
    expect(txs[0]?.serviceType).toBe('inference');
  });
});
