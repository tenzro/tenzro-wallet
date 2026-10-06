/**
 * The surface's contract: prepare a native Transfer to the recipient's ledger
 * slot, sign it with the account's passkey through the port, submit the
 * signed transaction, and watch its receipt. A fake port records every call.
 */

import type { HybridSigner, SignedTransactionJson, TypedTransaction } from 'tenzro-sdk';
import { describe, expect, it } from 'vitest';
import { testIdentity } from '../identity/test-identity.ts';
import type { TenzroRpcPort } from '../ports/tenzro-rpc.ts';
import type { Intent, TxStatus } from '../types/intent.ts';
import { DEFAULT_TRANSFER_GAS, tenzroNativeSurface } from './tenzro-native.ts';

const RECIPIENT = '0x1111111111111111111111111111111111111111';
const RECIPIENT_SLOT = `${RECIPIENT}${'00'.repeat(12)}`;

interface PortLog {
  signed: Array<{ signer: HybridSigner; tx: TypedTransaction }>;
  sent: SignedTransactionJson[];
}

function fakeSigned(tx: TypedTransaction): SignedTransactionJson {
  return {
    transaction: { tx_type: { [tx.kind]: tx.fields }, to: tx.to },
    public_key: '11'.repeat(64),
    signature: { classical: { form: 'raw', signature: '22'.repeat(64) } },
  } as unknown as SignedTransactionJson;
}

function fakePort(receiptSuccess = true): { port: TenzroRpcPort; log: PortLog } {
  const log: PortLog = { signed: [], sent: [] };
  const port: TenzroRpcPort = {
    getChainId: async () => 20_260_901n,
    getGasPrice: async () => 1_000_000_000n,
    signTransaction: async (signer, tx) => {
      log.signed.push({ signer, tx });
      return fakeSigned(tx);
    },
    sendTransaction: async (signed) => {
      log.sent.push(signed);
      return `0x${'ab'.repeat(32)}`;
    },
    getTransactionReceipt: async (hash) => ({ hash, success: receiptSuccess }),
  };
  return { port, log };
}

const SIGNER = { label: 'passkey' } as unknown as HybridSigner;
const signerFor = async () => SIGNER;

async function sendIntent(uuid: string, amount = 1n) {
  const identity = await testIdentity({ uuid });
  const intent: Intent = {
    kind: 'send',
    from: identity.did,
    to: { kind: 'evm', address: RECIPIENT as `0x${string}` },
    asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
    amount,
  };
  return { identity, intent };
}

describe('tenzroNativeSurface (passkey account)', () => {
  it('prepares a native Transfer to the recipient slot with the maximum fee', async () => {
    const { identity, intent } = await sendIntent('native-1', 5n);
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      transactionSigner: signerFor,
      rpc: fakePort().port,
    });
    const prepared = await surface.prepare(intent);
    const key = identity.keys.get('tenzro-native');
    if (!key || key.surface !== 'tenzro-native') throw new Error('unreachable');
    const tx = (prepared.body as { tx: TypedTransaction }).tx;
    expect(tx.kind).toBe('Transfer');
    expect(tx.fields).toEqual({ amount: 5 });
    expect(tx.to).toBe(RECIPIENT_SLOT);
    expect(tx.from).toBe(key.address);
    expect(prepared.route).toEqual({ kind: 'native', surface: 'tenzro-native' });
    expect(prepared.fees[0]?.amount).toBe(BigInt(DEFAULT_TRANSFER_GAS) * 1_000_000_000n);
  });

  it('keeps an amount above 2^53 exact as a decimal string', async () => {
    const amount = 5n * 10n ** 18n;
    const { identity, intent } = await sendIntent('native-2', amount);
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      transactionSigner: signerFor,
      rpc: fakePort().port,
    });
    const tx = ((await surface.prepare(intent)).body as { tx: TypedTransaction }).tx;
    expect(tx.fields).toEqual({ amount: amount.toString() });
  });

  it('signs with the account passkey and submits the signed transaction', async () => {
    const { identity, intent } = await sendIntent('native-3');
    const { port, log } = fakePort();
    const asked: string[] = [];
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      transactionSigner: async (did) => {
        asked.push(did);
        return SIGNER;
      },
      rpc: port,
    });
    const prepared = await surface.prepare(intent);
    const signed = await surface.sign(prepared, { approvedAt: Date.now() });
    expect(asked).toEqual([identity.did]);
    expect(log.signed).toHaveLength(1);
    expect(log.signed[0]?.signer).toBe(SIGNER);
    expect(log.sent).toHaveLength(0);
    const handle = await surface.submit(signed);
    expect(log.sent).toHaveLength(1);
    expect(handle.hash).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('refuses a send to the account itself', async () => {
    const identity = await testIdentity({ uuid: 'native-4' });
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      transactionSigner: signerFor,
      rpc: fakePort().port,
    });
    await expect(
      surface.prepare({
        kind: 'send',
        from: identity.did,
        to: { kind: 'tdip', did: identity.did },
        asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
        amount: 1n,
      }),
    ).rejects.toThrow(/your own account/);
  });

  it('resolves a remote TDIP recipient through the identity port', async () => {
    const me = await testIdentity({ uuid: 'native-5-self' });
    const them = await testIdentity({ uuid: 'native-5-other' });
    const lookups: string[] = [];
    const { port, log } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: (did) => (did === me.did ? me.keys.get('tenzro-native') : undefined),
      transactionSigner: signerFor,
      rpc: port,
      identityPort: {
        async resolveTenzroAddress(did) {
          lookups.push(did);
          return RECIPIENT_SLOT;
        },
      },
    });
    const prepared = await surface.prepare({
      kind: 'send',
      from: me.did,
      to: { kind: 'tdip', did: them.did },
      asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
      amount: 7n,
    });
    await surface.submit(await surface.sign(prepared, { approvedAt: Date.now() }));
    expect(lookups).toEqual([them.did]);
    expect(log.signed[0]?.tx.to).toBe(RECIPIENT_SLOT);
  });

  it('refuses a remote TDIP recipient when no identity port is wired', async () => {
    const me = await testIdentity({ uuid: 'native-6-self' });
    const them = await testIdentity({ uuid: 'native-6-other' });
    const surface = tenzroNativeSurface({
      keyResolver: (did) => (did === me.did ? me.keys.get('tenzro-native') : undefined),
      transactionSigner: signerFor,
      rpc: fakePort().port,
    });
    await expect(
      surface.prepare({
        kind: 'send',
        from: me.did,
        to: { kind: 'tdip', did: them.did },
        asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
        amount: 1n,
      }),
    ).rejects.toThrow(/identityPort/);
  });

  it('watch() walks created, pending, finalized from the receipt', async () => {
    const { identity, intent } = await sendIntent('native-7');
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      transactionSigner: signerFor,
      rpc: fakePort().port,
      watch: { intervalMs: 1, timeoutMs: 1_000 },
    });
    const prepared = await surface.prepare(intent);
    const handle = await surface.submit(await surface.sign(prepared, { approvedAt: Date.now() }));
    const phases: TxStatus['phase'][] = [];
    for await (const s of surface.watch(handle)) phases.push(s.phase);
    expect(phases).toEqual(['created', 'pending', 'finalized']);
  });

  it('watch() reports a reverted transaction as failed', async () => {
    const { identity, intent } = await sendIntent('native-8');
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      transactionSigner: signerFor,
      rpc: fakePort(false).port,
      watch: { intervalMs: 1, timeoutMs: 1_000 },
    });
    const prepared = await surface.prepare(intent);
    const handle = await surface.submit(await surface.sign(prepared, { approvedAt: Date.now() }));
    const phases: TxStatus['phase'][] = [];
    for await (const s of surface.watch(handle)) phases.push(s.phase);
    expect(phases.at(-1)).toBe('failed');
  });
});
