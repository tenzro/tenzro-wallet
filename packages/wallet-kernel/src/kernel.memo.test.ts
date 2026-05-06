/**
 * Pin `kernel.memoSpec(intent)` — the memo-shape resolver. Surfaces that
 * implement `memoSpec` get their value through; those that don't return
 * `MEMO_SPEC_NONE`.
 */

import { describe, expect, it } from 'vitest';
import { WalletKernel } from './kernel.ts';
import type { AssetId } from './types/asset.ts';
import type { TdipDid, TdipIdentity } from './types/identity.ts';
import { type Intent, MEMO_SPEC_NONE, type MemoSpec } from './types/intent.ts';
import type { SurfaceModule } from './types/surface-module.ts';

const DID = 'did:tdip:0xabc' as TdipDid;

function stubSurface(name: SurfaceModule['name'], spec?: MemoSpec): SurfaceModule {
  const base: SurfaceModule = {
    name,
    prepare: async () => {
      throw new Error('not used');
    },
    sign: async () => {
      throw new Error('not used');
    },
    submit: async () => {
      throw new Error('not used');
    },
    watch: async function* () {},
  };
  if (spec) {
    return { ...base, memoSpec: () => spec };
  }
  return base;
}

const identity: TdipIdentity = {
  did: DID,
  parts: { method: 'tenzro', kind: 'human', uuid: 'abc' },
  keys: new Map(),
  createdAt: 0,
};

const cantonAsset: AssetId = {
  scope: 'canton-mainnet',
  symbol: 'CC',
  decimals: 10,
};
const tnzoAsset: AssetId = {
  scope: 'tenzro-native',
  symbol: 'TNZO',
  decimals: 18,
};

const intentToCanton: Intent = {
  kind: 'send',
  from: DID,
  to: { kind: 'canton', partyId: 'alice::fp' },
  asset: cantonAsset,
  amount: 1n,
};

const intentToEvm: Intent = {
  kind: 'send',
  from: DID,
  to: { kind: 'evm', address: '0x1111111111111111111111111111111111111111' },
  asset: tnzoAsset,
  amount: 1n,
  fromSurface: 'evm-on-tenzro',
};

describe('WalletKernel.memoSpec', () => {
  it('returns the surface-declared spec for canton-external sends', () => {
    const cantonSpec: MemoSpec = {
      kind: 'text',
      required: false,
      maxLength: 256,
      label: 'Transfer description',
    };
    const k = new WalletKernel({
      identity,
      surfaces: new Map<SurfaceModule['name'], SurfaceModule>([
        ['canton-external', stubSurface('canton-external', cantonSpec)],
      ]),
    });
    expect(k.memoSpec(intentToCanton)).toEqual(cantonSpec);
  });

  it('returns MEMO_SPEC_NONE when the surface does not implement memoSpec', () => {
    const k = new WalletKernel({
      identity,
      surfaces: new Map<SurfaceModule['name'], SurfaceModule>([
        ['evm-on-tenzro', stubSurface('evm-on-tenzro')],
      ]),
    });
    expect(k.memoSpec(intentToEvm)).toEqual(MEMO_SPEC_NONE);
  });
});
