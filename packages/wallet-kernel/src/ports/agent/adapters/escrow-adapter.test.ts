/**
 * Pin Escrow adapter — release-mode strings forwarded verbatim, get()
 * normalises mode + status, returns null on unknown escrow id.
 */

import { describe, expect, it } from 'vitest';
import { type EscrowClientLike, EscrowSdkAdapter } from './escrow-adapter.ts';

function fakeClient(overrides: Partial<EscrowClientLike> = {}): {
  client: EscrowClientLike;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: EscrowClientLike = {
    createEscrow: async (payer, payee, amount, asset, expiresAt, mode) => {
      calls.push({
        method: 'createEscrow',
        args: [payer, payee, amount, asset, expiresAt, mode],
      });
      return '0xtxhash-create';
    },
    releaseEscrow: async (payer, escrowId, proof) => {
      calls.push({ method: 'releaseEscrow', args: [payer, escrowId, proof] });
      return '0xtxhash-release';
    },
    refundEscrow: async (payer, escrowId) => {
      calls.push({ method: 'refundEscrow', args: [payer, escrowId] });
      return '0xtxhash-refund';
    },
    getEscrow: async (escrowId) => {
      calls.push({ method: 'getEscrow', args: [escrowId] });
      return null;
    },
    listEscrowsByPayer: async (payer) => {
      calls.push({ method: 'listEscrowsByPayer', args: [payer] });
      return [];
    },
    listEscrowsByPayee: async (payee) => {
      calls.push({ method: 'listEscrowsByPayee', args: [payee] });
      return [];
    },
    ...overrides,
  };
  return { client, calls };
}

describe('EscrowSdkAdapter.create', () => {
  it('forwards every field including release-mode string', async () => {
    const { client, calls } = fakeClient();
    const adapter = new EscrowSdkAdapter(client);
    const hash = await adapter.create({
      payer: '0xpayer',
      payee: '0xpayee',
      amount: 1_000_000_000_000_000_000n,
      asset: 'TNZO',
      expiresAt: 9_999_999_999n,
      releaseMode: 'verifier',
    });
    expect(hash).toBe('0xtxhash-create');
    expect(calls[0]?.args).toEqual([
      '0xpayer',
      '0xpayee',
      1_000_000_000_000_000_000n,
      'TNZO',
      9_999_999_999n,
      'verifier',
    ]);
  });
});

describe('EscrowSdkAdapter.release / refund', () => {
  it('release forwards proof when present', async () => {
    const { client, calls } = fakeClient();
    const adapter = new EscrowSdkAdapter(client);
    await adapter.release({
      payer: '0xpayer',
      escrowId: '0xeeee',
      proof: '0xproof',
    });
    expect(calls[0]?.args).toEqual(['0xpayer', '0xeeee', '0xproof']);
  });

  it('refund needs only payer + escrowId', async () => {
    const { client, calls } = fakeClient();
    const adapter = new EscrowSdkAdapter(client);
    const hash = await adapter.refund({ payer: '0xpayer', escrowId: '0xeeee' });
    expect(hash).toBe('0xtxhash-refund');
    expect(calls[0]?.args).toEqual(['0xpayer', '0xeeee']);
  });
});

describe('EscrowSdkAdapter.get', () => {
  it('returns null when SDK returns null', async () => {
    const { client } = fakeClient();
    const adapter = new EscrowSdkAdapter(client);
    expect(await adapter.get('0xunknown')).toBeNull();
  });

  it('normalises mode + status fields', async () => {
    const { client } = fakeClient({
      getEscrow: async () => ({
        escrow_id: '0xeeee',
        payer: '0xp',
        payee: '0xq',
        amount: '1000000',
        asset_id: 'TNZO',
        expires_at: 9_000_000,
        release_conditions: { type: 'BothSignatures' },
        status: 'Active',
      }),
    });
    const adapter = new EscrowSdkAdapter(client);
    const r = await adapter.get('0xeeee');
    expect(r).not.toBeNull();
    expect(r?.escrowId).toBe('0xeeee');
    expect(r?.amount).toBe(1_000_000n);
    expect(r?.releaseMode).toBe('both');
    expect(r?.status).toBe('active');
  });

  it('falls back to id field when escrow_id absent', async () => {
    const { client } = fakeClient({
      getEscrow: async () => ({
        id: '0xfff',
        amount: 7,
        asset: 'TNZO',
        release_mode: 'timeout',
        status: 'released',
      }),
    });
    const adapter = new EscrowSdkAdapter(client);
    const r = await adapter.get('0xfff');
    expect(r?.escrowId).toBe('0xfff');
    expect(r?.amount).toBe(7n);
    expect(r?.releaseMode).toBe('timeout');
    expect(r?.status).toBe('released');
  });
});
