/**
 * Pin the AP2 adapter's wire-shape mapping. The adapter is the only place
 * in the kernel that knows the SDK's snake_case + decimal-string shape,
 * so these tests are the seam: if the SDK shape shifts, they fail first.
 */

import { describe, expect, it } from 'vitest';
import { type Ap2ClientLike, Ap2SdkAdapter } from './ap2-adapter.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeClient(overrides: Partial<Ap2ClientLike> = {}): {
  client: Ap2ClientLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const session = {
    session_id: 's-1',
    agent_did: 'did:tenzro:agent',
    provider_did: 'did:tenzro:provider',
    service: 'inference',
    max_amount: '1000000000000000000',
    total_spent: '250000000000000000',
    asset: 'TNZO',
    status: 'active' as const,
    created_at: 1_800_000_000,
  };
  const client: Ap2ClientLike = {
    verifyMandate: async (vdc) => {
      calls.push({ method: 'verifyMandate', args: [vdc] });
      return {
        valid: true,
        mandate_type: 'Intent',
        issuer: 'did:web:user.example',
        subject: 'did:tenzro:agent',
        expires_at: 1_800_000_000,
      };
    },
    validateMandatePair: async (i, c, ed) => {
      calls.push({ method: 'validateMandatePair', args: [i, c, ed] });
      return { valid: true, delegation_enforced: ed ?? false };
    },
    createSession: async (agentDid, providerDid, service, maxAmount, asset) => {
      calls.push({
        method: 'createSession',
        args: [agentDid, providerDid, service, maxAmount, asset],
      });
      return session;
    },
    authorizePayment: async (sid, amount) => {
      calls.push({ method: 'authorizePayment', args: [sid, amount] });
      return {
        authorization_id: 'a-1',
        session_id: sid,
        amount,
        status: 'approved',
        created_at: 1_800_000_000,
      };
    },
    executePayment: async (sid, aid) => {
      calls.push({ method: 'executePayment', args: [sid, aid] });
      return {
        receiptId: 'r-1',
        protocol: 'ap2',
        sessionId: sid,
        amount: 1,
        asset: 'TNZO',
      };
    },
    cancelSession: async (sid) => {
      calls.push({ method: 'cancelSession', args: [sid] });
      return { session_id: sid, status: 'cancelled', refunded_amount: '750000000000000000' };
    },
    getSession: async (sid) => {
      calls.push({ method: 'getSession', args: [sid] });
      return session;
    },
    listAgentSessions: async (agentDid) => {
      calls.push({ method: 'listAgentSessions', args: [agentDid] });
      return [session];
    },
    ...overrides,
  };
  return { client, calls };
}

describe('Ap2SdkAdapter', () => {
  it('maps camelCase createSession to the SDK positional + decimal-string args', async () => {
    const { client, calls } = fakeClient();
    const adapter = new Ap2SdkAdapter(client);
    const session = await adapter.createSession({
      agentDid: 'did:tenzro:agent',
      providerDid: 'did:tenzro:provider',
      service: 'inference',
      maxAmount: 1n * 10n ** 18n,
    });
    expect(calls[0]?.args).toEqual([
      'did:tenzro:agent',
      'did:tenzro:provider',
      'inference',
      '1000000000000000000',
      'TNZO',
    ]);
    expect(session.maxAmount).toBe(1n * 10n ** 18n);
    expect(session.totalSpent).toBe(250_000_000_000_000_000n);
    expect(session.status).toBe('active');
  });

  it('round-trips bigint amounts through authorizePayment as decimal strings', async () => {
    const { client, calls } = fakeClient();
    const adapter = new Ap2SdkAdapter(client);
    const auth = await adapter.authorizePayment('s-1', 42_000_000_000_000_000n);
    expect(calls[0]?.args).toEqual(['s-1', '42000000000000000']);
    expect(auth.amount).toBe(42_000_000_000_000_000n);
    expect(auth.status).toBe('approved');
  });

  it('maps refunded_amount → refundedAmount as bigint', async () => {
    const { client } = fakeClient();
    const adapter = new Ap2SdkAdapter(client);
    const result = await adapter.cancelSession('s-1');
    expect(result.refundedAmount).toBe(750_000_000_000_000_000n);
  });

  it('returns null instead of throwing when getSession 404s', async () => {
    const { client } = fakeClient({
      getSession: async () => {
        throw new Error('not found');
      },
    });
    const adapter = new Ap2SdkAdapter(client);
    expect(await adapter.getSession('missing')).toBeNull();
  });

  it('verifyMandate maps mandate_type/issuer/subject snake_case', async () => {
    const { client } = fakeClient();
    const adapter = new Ap2SdkAdapter(client);
    const v = await adapter.verifyMandate({ kind: 'intent' });
    expect(v).toEqual({
      valid: true,
      mandateType: 'Intent',
      issuerDid: 'did:web:user.example',
      subjectDid: 'did:tenzro:agent',
      expiresAt: 1_800_000_000,
    });
  });

  it('omits issuerDid/subjectDid when empty (exactOptionalPropertyTypes)', async () => {
    const { client } = fakeClient({
      verifyMandate: async () => ({
        valid: false,
        mandate_type: 'Unknown',
        issuer: '',
        subject: '',
        expires_at: 0,
        error: 'bad proof',
      }),
    });
    const adapter = new Ap2SdkAdapter(client);
    const v = await adapter.verifyMandate({});
    expect(v.valid).toBe(false);
    expect(v.error).toBe('bad proof');
    expect('issuerDid' in v).toBe(false);
    expect('subjectDid' in v).toBe(false);
  });
});
