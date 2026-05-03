/**
 * End-to-end smoke test: provision identity → prepare → sign → submit → watch
 * a Tenzro-native send through the kernel facade.
 */

import { describe, expect, it } from 'vitest';
import { internalMpcDriver } from './custody/internal-mpc.ts';
import { provisionIdentity } from './identity/provision.ts';
import { WalletKernel } from './kernel.ts';
import type { CantonValidatorPort } from './ports/canton/canton-validator.ts';
import type { TenzroRpcPort, TenzroTxStatus } from './ports/tenzro-rpc.ts';
import {
  cantonExternalSurface,
  cantonInternalSurface,
  evmOnTenzroSurface,
  svmOnTenzroSurface,
  tenzroNativeSurface,
} from './surfaces/index.ts';
import type { AssetId } from './types/asset.ts';
import type { TdipDid, TdipIdentity, SurfaceKey } from './types/identity.ts';
import type { Intent, TxStatus } from './types/intent.ts';
import type { SurfaceModule } from './types/surface-module.ts';
import type { SurfaceName } from './types/surface.ts';

/**
 * In-memory port that walks a tx through pending → included → finalized on
 * successive `getTransaction` calls. Lets the kernel-level e2e exercise the
 * real port-driven `watch()` loop without standing up a node.
 */
function progressingRpcPort(): TenzroRpcPort {
  const walk: TenzroTxStatus['status'][] = ['pending', 'included', 'finalized'];
  let i = 0;
  let hash = '';
  return {
    getNonce: async () => 0,
    getChainId: async () => 1337,
    sendTransaction: async () => {
      hash = '0xfeedface';
      return hash;
    },
    getTransaction: async () => {
      const status = walk[Math.min(i, walk.length - 1)]!;
      i += 1;
      return {
        hash,
        status,
        ...(status === 'pending' ? {} : { blockHeight: 1 }),
      };
    },
  };
}

/**
 * In-memory CantonValidatorPort that throws on every protocol call. The
 * kernel-level smoke test uses this to pin the routing decision (intent →
 * canton-external surface) without reaching the validator. The
 * LedgerApiAdapter is exercised separately in its own unit tests.
 */
function throwingCantonPort(): CantonValidatorPort {
  const nope = (op: string): never => {
    throw new Error(`canton port: ${op} not implemented (M4 test stub)`);
  };
  return {
    prepareSubmission: async () => nope('prepareSubmission'),
    executeSubmission: async () => nope('executeSubmission'),
    tailCompletions: async function* () {
      nope('tailCompletions');
    },
    getActiveContracts: async function* () {
      nope('getActiveContracts');
    },
    lookupPreapproval: async () => null,
    resolveCns: async () => null,
    generateTopology: async () => nope('generateTopology'),
    submitTopology: async () => nope('submitTopology'),
    setupProposal: async () => nope('setupProposal'),
    prepareAcceptSetup: async () => nope('prepareAcceptSetup'),
    submitAcceptSetup: async () => nope('submitAcceptSetup'),
  };
}

function buildKernel(identity: TdipIdentity): WalletKernel {
  const driver = internalMpcDriver();
  const keyResolver = (did: TdipDid, surface: SurfaceName): SurfaceKey | undefined => {
    if (did !== identity.did) return undefined;
    return identity.keys.get(surface);
  };
  const surfaces = new Map<SurfaceName, SurfaceModule>([
    [
      'tenzro-native',
      tenzroNativeSurface({
        keyResolver: (d) => keyResolver(d, 'tenzro-native'),
        signingDriver: driver,
        rpc: progressingRpcPort(),
      }),
    ],
    [
      'evm-on-tenzro',
      evmOnTenzroSurface({
        keyResolver: (d) => keyResolver(d, 'evm-on-tenzro'),
        signingDriver: driver,
      }),
    ],
    [
      'svm-on-tenzro',
      svmOnTenzroSurface({
        keyResolver: (d) => keyResolver(d, 'svm-on-tenzro'),
        signingDriver: driver,
      }),
    ],
    [
      'canton-internal',
      cantonInternalSurface({
        keyResolver: (d) => keyResolver(d, 'canton-internal'),
        signingDriver: driver,
        validatorPort: throwingCantonPort(),
        userId: 'tenzro-wallet-test',
      }),
    ],
    [
      'canton-external',
      cantonExternalSurface({
        keyResolver: (d) => keyResolver(d, 'canton-external'),
        signingDriver: driver,
        validatorPort: throwingCantonPort(),
        userId: 'tenzro-wallet-test',
      }),
    ],
  ]);
  return new WalletKernel({ identity, surfaces });
}

const TNZO: AssetId = { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 };

describe('WalletKernel end-to-end', () => {
  it('runs prepare → sign → submit → watch on a Tenzro-native send', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-test-1' });
    const kernel = buildKernel(identity);

    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'tdip', did: identity.did },
      asset: TNZO,
      amount: 5n * 10n ** 18n,
    };

    const prepared = await kernel.prepare(intent);
    expect(prepared.route.kind).toBe('native');

    const signed = await kernel.sign(prepared, { approvedAt: Date.now() });
    // Hybrid signing → two signatures.
    expect(signed.signatures).toHaveLength(2);

    const handle = await kernel.submit(signed);
    expect(handle.surface).toBe('tenzro-native');

    const phases: TxStatus['phase'][] = [];
    for await (const status of kernel.watch(handle)) phases.push(status.phase);
    expect(phases).toEqual(['created', 'pending', 'confirmed', 'finalized']);
  });

  it('routes EVM→SVM same-DID send as a cross-VM pointer op (no bridge)', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-test-pointer' });
    const kernel = buildKernel(identity);
    const svmKey = identity.keys.get('svm-on-tenzro');
    if (!svmKey || svmKey.surface !== 'svm-on-tenzro') throw new Error('no svm key');

    // EVM-held TNZO routed to SVM-shape recipient (the same identity's SVM
    // pubkey) — both surfaces are on-Tenzro, so the router must pick a
    // pointer op, not a bridge or a native send.
    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'svm', publicKey: svmKey.address },
      asset: TNZO,
      amount: 1n * 10n ** 18n,
      fromSurface: 'evm-on-tenzro',
    };
    const prepared = await kernel.prepare(intent);
    expect(prepared.route.kind).toBe('cross-vm-pointer');
    if (prepared.route.kind === 'cross-vm-pointer') {
      expect(prepared.route.fromSurface).toBe('evm-on-tenzro');
      expect(prepared.route.toSurface).toBe('svm-on-tenzro');
      expect(prepared.route.precompile).toBe('0x1003');
    }
    // Whole-TNZO amount has no sub-lamport residual — no dust warning.
    expect(prepared.warnings).toEqual([]);
  });

  it('warns about sub-lamport dust on EVM→SVM pointer ops', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-test-dust' });
    const kernel = buildKernel(identity);
    const svmKey = identity.keys.get('svm-on-tenzro');
    if (!svmKey || svmKey.surface !== 'svm-on-tenzro') throw new Error('no svm key');

    // 1.000_000_000_500_000_000 TNZO — the trailing 500_000_000 wei is below
    // SVM 9-dec precision and gets truncated on the destination view.
    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'svm', publicKey: svmKey.address },
      asset: TNZO,
      amount: 1n * 10n ** 18n + 500_000_000n,
      fromSurface: 'evm-on-tenzro',
    };
    const prepared = await kernel.prepare(intent);
    expect(prepared.warnings).toHaveLength(1);
    expect(prepared.warnings[0]).toMatch(/500000000 sub-units/);
    expect(prepared.warnings[0]).toMatch(/svm-on-tenzro precision/);
  });

  it('refuses to sign when policy is violated', async () => {
    const identity = await provisionIdentity({ uuid: 'kernel-test-2' });
    const driver = internalMpcDriver();
    const surfaces = new Map<SurfaceName, SurfaceModule>([
      [
        'tenzro-native',
        tenzroNativeSurface({
          keyResolver: () => identity.keys.get('tenzro-native'),
          signingDriver: driver,
        }),
      ],
    ]);
    const kernel = new WalletKernel({
      identity,
      surfaces,
      sessionPolicy: { maxPerTx: 1n },
    });

    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'tdip', did: identity.did },
      asset: TNZO,
      amount: 1000n,
    };
    const prepared = await kernel.prepare(intent);
    await expect(kernel.sign(prepared, { approvedAt: Date.now() })).rejects.toThrow(
      /policy violation/,
    );
  });

  it('routes Canton MainNet sends to the canton-external surface (port-driven)', async () => {
    // canton-external is now port-driven end-to-end. The smoke test fixture
    // injects `throwingCantonPort()` so the routing decision is pinned
    // (intent → canton-external) and `prepare()` fails inside
    // `port.prepareSubmission` rather than at a kernel-level stub. The real
    // wire path is exercised against `LedgerApiAdapter` in adapter tests.
    const identity = await provisionIdentity({ uuid: 'kernel-test-3' });
    const kernel = buildKernel(identity);
    const intent: Intent = {
      kind: 'send',
      from: identity.did,
      to: { kind: 'canton', partyId: 'kraken::1220abc' },
      asset: { scope: 'canton-mainnet', symbol: 'CC', decimals: 10 },
      amount: 10n * 10n ** 10n,
      memo: '4012745722',
    };
    await expect(kernel.prepare(intent)).rejects.toThrow(
      /prepareSubmission not implemented/,
    );
  });
});
