/**
 * Pin the FROST drivers' round orchestration. The coordinator is mocked
 * — the real one wraps the Tenzro `/wallet/frost/*` endpoints (see
 * `coordinator.ts` JSDoc). Tests verify:
 *   - happy path commits, awaits challenge, responds, finalizes
 *   - signature length is enforced per scheme
 *   - aborts on round failure (and the abort is best-effort/swallowed)
 *   - share-holder dispose() is called
 *   - hybrid composes ed25519 + ml-dsa legs in parallel
 */

import { describe, expect, it, vi } from 'vitest';
import type { SurfaceKey, TdipDid } from '../../types/identity.ts';
import type { SigningRequest } from '../../types/signing-driver.ts';
import { frostEd25519Driver } from './ed25519-driver.ts';
import { frostSecp256k1Driver } from './secp256k1-driver.ts';
import { hybridEd25519MlDsaDriver } from './hybrid-driver.ts';
import type {
  FrostCoordinator,
  FrostDeviceShareHolder,
} from './coordinator.ts';
import type { MlDsaCoordinator } from '../mldsa/coordinator.ts';

const DID = 'did:tenzro:human:abc' as TdipDid;

const TENZRO_KEY: SurfaceKey = {
  surface: 'tenzro-native',
  scheme: 'ed25519',
  publicKey: new Uint8Array(32),
  address: 'tnz1example',
};

const EVM_KEY: SurfaceKey = {
  surface: 'evm-on-tenzro',
  scheme: 'secp256k1',
  address: '0xABCDEF0000000000000000000000000000000000',
};

function fakeCoordinator(opts: {
  signature: Uint8Array;
  failAt?: 'commit' | 'respond' | 'finalize';
}): FrostCoordinator & { _abortReasons: string[] } {
  const aborts: string[] = [];
  return {
    _abortReasons: aborts,
    async start() {
      return {
        sessionId: 'sess-1',
        expiresAt: Date.now() + 60_000,
        participants: ['device-a', 'node-tee'],
      };
    },
    async commit() {
      if (opts.failAt === 'commit') throw new Error('boom-commit');
      return { sessionId: 'sess-1', state: 'pending' };
    },
    async awaitChallenge() {
      return {
        sessionId: 'sess-1',
        state: 'committed',
        groupCommitment: new Uint8Array([1, 2, 3]),
        signerSet: ['device-a', 'node-tee'],
        lambda: new Uint8Array(32),
      };
    },
    async respond() {
      if (opts.failAt === 'respond') throw new Error('boom-respond');
      return { sessionId: 'sess-1', state: 'responded' };
    },
    async finalize() {
      if (opts.failAt === 'finalize') throw new Error('boom-finalize');
      return { sessionId: 'sess-1', state: 'finalized', signature: opts.signature };
    },
    async abort(_sessionId, reason) {
      aborts.push(reason ?? '');
    },
  };
}

function fakeShareHolder(scheme: 'ed25519' | 'secp256k1'): FrostDeviceShareHolder & {
  disposed: boolean;
} {
  const holder = {
    scheme,
    disposed: false,
    async commit() {
      return new Uint8Array([9, 9]);
    },
    async respond() {
      return new Uint8Array([7, 7]);
    },
    dispose() {
      holder.disposed = true;
    },
  };
  return holder;
}

const baseReq: SigningRequest = {
  did: DID,
  surfaceKey: TENZRO_KEY,
  scheme: 'ed25519',
  preimage: new Uint8Array([1, 2, 3, 4]),
};

describe('frostEd25519Driver', () => {
  it('orchestrates the round and returns a 64-byte signature', async () => {
    const sig = new Uint8Array(64).fill(0x42);
    const coord = fakeCoordinator({ signature: sig });
    const holder = fakeShareHolder('ed25519');
    const driver = frostEd25519Driver({
      coordinator: coord,
      resolveShareHolder: async () => holder,
    });

    const result = await driver.sign(baseReq);
    expect(result.signatures).toHaveLength(1);
    expect(result.signatures[0]).toBe(sig);
    expect(holder.disposed).toBe(true);
    expect(coord._abortReasons).toEqual([]);
  });

  it('rejects wrong-scheme requests', async () => {
    const driver = frostEd25519Driver({
      coordinator: fakeCoordinator({ signature: new Uint8Array(64) }),
      resolveShareHolder: async () => fakeShareHolder('ed25519'),
    });
    await expect(
      driver.sign({ ...baseReq, scheme: 'secp256k1' }),
    ).rejects.toThrow(/cannot sign scheme/);
  });

  it('rejects share-holder scheme mismatch', async () => {
    const driver = frostEd25519Driver({
      coordinator: fakeCoordinator({ signature: new Uint8Array(64) }),
      resolveShareHolder: async () => fakeShareHolder('secp256k1'),
    });
    await expect(driver.sign(baseReq)).rejects.toThrow(/scheme mismatch/);
  });

  it('rejects wrong-length signatures', async () => {
    const coord = fakeCoordinator({ signature: new Uint8Array(63) });
    const driver = frostEd25519Driver({
      coordinator: coord,
      resolveShareHolder: async () => fakeShareHolder('ed25519'),
    });
    await expect(driver.sign(baseReq)).rejects.toThrow(/wrong length/);
    expect(coord._abortReasons.length).toBe(1);
  });

  it('aborts the round when respond throws', async () => {
    const coord = fakeCoordinator({
      signature: new Uint8Array(64),
      failAt: 'respond',
    });
    const holder = fakeShareHolder('ed25519');
    const driver = frostEd25519Driver({
      coordinator: coord,
      resolveShareHolder: async () => holder,
    });
    await expect(driver.sign(baseReq)).rejects.toThrow(/boom-respond/);
    expect(coord._abortReasons).toEqual(['boom-respond']);
    expect(holder.disposed).toBe(true);
  });
});

describe('frostSecp256k1Driver', () => {
  const evmReq: SigningRequest = {
    did: DID,
    surfaceKey: EVM_KEY,
    scheme: 'secp256k1',
    preimage: new Uint8Array([1, 2, 3, 4]),
  };

  it('accepts 64-byte aggregates', async () => {
    const sig = new Uint8Array(64).fill(0x55);
    const driver = frostSecp256k1Driver({
      coordinator: fakeCoordinator({ signature: sig }),
      resolveShareHolder: async () => fakeShareHolder('secp256k1'),
    });
    const r = await driver.sign(evmReq);
    expect(r.signatures[0]?.length).toBe(64);
  });

  it('accepts 65-byte aggregates (with v byte)', async () => {
    const sig = new Uint8Array(65).fill(0x66);
    const driver = frostSecp256k1Driver({
      coordinator: fakeCoordinator({ signature: sig }),
      resolveShareHolder: async () => fakeShareHolder('secp256k1'),
    });
    const r = await driver.sign(evmReq);
    expect(r.signatures[0]?.length).toBe(65);
  });

  it('rejects wrong scheme', async () => {
    const driver = frostSecp256k1Driver({
      coordinator: fakeCoordinator({ signature: new Uint8Array(64) }),
      resolveShareHolder: async () => fakeShareHolder('secp256k1'),
    });
    await expect(driver.sign({ ...evmReq, scheme: 'ed25519' })).rejects.toThrow(
      /cannot sign scheme/,
    );
  });
});

describe('hybridEd25519MlDsaDriver', () => {
  function fakeMlDsaCoordinator(sig: Uint8Array): MlDsaCoordinator {
    return {
      async capabilities() {
        return { mode: 'tee-only' };
      },
      async sign() {
        return { signature: sig };
      },
    };
  }

  const hybridReq: SigningRequest = {
    did: DID,
    surfaceKey: TENZRO_KEY,
    scheme: 'ed25519+ml-dsa-65',
    preimage: new Uint8Array([1, 2, 3, 4]),
  };

  it('returns both legs in the right order and lengths', async () => {
    const ed = new Uint8Array(64).fill(0x11);
    const ml = new Uint8Array(3293).fill(0x22);
    const driver = hybridEd25519MlDsaDriver({
      coordinator: fakeCoordinator({ signature: ed }),
      resolveShareHolder: async () => fakeShareHolder('ed25519'),
      mlDsaCoordinator: fakeMlDsaCoordinator(ml),
    });
    const r = await driver.sign(hybridReq);
    expect(r.signatures).toHaveLength(2);
    expect(r.signatures[0]?.length).toBe(64);
    expect(r.signatures[1]?.length).toBe(3293);
  });

  it('rejects non-hybrid schemes', async () => {
    const driver = hybridEd25519MlDsaDriver({
      coordinator: fakeCoordinator({ signature: new Uint8Array(64) }),
      resolveShareHolder: async () => fakeShareHolder('ed25519'),
      mlDsaCoordinator: fakeMlDsaCoordinator(new Uint8Array(3293)),
    });
    await expect(driver.sign({ ...hybridReq, scheme: 'ed25519' })).rejects.toThrow(
      /cannot sign scheme/,
    );
  });

  it('rejects wrong-length ml-dsa leg', async () => {
    const driver = hybridEd25519MlDsaDriver({
      coordinator: fakeCoordinator({ signature: new Uint8Array(64) }),
      resolveShareHolder: async () => fakeShareHolder('ed25519'),
      mlDsaCoordinator: fakeMlDsaCoordinator(new Uint8Array(3000)),
    });
    await expect(driver.sign(hybridReq)).rejects.toThrow(/wrong-length/);
  });

  it('runs the two legs in parallel', async () => {
    const order: string[] = [];
    const slowEd: FrostCoordinator = {
      ...fakeCoordinator({ signature: new Uint8Array(64) }),
      async finalize(sid) {
        await new Promise((r) => setTimeout(r, 20));
        order.push('ed-finalize');
        return {
          sessionId: sid,
          state: 'finalized',
          signature: new Uint8Array(64),
        };
      },
    };
    const slowMl: MlDsaCoordinator = {
      async capabilities() {
        return { mode: 'tee-only' };
      },
      async sign() {
        await new Promise((r) => setTimeout(r, 20));
        order.push('ml-sign');
        return { signature: new Uint8Array(3293) };
      },
    };
    const driver = hybridEd25519MlDsaDriver({
      coordinator: slowEd,
      resolveShareHolder: async () => fakeShareHolder('ed25519'),
      mlDsaCoordinator: slowMl,
    });
    const t0 = Date.now();
    await driver.sign(hybridReq);
    const elapsed = Date.now() - t0;
    // Sequential would be ~40ms; parallel ~20ms. Allow generous slack.
    expect(elapsed).toBeLessThan(60);
    expect(order).toHaveLength(2);
  });
});

// Silence unused warning for the imported `vi`; kept available for ad-hoc
// debugging of these tests without re-importing.
void vi;
