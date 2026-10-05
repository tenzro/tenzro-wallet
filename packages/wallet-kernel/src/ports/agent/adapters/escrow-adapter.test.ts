/**
 * Pin Escrow adapter — writes are the typed transactions the network
 * defines, get() normalises mode + status, returns null on unknown escrow id.
 */

import type { HybridSigner, TypedTransaction } from 'tenzro-sdk';
import { describe, expect, it } from 'vitest';
import { type EscrowClientLike, EscrowSdkAdapter } from './escrow-adapter.ts';
import type { TypedTxSender } from './typed-tx.ts';

const signer = {} as HybridSigner;
const ID = `0x${'ee'.repeat(32)}`;
const PAYEE = `0x${'0a'.repeat(32)}`;

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

function fakeClient(overrides: Partial<EscrowClientLike> = {}): {
  client: EscrowClientLike;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: EscrowClientLike = {
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

function adapterWith(client: EscrowClientLike, sender = fakeSender().sender) {
  return new EscrowSdkAdapter(client, sender, signer);
}

describe('EscrowSdkAdapter.create', () => {
  it('sends CreateEscrow with the network field names', async () => {
    const { sender, sent } = fakeSender();
    const hash = await adapterWith(fakeClient().client, sender).create({
      payee: PAYEE,
      amount: 1_000_000_000_000_000_000n,
      asset: 'TNZO',
      expiresAt: 9_999_999_999n,
      releaseMode: 'verifier',
    });
    expect(hash).toBe('0xtxhash');
    expect(sent[0]).toEqual({
      kind: 'CreateEscrow',
      fields: {
        payee: Array(32).fill(10),
        amount: 1e18,
        asset_id: 'TNZO',
        usd_e6: 0,
        expires_at: 9_999_999_999,
        release_conditions: 'VerifierSignature',
      },
    });
  });

  it('encodes a custom condition and refuses one without text', async () => {
    const { sender, sent } = fakeSender();
    const a = adapterWith(fakeClient().client, sender);
    const base = { payee: PAYEE, amount: 5n, asset: 'TNZO', expiresAt: 1n } as const;
    await a.create({ ...base, releaseMode: 'custom', customCondition: 'delivered' });
    expect((sent[0]?.fields as Record<string, unknown>).release_conditions).toEqual({
      Custom: { condition: 'delivered' },
    });
    await expect(a.create({ ...base, releaseMode: 'custom' })).rejects.toThrow(/customCondition/);
  });

  it('refuses an amount a JSON number cannot carry exactly', async () => {
    const a = adapterWith(fakeClient().client);
    await expect(
      a.create({
        payee: PAYEE,
        amount: 1_000_000_000_000_000_001n,
        asset: 'TNZO',
        expiresAt: 1n,
        releaseMode: 'timeout',
      }),
    ).rejects.toThrow(/cannot be sent exactly/);
  });

  it('needs a USD price for an asset other than TNZO', async () => {
    const a = adapterWith(fakeClient().client);
    await expect(
      a.create({ payee: PAYEE, amount: 1n, asset: 'USDC', expiresAt: 1n, releaseMode: 'timeout' }),
    ).rejects.toThrow(/usdE6/);
  });
});

describe('EscrowSdkAdapter.release / refund', () => {
  it('release carries the service proof as bytes', async () => {
    const { sender, sent } = fakeSender();
    await adapterWith(fakeClient().client, sender).release({
      escrowId: ID,
      proof: { proofType: 'Cryptographic', proofData: '0x0102' },
    });
    expect(sent[0]).toEqual({
      kind: 'ReleaseEscrow',
      fields: {
        escrow_id: Array(32).fill(0xee),
        proof: {
          proof_type: 'Cryptographic',
          proof_data: [1, 2],
          signatures: [],
          attestation: null,
        },
      },
    });
  });

  it('refund names only the escrow', async () => {
    const { sender, sent } = fakeSender();
    const hash = await adapterWith(fakeClient().client, sender).refund({ escrowId: ID });
    expect(hash).toBe('0xtxhash');
    expect(sent[0]).toEqual({ kind: 'RefundEscrow', fields: { escrow_id: Array(32).fill(0xee) } });
  });

  it('refuses an escrow id that is not 32 bytes', async () => {
    await expect(adapterWith(fakeClient().client).refund({ escrowId: '0xeeee' })).rejects.toThrow(
      /32 bytes/,
    );
  });
});

describe('EscrowSdkAdapter.get', () => {
  it('returns null when SDK returns null', async () => {
    const { client } = fakeClient();
    const adapter = adapterWith(client);
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
    const adapter = adapterWith(client);
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
    const adapter = adapterWith(client);
    const r = await adapter.get('0xfff');
    expect(r?.escrowId).toBe('0xfff');
    expect(r?.amount).toBe(7n);
    expect(r?.releaseMode).toBe('timeout');
    expect(r?.status).toBe('released');
  });
});
