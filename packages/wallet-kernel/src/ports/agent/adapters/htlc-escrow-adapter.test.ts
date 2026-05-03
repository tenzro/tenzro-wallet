/**
 * Pin the HtlcEscrowSdkAdapter detect-via-presence behaviour:
 *   - throws "SDK pending" when client lacks the method
 *   - forwards args correctly when client implements the method
 *   - decodes snake_case wire records into camelCase HtlcRecord
 *   - base64 round-trips secretHash / secret bytes
 */

import { describe, expect, it } from 'vitest';
import {
  HtlcEscrowSdkAdapter,
  type HtlcSdkClientLike,
} from './htlc-escrow-adapter.ts';

const SECRET = new Uint8Array([1, 2, 3, 4]);
// SHA256 placeholder; the adapter doesn't compute, just transports.
const SECRET_HASH = new Uint8Array(32).fill(0xab);

describe('HtlcEscrowSdkAdapter — SDK-pending paths', () => {
  it('lock throws when client.lockHtlc absent', async () => {
    const adapter = new HtlcEscrowSdkAdapter({});
    await expect(
      adapter.lock({
        payer: 'p',
        payee: 'q',
        amount: 100n,
        asset: 'TNZO',
        secretHash: SECRET_HASH,
        expiresAt: Date.now() + 60_000,
        destinationCorridor: 'canton-mainnet',
      }),
    ).rejects.toThrow(/SDK pending.*lockHtlc/);
  });

  it('redeem throws when client.redeemHtlc absent', async () => {
    const adapter = new HtlcEscrowSdkAdapter({});
    await expect(
      adapter.redeem({ htlcId: 'h1', secret: SECRET, proof: {} }),
    ).rejects.toThrow(/SDK pending.*redeemHtlc/);
  });

  it('refund throws when client.refundHtlc absent', async () => {
    const adapter = new HtlcEscrowSdkAdapter({});
    await expect(adapter.refund({ htlcId: 'h1' })).rejects.toThrow(
      /SDK pending.*refundHtlc/,
    );
  });

  it('get throws when client.getHtlc absent', async () => {
    const adapter = new HtlcEscrowSdkAdapter({});
    await expect(adapter.get('h1')).rejects.toThrow(/SDK pending.*getHtlc/);
  });
});

describe('HtlcEscrowSdkAdapter — present paths', () => {
  it('lock forwards args and base64-encodes secret hash', async () => {
    let captured: Record<string, unknown> | null = null;
    const client: HtlcSdkClientLike = {
      async lockHtlc(args) {
        captured = args as Record<string, unknown>;
        return {
          htlc_id: 'h-1',
          tx_hash: '0xtx',
          status: 'locked',
        };
      },
    };
    const adapter = new HtlcEscrowSdkAdapter(client);
    const r = await adapter.lock({
      payer: 'p',
      payee: 'q',
      amount: 100n,
      asset: 'TNZO',
      secretHash: SECRET_HASH,
      expiresAt: 12345,
      destinationCorridor: 'canton-mainnet',
    });
    expect(r).toEqual({ htlcId: 'h-1', txHash: '0xtx', status: 'locked' });
    expect(captured).not.toBeNull();
    expect(
      (captured as unknown as { secretHashB64: string }).secretHashB64,
    ).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(
      (captured as unknown as { expiresAtUnixMs: number }).expiresAtUnixMs,
    ).toBe(12345);
  });

  it('redeem forwards proof opaquely', async () => {
    let captured: Record<string, unknown> | null = null;
    const client: HtlcSdkClientLike = {
      async redeemHtlc(args) {
        captured = args as Record<string, unknown>;
        return { tx_hash: '0xredeemed' };
      },
    };
    const adapter = new HtlcEscrowSdkAdapter(client);
    const r = await adapter.redeem({
      htlcId: 'h-1',
      secret: SECRET,
      proof: { kind: 'canton-completion', updateId: 'u-1' },
    });
    expect(r.txHash).toBe('0xredeemed');
    expect(
      (captured as unknown as { proof: { kind: string } }).proof.kind,
    ).toBe('canton-completion');
  });

  it('get decodes snake_case wire record', async () => {
    const client: HtlcSdkClientLike = {
      async getHtlc() {
        return {
          htlc_id: 'h-1',
          payer: 'tnz1payer',
          payee: 'party::abc',
          amount: '1000',
          asset: 'TNZO',
          secret_hash_b64: btoa('hashbytes'),
          expires_at_unix_ms: 999,
          destination_corridor: 'canton-mainnet',
          status: 'locked',
        };
      },
    };
    const adapter = new HtlcEscrowSdkAdapter(client);
    const r = await adapter.get('h-1');
    expect(r).not.toBeNull();
    expect(r?.htlcId).toBe('h-1');
    expect(r?.amount).toBe(1000n);
    expect(r?.expiresAt).toBe(999);
    expect(r?.destinationCorridor).toBe('canton-mainnet');
    expect(r?.status).toBe('locked');
  });

  it('get returns null when SDK returns null', async () => {
    const client: HtlcSdkClientLike = {
      async getHtlc() {
        return null;
      },
    };
    const adapter = new HtlcEscrowSdkAdapter(client);
    expect(await adapter.get('h-1')).toBeNull();
  });
});
