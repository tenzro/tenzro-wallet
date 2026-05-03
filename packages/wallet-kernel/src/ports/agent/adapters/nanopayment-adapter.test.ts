/**
 * Pin the nanopayment adapter's wire-shape mapping. Channel state moves
 * through the SDK as snake_case + decimal strings; the adapter is the
 * single seam where it becomes camelCase + bigint.
 */

import { describe, expect, it } from 'vitest';
import {
  NanopaymentSdkAdapter,
  type NanopaymentClientLike,
} from './nanopayment-adapter.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeClient(
  overrides: Partial<NanopaymentClientLike> = {},
): { client: NanopaymentClientLike; calls: Call[] } {
  const calls: Call[] = [];
  const channel = {
    channel_id: 'ch-1',
    payer: '0xpayer',
    payee: '0xpayee',
    deposit: '1000000000000000000',
    balance: '900000000000000000',
    total_paid: '100000000000000000',
    asset: 'TNZO',
    payment_count: 5,
    status: 'open' as const,
  };
  const client: NanopaymentClientLike = {
    openChannel: async (payer, payee, deposit, asset) => {
      calls.push({ method: 'openChannel', args: [payer, payee, deposit, asset] });
      return channel;
    },
    sendNanopayment: async (channelId, amount, memo) => {
      calls.push({ method: 'sendNanopayment', args: [channelId, amount, memo] });
      return {
        payment_id: 'p-1',
        channel_id: channelId,
        amount,
        ...(memo !== undefined ? { memo } : {}),
        sequence: 6,
      };
    },
    flushBatch: async (channelId) => {
      calls.push({ method: 'flushBatch', args: [channelId] });
      return {
        channel_id: channelId,
        payment_count: 5,
        total_amount: '100000000000000000',
        tx_hash: '0xflush',
        status: 'settled',
      };
    },
    closeChannel: async (channelId) => {
      calls.push({ method: 'closeChannel', args: [channelId] });
      return {
        channel_id: channelId,
        final_amount: '100000000000000000',
        refunded: '900000000000000000',
        tx_hash: '0xclose',
        status: 'closed',
      };
    },
    getChannel: async (channelId) => {
      calls.push({ method: 'getChannel', args: [channelId] });
      return channel;
    },
    listChannels: async (address) => {
      calls.push({ method: 'listChannels', args: [address] });
      return [channel];
    },
    ...overrides,
  };
  return { client, calls };
}

describe('NanopaymentSdkAdapter', () => {
  it('openChannel maps bigint deposit → decimal string and defaults asset to TNZO', async () => {
    const { client, calls } = fakeClient();
    const adapter = new NanopaymentSdkAdapter(client);
    const ch = await adapter.openChannel({
      payer: '0xpayer',
      payee: '0xpayee',
      deposit: 1n * 10n ** 18n,
    });
    expect(calls[0]?.args).toEqual([
      '0xpayer',
      '0xpayee',
      '1000000000000000000',
      'TNZO',
    ]);
    expect(ch.deposit).toBe(1n * 10n ** 18n);
    expect(ch.balance).toBe(900_000_000_000_000_000n);
    expect(ch.totalPaid).toBe(100_000_000_000_000_000n);
    expect(ch.paymentCount).toBe(5);
    expect(ch.status).toBe('open');
  });

  it('sendNanopayment forwards memo when provided', async () => {
    const { client, calls } = fakeClient();
    const adapter = new NanopaymentSdkAdapter(client);
    const r = await adapter.sendNanopayment({
      channelId: 'ch-1',
      amount: 1_000n,
      memo: 'token-42',
    });
    expect(calls[0]?.args).toEqual(['ch-1', '1000', 'token-42']);
    expect(r.amount).toBe(1_000n);
    expect(r.memo).toBe('token-42');
    expect(r.sequence).toBe(6);
  });

  it('flushBatch maps total_amount → bigint + tx_hash → camelCase', async () => {
    const { client } = fakeClient();
    const adapter = new NanopaymentSdkAdapter(client);
    const s = await adapter.flushBatch('ch-1');
    expect(s.totalAmount).toBe(100_000_000_000_000_000n);
    expect(s.txHash).toBe('0xflush');
    expect(s.status).toBe('settled');
  });

  it('closeChannel maps final_amount + refunded as bigints', async () => {
    const { client } = fakeClient();
    const adapter = new NanopaymentSdkAdapter(client);
    const c = await adapter.closeChannel('ch-1');
    expect(c.finalAmount).toBe(100_000_000_000_000_000n);
    expect(c.refunded).toBe(900_000_000_000_000_000n);
    expect(c.txHash).toBe('0xclose');
  });

  it('returns null when getChannel throws', async () => {
    const { client } = fakeClient({
      getChannel: async () => {
        throw new Error('not found');
      },
    });
    const adapter = new NanopaymentSdkAdapter(client);
    expect(await adapter.getChannel('missing')).toBeNull();
  });
});
