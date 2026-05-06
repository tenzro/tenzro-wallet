/**
 * Pin DelegateSetConfig validation. The full recovery flow lands with the
 * passkey-quorum custody surface (M5.5); this test fixes the constraints
 * the rest of the system can rely on.
 */

import { describe, expect, it } from 'vitest';
import type { TdipDid } from '../types/identity.ts';
import {
  DELEGATE_SET_DEFAULT_K,
  DELEGATE_SET_DEFAULT_N,
  DELEGATE_SET_MAX_N,
  DELEGATE_SET_OPTIONS,
  defaultDelegateSet,
  validateDelegateSet,
} from './delegate-set.ts';

const did = (x: string): TdipDid => x as TdipDid;
const FIVE = [
  did('did:tenzro:human:alice'),
  did('did:tenzro:human:bob'),
  did('did:tenzro:human:carol'),
  did('did:tenzro:human:dave'),
  did('did:tenzro:human:eve'),
];

describe('validateDelegateSet', () => {
  it('accepts a 3-of-5 with five distinct delegates', () => {
    const cfg = validateDelegateSet({ k: 3, n: 5, delegates: FIVE });
    expect(cfg.k).toBe(3);
    expect(cfg.n).toBe(5);
  });

  it('rejects k > n', () => {
    expect(() => validateDelegateSet({ k: 4, n: 3, delegates: FIVE.slice(0, 3) })).toThrow(
      /k.*exceed/,
    );
  });

  it('rejects k < 1', () => {
    expect(() => validateDelegateSet({ k: 0, n: 3, delegates: FIVE.slice(0, 3) })).toThrow(
      /k must be/,
    );
  });

  it('rejects n above DELEGATE_SET_MAX_N', () => {
    const tooMany = [
      ...FIVE,
      did('did:tenzro:human:f'),
      did('did:tenzro:human:g'),
      did('did:tenzro:human:h'),
    ];
    expect(() =>
      validateDelegateSet({
        k: 5,
        n: tooMany.length,
        delegates: tooMany,
      }),
    ).toThrow(new RegExp(`exceeds DELEGATE_SET_MAX_N \\(${DELEGATE_SET_MAX_N}\\)`));
  });

  it('rejects when delegates length does not match n', () => {
    expect(() => validateDelegateSet({ k: 3, n: 5, delegates: FIVE.slice(0, 4) })).toThrow(
      /expected exactly 5/,
    );
  });

  it('rejects duplicate delegate DIDs', () => {
    expect(() =>
      validateDelegateSet({
        k: 3,
        n: 5,
        delegates: [FIVE[0]!, FIVE[0]!, FIVE[1]!, FIVE[2]!, FIVE[3]!],
      }),
    ).toThrow(/duplicate delegate/);
  });

  it('rejects when wallet DID appears in its own delegate set', () => {
    expect(() => validateDelegateSet({ k: 3, n: 5, delegates: FIVE }, FIVE[2]!)).toThrow(
      /cannot appear in its own delegate list/,
    );
  });
});

describe('defaultDelegateSet', () => {
  it('builds a 3-of-5 from the first 5 supplied delegates', () => {
    const cfg = defaultDelegateSet(FIVE);
    expect(cfg.k).toBe(DELEGATE_SET_DEFAULT_K);
    expect(cfg.n).toBe(DELEGATE_SET_DEFAULT_N);
    expect(cfg.delegates).toEqual(FIVE);
  });

  it('throws when fewer than 5 delegates are supplied', () => {
    expect(() => defaultDelegateSet(FIVE.slice(0, 4))).toThrow(/need 5/);
  });
});

describe('DELEGATE_SET_OPTIONS', () => {
  it('exposes the curated presets the UI offers', () => {
    expect(DELEGATE_SET_OPTIONS.map((o) => `${o.k}-of-${o.n}`)).toEqual([
      '2-of-3',
      '3-of-5',
      '5-of-7',
    ]);
  });
});
