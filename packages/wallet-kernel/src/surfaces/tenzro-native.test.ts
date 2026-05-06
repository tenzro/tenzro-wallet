/**
 * The surface module's contract is "drive the port for prepare/submit, drive
 * the signing-driver for sign". This test pins both: a fake TenzroRpcPort
 * captures every call, the deterministic mock SigningDriver from M1 stays in
 * place. The kernel-level e2e in kernel.test.ts is the higher-level smoke
 * test; this is the seam-level one.
 */

import { describe, expect, it } from 'vitest';
import { internalMpcDriver } from '../custody/internal-mpc.ts';
import { provisionIdentity } from '../identity/provision.ts';
import type { TenzroRpcPort, TenzroSendArgs } from '../ports/tenzro-rpc.ts';
import type { Intent } from '../types/intent.ts';
import { tenzroNativeSurface } from './tenzro-native.ts';

interface FakePortLog {
  readonly nonceLookups: string[];
  readonly chainIdLookups: number;
  readonly sends: TenzroSendArgs[];
}

function fakePort(): { port: TenzroRpcPort; log: FakePortLog } {
  const log = {
    nonceLookups: [] as string[],
    chainIdLookups: 0,
    sends: [] as TenzroSendArgs[],
  };
  const port: TenzroRpcPort = {
    getNonce: async (address) => {
      log.nonceLookups.push(address);
      return 42;
    },
    getChainId: async () => {
      log.chainIdLookups += 1;
      return 1337;
    },
    sendTransaction: async (args) => {
      log.sends.push(args);
      return '0xfeedface';
    },
    getTransaction: async () => null,
  };
  return { port, log };
}

describe('tenzroNativeSurface', () => {
  it('reads nonce and chainId via the port during prepare', async () => {
    const identity = await provisionIdentity({ uuid: 'native-port-1' });
    const { port, log } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: internalMpcDriver(),
      rpc: port,
    });

    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'tdip', did: identity.did },
      asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
      amount: 1n,
    };

    await surface.prepare(intent);
    expect(log.nonceLookups).toHaveLength(1);
    expect(log.chainIdLookups).toBe(1);
  });

  it('forwards canonical send args to port.sendTransaction on submit', async () => {
    const identity = await provisionIdentity({ uuid: 'native-port-2' });
    const { port, log } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: internalMpcDriver(),
      rpc: port,
    });

    const amount = 5n * 10n ** 18n;
    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'tdip', did: identity.did },
      asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
      amount,
    };
    const prepared = await surface.prepare(intent);
    const signed = await surface.sign(prepared, { approvedAt: Date.now() });
    const handle = await surface.submit(signed);

    expect(handle.surface).toBe('tenzro-native');
    expect(log.sends).toHaveLength(1);
    const sent = log.sends[0]!;
    expect(sent.value).toBe(amount);
    expect(sent.nonce).toBe(42);
    expect(sent.chainId).toBe(1337);
    // `from` and `to` should be the resolved Base58 tenzro-native addresses,
    // not the DIDs themselves.
    expect(sent.from).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(sent.to).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('still produces hybrid signatures from the local signing driver (M2 retains the leg for M5)', async () => {
    const identity = await provisionIdentity({ uuid: 'native-port-3' });
    const { port } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: internalMpcDriver(),
      rpc: port,
    });
    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'tdip', did: identity.did },
      asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
      amount: 1n,
    };
    const prepared = await surface.prepare(intent);
    const signed = await surface.sign(prepared, { approvedAt: Date.now() });
    expect(signed.signatures).toHaveLength(2);
  });

  it('reads the on-chain address straight from the resolved SurfaceKey', async () => {
    const identity = await provisionIdentity({ uuid: 'native-port-4' });
    const { port, log } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: () => identity.keys.get('tenzro-native'),
      signingDriver: internalMpcDriver(),
      rpc: port,
    });
    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'tdip', did: identity.did },
      asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
      amount: 1n,
    };
    const prepared = await surface.prepare(intent);
    const signed = await surface.sign(prepared, { approvedAt: Date.now() });
    await surface.submit(signed);
    const nativeKey = identity.keys.get('tenzro-native');
    if (!nativeKey || nativeKey.surface !== 'tenzro-native') throw new Error('unreachable');
    expect(log.sends[0]?.from).toBe(nativeKey.address);
    expect(log.sends[0]?.to).toBe(nativeKey.address);
  });

  it('refuses to resolve a remote TDIP recipient when no identity port is wired', async () => {
    const me = await provisionIdentity({ uuid: 'native-port-5-self' });
    const them = await provisionIdentity({ uuid: 'native-port-5-other' });
    const { port } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: (did) => (did === me.did ? me.keys.get('tenzro-native') : undefined),
      signingDriver: internalMpcDriver(),
      rpc: port,
    });
    const intent: Intent = {
      kind: 'send',
      from: me.did,
      to: { kind: 'tdip', did: them.did },
      asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
      amount: 1n,
    };
    await expect(surface.prepare(intent)).rejects.toThrow(/no identity port wired/);
  });

  it('resolves a remote TDIP recipient via the identity port and forwards the address to sendTransaction', async () => {
    const me = await provisionIdentity({ uuid: 'native-port-6-self' });
    const them = await provisionIdentity({ uuid: 'native-port-6-other' });
    const themKey = them.keys.get('tenzro-native');
    if (!themKey || themKey.surface !== 'tenzro-native') throw new Error('unreachable');
    const remoteAddress = themKey.address;

    const lookups: string[] = [];
    const { port, log } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: (did) => (did === me.did ? me.keys.get('tenzro-native') : undefined),
      signingDriver: internalMpcDriver(),
      rpc: port,
      identityPort: {
        async resolveTenzroAddress(did) {
          lookups.push(did);
          return did === them.did ? remoteAddress : undefined;
        },
      },
    });
    const intent: Intent = {
      kind: 'send',
      from: me.did,
      to: { kind: 'tdip', did: them.did },
      asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
      amount: 7n,
    };
    const prepared = await surface.prepare(intent);
    const signed = await surface.sign(prepared, { approvedAt: Date.now() });
    await surface.submit(signed);

    // The port was consulted exactly once for the recipient — never for `me`,
    // because the local keyResolver hit serves the sender path without an
    // await round-trip.
    expect(lookups).toEqual([them.did]);
    expect(log.sends[0]?.to).toBe(remoteAddress);
  });

  it('throws when the identity port returns undefined (DID has no tenzro-native key)', async () => {
    const me = await provisionIdentity({ uuid: 'native-port-7-self' });
    const cantonOnly = await provisionIdentity({ uuid: 'native-port-7-canton-only' });
    const { port } = fakePort();
    const surface = tenzroNativeSurface({
      keyResolver: (did) => (did === me.did ? me.keys.get('tenzro-native') : undefined),
      signingDriver: internalMpcDriver(),
      rpc: port,
      identityPort: {
        async resolveTenzroAddress() {
          return undefined;
        },
      },
    });
    const intent: Intent = {
      kind: 'send',
      from: me.did,
      to: { kind: 'tdip', did: cantonOnly.did },
      asset: { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 },
      amount: 1n,
    };
    await expect(surface.prepare(intent)).rejects.toThrow(/has no tenzro-native key/);
  });
});
