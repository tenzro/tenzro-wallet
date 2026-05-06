/**
 * Pin the ACP adapter's wire-shape mapping. The SDK doesn't yet expose an
 * `AcpClient`; once it does, the structural `AcpClientLike` becomes the
 * SDK type — but the mapping these tests pin is what the swap will keep
 * stable.
 */

import { describe, expect, it } from 'vitest';
import { type AcpClientLike, AcpSdkAdapter } from './acp-adapter.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeClient(overrides: Partial<AcpClientLike> = {}): {
  client: AcpClientLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client: AcpClientLike = {
    getSession: async (sessionId) => {
      calls.push({ method: 'getSession', args: [sessionId] });
      return {
        session_id: sessionId,
        merchant: 'merchant.example',
        line_items: [
          {
            sku: 'SKU-1',
            description: 'thing',
            quantity: 2,
            unit_price: '12.50',
          },
        ],
        total: '25.00',
        currency: 'USD',
        psp: 'stripe',
        expires_at: 1_800_000_000_000,
      };
    },
    authorize: async (body) => {
      calls.push({ method: 'authorize', args: [body] });
      return {
        session_id: body.session_id,
        authorization_id: 'auth-1',
        status: 'authorised',
      };
    },
    cancel: async (sessionId) => {
      calls.push({ method: 'cancel', args: [sessionId] });
    },
    ...overrides,
  };
  return { client, calls };
}

describe('AcpSdkAdapter', () => {
  it('getSession maps snake_case → camelCase incl. nested line items', async () => {
    const { client } = fakeClient();
    const adapter = new AcpSdkAdapter(client);
    const session = await adapter.getSession('s-1');
    expect(session.sessionId).toBe('s-1');
    expect(session.merchant).toBe('merchant.example');
    expect(session.lineItems).toEqual([
      {
        sku: 'SKU-1',
        description: 'thing',
        quantity: 2,
        unitPrice: '12.50',
      },
    ]);
    expect(session.total).toBe('25.00');
    expect(session.expiresAt).toBe(1_800_000_000_000);
  });

  it('authorize forwards camelCase → snake_case body', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AcpSdkAdapter(client);
    const result = await adapter.authorize({
      sessionId: 's-1',
      buyer: 'did:tenzro:buyer',
      paymentMethod: 'pm_card_visa',
    });
    expect(calls[0]?.args).toEqual([
      {
        session_id: 's-1',
        buyer: 'did:tenzro:buyer',
        payment_method: 'pm_card_visa',
      },
    ]);
    expect(result.sessionId).toBe('s-1');
    expect(result.authorizationId).toBe('auth-1');
    expect(result.status).toBe('authorised');
  });

  it('authorize includes reason when present, omits when absent (exactOptional)', async () => {
    const { client: declined } = fakeClient({
      authorize: async (body) => ({
        session_id: body.session_id,
        authorization_id: 'auth-2',
        status: 'declined',
        reason: 'insufficient_funds',
      }),
    });
    const adapter = new AcpSdkAdapter(declined);
    const result = await adapter.authorize({
      sessionId: 's-2',
      buyer: 'did:tenzro:buyer',
      paymentMethod: 'pm_card_visa',
    });
    expect(result.reason).toBe('insufficient_funds');

    const { client: ok } = fakeClient();
    const adapterOk = new AcpSdkAdapter(ok);
    const okResult = await adapterOk.authorize({
      sessionId: 's-3',
      buyer: 'did:tenzro:buyer',
      paymentMethod: 'pm_card_visa',
    });
    // No `reason` key at all when absent.
    expect('reason' in okResult).toBe(false);
  });

  it('cancel forwards sessionId and returns void', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AcpSdkAdapter(client);
    await adapter.cancel('s-9');
    expect(calls[0]).toEqual({ method: 'cancel', args: ['s-9'] });
  });
});
