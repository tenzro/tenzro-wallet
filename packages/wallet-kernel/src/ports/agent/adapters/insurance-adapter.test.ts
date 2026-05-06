/**
 * Pin Insurance adapter — fileClaim serialises camelCase request to
 * snake_case RPC params, get/list normalise field shapes and status
 * strings, poolBalance widens string to bigint.
 */

import { describe, expect, it } from 'vitest';
import { type InsuranceClientLike, InsuranceSdkAdapter } from './insurance-adapter.ts';

function fakeClient(overrides: Partial<InsuranceClientLike> = {}): {
  client: InsuranceClientLike;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: InsuranceClientLike = {
    fileInsuranceClaim: async (params) => {
      calls.push({ method: 'fileInsuranceClaim', args: [params] });
      return null;
    },
    getInsuranceClaim: async (claimId) => {
      calls.push({ method: 'getInsuranceClaim', args: [claimId] });
      return null;
    },
    listInsuranceClaims: async () => {
      calls.push({ method: 'listInsuranceClaims', args: [] });
      return [];
    },
    getInsurancePoolBalance: async () => {
      calls.push({ method: 'getInsurancePoolBalance', args: [] });
      return '0';
    },
    ...overrides,
  };
  return { client, calls };
}

describe('InsuranceSdkAdapter.fileClaim', () => {
  it('serialises request to snake_case and decodes returned record', async () => {
    const { client, calls } = fakeClient();
    // Re-override fileInsuranceClaim to ALSO push, since override replaces the default.
    (client as { fileInsuranceClaim: (p: unknown) => Promise<unknown> }).fileInsuranceClaim =
      async (params: unknown) => {
        calls.push({ method: 'fileInsuranceClaim', args: [params] });
        const p = params as Record<string, unknown>;
        return {
          claim_id: '0xabc',
          claimant_did: p.claimant_did,
          claimant_address: p.claimant_address,
          against_agent_did: p.against_agent_did,
          amount_requested: p.amount_requested,
          receipt_refs: p.receipt_refs,
          narrative: p.narrative,
          status: 'Open',
          filed_at: 1700000000,
        };
      };
    const adapter = new InsuranceSdkAdapter(client);
    const rec = await adapter.fileClaim({
      claimantDid: 'did:tenzro:human:xyz',
      claimantAddress: '0xclaimant',
      againstAgentDid: 'did:tenzro:machine:0xctl:abc',
      amountRequested: 1_000_000_000_000_000_000n,
      receiptRefs: ['receipt://0x1', 'receipt://0x2'],
      narrative: 'agent failed to settle',
    });

    // Request shape is snake_case + amount_requested is a string (BigInt
    // via JSON-RPC must not lose precision).
    expect(calls[0]?.args[0]).toEqual({
      claimant_did: 'did:tenzro:human:xyz',
      claimant_address: '0xclaimant',
      against_agent_did: 'did:tenzro:machine:0xctl:abc',
      amount_requested: '1000000000000000000',
      receipt_refs: ['receipt://0x1', 'receipt://0x2'],
      narrative: 'agent failed to settle',
    });

    expect(rec.claimId).toBe('0xabc');
    expect(rec.amountRequested).toBe(1_000_000_000_000_000_000n);
    expect(rec.status).toBe('open');
    expect(rec.receiptRefs).toEqual(['receipt://0x1', 'receipt://0x2']);
    expect(rec.narrative).toBe('agent failed to settle');
  });

  it('omits narrative key when not provided', async () => {
    const { client, calls } = fakeClient();
    (client as { fileInsuranceClaim: (p: unknown) => Promise<unknown> }).fileInsuranceClaim =
      async (params: unknown) => {
        calls.push({ method: 'fileInsuranceClaim', args: [params] });
        return {
          claim_id: '0xabc',
          status: 'Open',
          filed_at: 1,
        };
      };
    const adapter = new InsuranceSdkAdapter(client);
    await adapter.fileClaim({
      claimantDid: 'did:tenzro:human:xyz',
      claimantAddress: '0xc',
      againstAgentDid: 'did:tenzro:machine:0xc:a',
      amountRequested: 1n,
      receiptRefs: [],
    });
    const params = calls[0]?.args[0] as Record<string, unknown>;
    expect('narrative' in params).toBe(false);
  });

  it('throws when node returns a record without claim_id', async () => {
    const { client } = fakeClient({
      fileInsuranceClaim: async () => ({ status: 'Open' }),
    });
    const adapter = new InsuranceSdkAdapter(client);
    await expect(
      adapter.fileClaim({
        claimantDid: 'did:tenzro:human:xyz',
        claimantAddress: '0xc',
        againstAgentDid: 'did:tenzro:machine:0xc:a',
        amountRequested: 1n,
        receiptRefs: [],
      }),
    ).rejects.toThrow(/claim_id/);
  });
});

describe('InsuranceSdkAdapter.get', () => {
  it('returns null on unknown claim id', async () => {
    const { client } = fakeClient();
    const adapter = new InsuranceSdkAdapter(client);
    expect(await adapter.get('0xnope')).toBeNull();
  });

  it('decodes paid claim with paid_amount + governance_ref', async () => {
    const { client } = fakeClient({
      getInsuranceClaim: async () => ({
        claim_id: '0xabc',
        claimant_did: 'did:tenzro:human:xyz',
        claimant_address: '0xc',
        against_agent_did: 'did:tenzro:machine:0xc:a',
        amount_requested: '1000000',
        receipt_refs: ['r1'],
        narrative: null,
        status: 'Paid',
        governance_ref: 'prop:0x9',
        paid_amount: '750000',
        filed_at: 1700000000,
      }),
    });
    const adapter = new InsuranceSdkAdapter(client);
    const rec = await adapter.get('0xabc');
    expect(rec?.status).toBe('paid');
    expect(rec?.paidAmount).toBe(750000n);
    expect(rec?.governanceRef).toBe('prop:0x9');
    expect(rec?.narrative).toBeUndefined();
  });
});

describe('InsuranceSdkAdapter.list', () => {
  it('returns [] for null/undefined response', async () => {
    const { client } = fakeClient({
      listInsuranceClaims: async () => null as unknown as never[],
    });
    const adapter = new InsuranceSdkAdapter(client);
    expect(await adapter.list()).toEqual([]);
  });

  it('drops rows missing claim_id', async () => {
    const { client } = fakeClient({
      listInsuranceClaims: async () => [
        {
          claim_id: '0xa',
          claimant_did: 'did:tenzro:human:x',
          claimant_address: '0xc',
          against_agent_did: 'did:tenzro:machine:0xc:a',
          amount_requested: '1',
          receipt_refs: [],
          status: 'Open',
          filed_at: 1,
        },
        { against_agent_did: 'no-claim-id' },
      ],
    });
    const adapter = new InsuranceSdkAdapter(client);
    const list = await adapter.list();
    expect(list.length).toBe(1);
    expect(list[0]?.claimId).toBe('0xa');
  });
});

describe('InsuranceSdkAdapter.poolBalance', () => {
  it('widens string to bigint', async () => {
    const { client } = fakeClient({
      getInsurancePoolBalance: async () => '12345678901234567890',
    });
    const adapter = new InsuranceSdkAdapter(client);
    expect(await adapter.poolBalance()).toBe(12345678901234567890n);
  });
});
