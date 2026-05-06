/**
 * Pin NanopaymentSession orchestration semantics:
 *   - opens channel, tracks totalPaid
 *   - auto-flushes on count threshold
 *   - auto-flushes on amount threshold
 *   - sessionCap throws before any RPC if it would be exceeded
 *   - close flushes residual then closes; idempotent
 */

import { describe, expect, it } from 'vitest';
import type {
  BatchSettlement,
  CloseChannelResult,
  NanoChannel,
  NanopaymentPort,
  NanopaymentReceipt,
  OpenChannelRequest,
  SendNanopaymentRequest,
} from '../ports/agent/nanopayment.ts';
import { NanopaymentSession } from './nanopayment-flow.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakePort(): { port: NanopaymentPort; calls: Call[] } {
  const calls: Call[] = [];
  let seq = 0;
  const channel: NanoChannel = {
    channelId: 'ch-1',
    payer: '0xpayer',
    payee: '0xpayee',
    deposit: 1_000_000n,
    balance: 1_000_000n,
    totalPaid: 0n,
    asset: 'TNZO',
    paymentCount: 0,
    status: 'open',
  };
  const port: NanopaymentPort = {
    openChannel: async (req: OpenChannelRequest) => {
      calls.push({ method: 'openChannel', args: [req] });
      return channel;
    },
    sendNanopayment: async (req: SendNanopaymentRequest): Promise<NanopaymentReceipt> => {
      calls.push({ method: 'sendNanopayment', args: [req] });
      seq += 1;
      return {
        paymentId: `p-${seq}`,
        channelId: req.channelId,
        amount: req.amount,
        sequence: seq,
        ...(req.memo !== undefined ? { memo: req.memo } : {}),
      };
    },
    flushBatch: async (channelId: string): Promise<BatchSettlement> => {
      calls.push({ method: 'flushBatch', args: [channelId] });
      return {
        channelId,
        paymentCount: 0,
        totalAmount: 0n,
        txHash: '0xbatch',
        status: 'Settled',
      };
    },
    closeChannel: async (channelId: string): Promise<CloseChannelResult> => {
      calls.push({ method: 'closeChannel', args: [channelId] });
      return {
        channelId,
        finalAmount: 0n,
        refunded: 0n,
        txHash: '0xclose',
        status: 'Closed',
      };
    },
    getChannel: async () => null,
    listChannels: async () => [],
  };
  return { port, calls };
}

describe('NanopaymentSession', () => {
  it('opens channel and tracks totalPaid across sends', async () => {
    const { port, calls } = fakePort();
    const s = await NanopaymentSession.open(port, {
      payer: '0xpayer',
      payee: '0xpayee',
      deposit: 1_000_000n,
    });
    await s.send(100n);
    await s.send(250n);
    expect(s.totalPaid).toBe(350n);
    expect(s.channelId).toBe('ch-1');
    expect(calls.filter((c) => c.method === 'sendNanopayment')).toHaveLength(2);
  });

  it('auto-flushes on count threshold', async () => {
    const { port, calls } = fakePort();
    const s = await NanopaymentSession.open(
      port,
      { payer: '0xp', payee: '0xq', deposit: 1n },
      { flushEvery: 3 },
    );
    await s.send(1n);
    await s.send(1n);
    expect(calls.filter((c) => c.method === 'flushBatch')).toHaveLength(0);
    await s.send(1n); // 3rd send → flush
    expect(calls.filter((c) => c.method === 'flushBatch')).toHaveLength(1);
  });

  it('auto-flushes on amount threshold', async () => {
    const { port, calls } = fakePort();
    const s = await NanopaymentSession.open(
      port,
      { payer: '0xp', payee: '0xq', deposit: 1_000_000n },
      { flushAtAmount: 1_000n, flushEvery: 0 },
    );
    await s.send(400n);
    expect(calls.filter((c) => c.method === 'flushBatch')).toHaveLength(0);
    await s.send(700n); // accum 1100 ≥ 1000 → flush
    expect(calls.filter((c) => c.method === 'flushBatch')).toHaveLength(1);
  });

  it('sessionCap throws before sending if exceeded', async () => {
    const { port, calls } = fakePort();
    const s = await NanopaymentSession.open(
      port,
      { payer: '0xp', payee: '0xq', deposit: 1_000_000n },
      { sessionCap: 500n },
    );
    await s.send(300n);
    await expect(s.send(300n)).rejects.toThrow(/session cap/);
    // Second send must NOT have hit the port.
    expect(calls.filter((c) => c.method === 'sendNanopayment')).toHaveLength(1);
  });

  it('close flushes residual then closes; second close is a no-op', async () => {
    const { port, calls } = fakePort();
    const s = await NanopaymentSession.open(port, {
      payer: '0xp',
      payee: '0xq',
      deposit: 1n,
    });
    await s.send(1n);
    await s.close();
    expect(calls.map((c) => c.method)).toEqual([
      'openChannel',
      'sendNanopayment',
      'flushBatch',
      'closeChannel',
    ]);
    await s.close(); // idempotent
    expect(calls.filter((c) => c.method === 'closeChannel')).toHaveLength(1);
  });

  it('send after close throws', async () => {
    const { port } = fakePort();
    const s = await NanopaymentSession.open(port, {
      payer: '0xp',
      payee: '0xq',
      deposit: 1n,
    });
    await s.close();
    await expect(s.send(1n)).rejects.toThrow(/closed/);
  });
});
