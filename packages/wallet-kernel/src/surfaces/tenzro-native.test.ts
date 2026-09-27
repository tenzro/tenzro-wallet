/**
 * The surface's contract: read nonce / chain id / EntryPoint / gas price from
 * the port during prepare, hand the UserOperation hash to the signing driver,
 * submit the signed operation, and watch its receipt. A fake port records
 * every call; a recording driver stands in for the passkey.
 */

import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from '../custody/passkey/bytes.ts';
import { type UserOperation, userOperationHash } from '../custody/passkey/userop.ts';
import { testSigningDriver } from '../custody/test-driver.ts';
import { testIdentity } from '../identity/test-identity.ts';
import type { TenzroRpcPort } from '../ports/tenzro-rpc.ts';
import type { Intent, TxStatus } from '../types/intent.ts';
import type { SigningDriver, SigningRequest } from '../types/signing-driver.ts';
import { tenzroNativeSurface } from './tenzro-native.ts';

const ENTRY_POINT = '0x0000000000000000000000000000000000004337';
const RECIPIENT = '0x1111111111111111111111111111111111111111';

interface PortLog {
  nonceLookups: string[];
  chainIdLookups: number;
  sent: Array<{ op: Readonly<Record<string, string>>; entryPoint: string }>;
}

function fakePort(receiptSuccess = true): { port: TenzroRpcPort; log: PortLog } {
  const log: PortLog = { nonceLookups: [], chainIdLookups: 0, sent: [] };
  const port: TenzroRpcPort = {
    getAccountNonce: async (account) => {
      log.nonceLookups.push(account);
      return 42n;
    },
    getChainId: async () => {
      log.chainIdLookups += 1;
      return 20_260_901n;
    },
    getEntryPoint: async () => ENTRY_POINT,
    getGasPrice: async () => 1_000_000_000n,
    sendUserOperation: async (op, entryPoint) => {
      log.sent.push({ op, entryPoint });
      return `0x${'ab'.repeat(32)}`;
    },
    getUserOperationReceipt: async (hash) => ({ userOpHash: hash, success: receiptSuccess }),
  };
  return { port, log };
}

function recordingDriver(): { driver: SigningDriver; requests: SigningRequest[] } {
  const requests: SigningRequest[] = [];
  return {
    requests,
    driver: {
      id: 'test',
      async sign(req) {
        requests.push(req);
        return { signatures: [new Uint8Array([1, 2, 3])] };
      },
    },
  };
}

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
  it('reads nonce, chain id, EntryPoint and gas price from the node during prepare', async () => {
    const { identity, intent } = await sendIntent('native-1');
    const { port, log } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: testSigningDriver(),
      rpc: port,
    });
    const prepared = await surface.prepare(intent);
    const key = identity.keys.get('tenzro-native');
    if (!key || key.surface !== 'tenzro-native') throw new Error('unreachable');
    expect(log.nonceLookups).toEqual([key.address]);
    expect(log.chainIdLookups).toBe(1);
    expect(prepared.route).toEqual({ kind: 'native', surface: 'tenzro-native' });
    // (100k + 500k + 50k) gas at 1 gwei.
    expect(prepared.fees[0]?.amount).toBe(650_000n * 1_000_000_000n);
  });

  it('signs the EIP-712 UserOperation hash with the passkey scheme', async () => {
    const { identity, intent } = await sendIntent('native-2', 5n * 10n ** 18n);
    const { port } = fakePort();
    const { driver, requests } = recordingDriver();
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: driver,
      rpc: port,
    });
    const prepared = await surface.prepare(intent);
    await surface.sign(prepared, { approvedAt: Date.now() });

    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.scheme).toBe('webauthn-p256');
    const body = prepared.body as { userOp: UserOperation };
    expect(toHex(req.preimage, true)).toBe(
      toHex(userOperationHash(body.userOp, 20_260_901n, ENTRY_POINT), true),
    );
  });

  it('submits ERC-7579 execute calldata with the signature bundle', async () => {
    const amount = 5n * 10n ** 18n;
    const { identity, intent } = await sendIntent('native-3', amount);
    const { port, log } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: recordingDriver().driver,
      rpc: port,
    });
    const prepared = await surface.prepare(intent);
    const signed = await surface.sign(prepared, { approvedAt: Date.now() });
    const handle = await surface.submit(signed);

    expect(handle.hash).toBe(`0x${'ab'.repeat(32)}`);
    expect(log.sent).toHaveLength(1);
    const { op, entryPoint } = log.sent[0]!;
    expect(entryPoint).toBe(ENTRY_POINT);
    expect(op.nonce).toBe('0x2a');
    expect(op.signature).toBe('0x010203');
    const callData = fromHex(op.callData ?? '');
    // ERC-7579 execute(bytes32 mode, bytes executionCalldata), single call:
    // selector, mode (call type 0x00), offset, length, then target || value.
    expect(toHex(callData.slice(0, 4))).toBe('e9ae5c53');
    expect(callData[4]).toBe(0x00);
    expect(toHex(callData.slice(100, 120), true)).toBe(RECIPIENT);
    expect(BigInt(toHex(callData.slice(120, 152), true))).toBe(amount);
  });

  it('refuses a send to the account itself', async () => {
    const identity = await testIdentity({ uuid: 'native-4' });
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: testSigningDriver(),
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
      signingDriver: recordingDriver().driver,
      rpc: port,
      identityPort: {
        async resolveTenzroAddress(did) {
          lookups.push(did);
          // A 32-byte widened address resolves to its low 20 bytes.
          return `0x${'00'.repeat(12)}${RECIPIENT.slice(2)}`;
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
    const callData = fromHex(log.sent[0]?.op.callData ?? '');
    expect(toHex(callData.slice(100, 120), true)).toBe(RECIPIENT);
  });

  it('refuses a remote TDIP recipient when no identity port is wired', async () => {
    const me = await testIdentity({ uuid: 'native-6-self' });
    const them = await testIdentity({ uuid: 'native-6-other' });
    const surface = tenzroNativeSurface({
      keyResolver: (did) => (did === me.did ? me.keys.get('tenzro-native') : undefined),
      signingDriver: testSigningDriver(),
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
      signingDriver: recordingDriver().driver,
      rpc: fakePort().port,
      watch: { intervalMs: 1, timeoutMs: 1_000 },
    });
    const prepared = await surface.prepare(intent);
    const handle = await surface.submit(await surface.sign(prepared, { approvedAt: Date.now() }));
    const phases: TxStatus['phase'][] = [];
    for await (const s of surface.watch(handle)) phases.push(s.phase);
    expect(phases).toEqual(['created', 'pending', 'finalized']);
  });

  it('watch() reports a reverted operation as failed', async () => {
    const { identity, intent } = await sendIntent('native-8');
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: recordingDriver().driver,
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
