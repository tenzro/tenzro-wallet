/**
 * Pin PaymentRails adapter — each rail forwards correctly, receipts
 * normalise from the heterogenous engine shapes (snake_case + camelCase
 * mixed across rails).
 */

import { describe, expect, it } from 'vitest';
import {
  PaymentRailsSdkAdapter,
  type PaymentClientLike,
} from './payment-rails-adapter.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeClient(
  overrides: Partial<PaymentClientLike> = {},
): { client: PaymentClientLike; calls: Call[] } {
  const calls: Call[] = [];
  const client: PaymentClientLike = {
    createChallenge: async (resource, amount, asset, protocol) => {
      calls.push({
        method: 'createChallenge',
        args: [resource, amount, asset, protocol],
      });
      return {
        challengeId: 'ch-1',
        resource,
        amount,
        asset: asset ?? 'USDC',
        protocol: protocol ?? 'mpp',
      };
    },
    // SDK PaymentReceipt is camelCase; extra fields like `tx_hash` /
    // `transaction_hash` slip through because the gateway response shape
    // varies per rail. Tests cast via `unknown` to exercise the
    // adapter's snake/camel reconciliation.
    payMpp: async (url, payerDid) => {
      calls.push({ method: 'payMpp', args: [url, payerDid] });
      return {
        receiptId: 'r-mpp',
        protocol: 'mpp',
        amount: 0,
        asset: 'USDC',
        status: 'Settled',
        tx_hash: '0xmpp',
      } as unknown as Awaited<ReturnType<PaymentClientLike['payMpp']>>;
    },
    payX402: async (url, payerDid) => {
      calls.push({ method: 'payX402', args: [url, payerDid] });
      return {
        receiptId: 'r-x402',
        protocol: 'x402',
        amount: 0,
        asset: 'USDC',
        status: 'Settled',
        txHash: '0xx402',
      } as unknown as Awaited<ReturnType<PaymentClientLike['payX402']>>;
    },
    payAp2: async (agentDid, url, amount) => {
      calls.push({ method: 'payAp2', args: [agentDid, url, amount] });
      return {
        receiptId: 'r-ap2',
        protocol: 'ap2',
        amount: 0,
        asset: 'USDC',
        status: 'Approved',
        transaction_hash: '0xap2',
      } as unknown as Awaited<ReturnType<PaymentClientLike['payAp2']>>;
    },
    payVisaTap: async (credential) => {
      calls.push({ method: 'payVisaTap', args: [credential] });
      // Visa TAP is `any`-typed in SDK — gateway shape varies.
      return { receipt_id: 'r-visa', status: 'Captured' };
    },
    payMastercard: async (credential) => {
      calls.push({ method: 'payMastercard', args: [credential] });
      // Mastercard is `any`-typed in SDK — gateway shape varies.
      return { receipt_id: 'r-mc', state: 'Approved' };
    },
    getReceipt: async (receiptId) => {
      calls.push({ method: 'getReceipt', args: [receiptId] });
      return {
        receiptId,
        protocol: 'mpp',
        amount: 0,
        asset: 'USDC',
        status: 'Settled',
      };
    },
    ...overrides,
  };
  return { client, calls };
}

describe('PaymentRailsSdkAdapter.createChallenge', () => {
  it('forwards positional args + defaults asset/protocol from raw response', async () => {
    const { client, calls } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    const r = await adapter.createChallenge({
      resource: 'https://api.x.com/data',
      amount: 1_000,
    });
    expect(r.challengeId).toBe('ch-1');
    expect(r.protocol).toBe('mpp');
    expect(calls[0]?.args).toEqual([
      'https://api.x.com/data',
      1_000,
      undefined,
      undefined,
    ]);
  });
});

describe('PaymentRailsSdkAdapter.pay* rails', () => {
  it('payMpp normalises snake_case receipt', async () => {
    const { client } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    const r = await adapter.payMpp({ url: 'https://x' });
    expect(r.receiptId).toBe('r-mpp');
    expect(r.status).toBe('Settled');
    expect(r.txHash).toBe('0xmpp');
  });

  it('payX402 normalises camelCase receipt', async () => {
    const { client } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    const r = await adapter.payX402({ url: 'https://y' });
    expect(r.receiptId).toBe('r-x402');
    expect(r.txHash).toBe('0xx402');
  });

  it('payAp2 forwards decimal-string amount + maps transaction_hash', async () => {
    const { client, calls } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    const r = await adapter.payAp2({
      agentDid: 'did:tenzro:machine:agent-1',
      url: 'https://z',
      amount: '1.234567',
    });
    expect(calls[0]?.args).toEqual([
      'did:tenzro:machine:agent-1',
      'https://z',
      '1.234567',
    ]);
    expect(r.txHash).toBe('0xap2');
    expect(r.status).toBe('Approved');
  });

  it('payVisaTap forwards opaque credential verbatim', async () => {
    const { client, calls } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    const cred = { iss: 'visa.com', sub: 'card-123', sig: '0xabc' };
    const r = await adapter.payVisaTap({ credential: cred });
    expect(calls[0]?.args[0]).toEqual(cred);
    expect(r.status).toBe('Captured');
    expect('txHash' in r).toBe(false);
  });

  it('payMastercard accepts state field as fallback for status', async () => {
    const { client } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    const r = await adapter.payMastercard({
      credential: { token_kind: 'SessionBound', token: 'tok' },
    });
    expect(r.status).toBe('Approved');
  });
});

describe('PaymentRailsSdkAdapter.getReceipt', () => {
  it('returns null when SDK throws (receipt 404)', async () => {
    const { client } = fakeClient({
      getReceipt: async () => {
        throw new Error('not found');
      },
    });
    const adapter = new PaymentRailsSdkAdapter(client);
    expect(await adapter.getReceipt('r-x')).toBeNull();
  });

  it('reads receiptId from the SDK shape', async () => {
    const { client } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    const r = await adapter.getReceipt('r-x');
    expect(r?.receiptId).toBe('r-x');
  });
});

describe('PaymentRailsSdkAdapter — SDK-pending hooks', () => {
  it('signVisaTap throws when client lacks the method', async () => {
    const { client } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    await expect(
      adapter.signVisaTap({
        request: { method: 'POST', url: 'https://m', headers: {} },
        agentDid: 'did:tenzro:agent',
      }),
    ).rejects.toThrow(/SDK pending/);
  });

  it('signVisaTap forwards body when present and maps headers back', async () => {
    const calls: Call[] = [];
    const { client } = fakeClient({
      signVisaTap: async (body) => {
        calls.push({ method: 'signVisaTap', args: [body] });
        return {
          headers: { ...body.headers, Signature: 'sig=:abc:' },
          url: body.url,
          method: body.method,
        };
      },
    });
    const adapter = new PaymentRailsSdkAdapter(client);
    const signed = await adapter.signVisaTap({
      request: {
        method: 'POST',
        url: 'https://merchant/charge',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
      },
      agentDid: 'did:tenzro:agent',
    });
    expect(calls[0]?.args[0]).toEqual({
      method: 'POST',
      url: 'https://merchant/charge',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      agent_did: 'did:tenzro:agent',
    });
    expect(signed.headers.Signature).toBe('sig=:abc:');
  });

  it('issueMastercardToken throws when client lacks the method', async () => {
    const { client } = fakeClient();
    const adapter = new PaymentRailsSdkAdapter(client);
    await expect(
      adapter.issueMastercardToken({
        agentDid: 'did:tenzro:agent',
        kind: 'SingleUse',
        params: {},
      }),
    ).rejects.toThrow(/SDK pending/);
  });

  it('issueMastercardToken maps snake_case → camelCase + retains raw', async () => {
    const { client } = fakeClient({
      issueMastercardToken: async () => ({
        token_id: 'tok-1',
        kind: 'Recurring',
        cap: '500.00',
        expires_at: 1_900_000_000_000,
        // Mastercard returns extra fields the wallet should retain in `raw`.
        scheduling: { interval: 'monthly' },
      }),
    });
    const adapter = new PaymentRailsSdkAdapter(client);
    const token = await adapter.issueMastercardToken({
      agentDid: 'did:tenzro:agent',
      kind: 'Recurring',
      params: { interval: 'monthly' },
    });
    expect(token.tokenId).toBe('tok-1');
    expect(token.kind).toBe('Recurring');
    expect(token.cap).toBe('500.00');
    expect(token.expiresAt).toBe(1_900_000_000_000);
    expect((token.raw as { scheduling: unknown }).scheduling).toEqual({
      interval: 'monthly',
    });
  });
});
