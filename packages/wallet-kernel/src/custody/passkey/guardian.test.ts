import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes.ts';
import {
  type GuardianCard,
  checkGuardianQuorum,
  compositeMessage,
  decodeGuardianCard,
  deriveGuardianKeys,
  encodeGuardianCard,
  guardianRole,
  recoveryOpHash,
} from './guardian.ts';

const prf = new Uint8Array(32).fill(7);

function readComposite(sig: Uint8Array): { classical: Uint8Array; pq: Uint8Array } {
  const view = new DataView(sig.buffer, sig.byteOffset);
  const a = Number(view.getBigUint64(0, true));
  const b = Number(view.getBigUint64(8 + a, true));
  expect(16 + a + b).toBe(sig.length);
  return { classical: sig.slice(8, 8 + a), pq: sig.slice(16 + a) };
}

describe('guardian keys', () => {
  it('derive deterministically from the PRF and differ per PRF', () => {
    const a = deriveGuardianKeys(prf);
    const b = deriveGuardianKeys(prf);
    const c = deriveGuardianKeys(new Uint8Array(32).fill(8));
    expect(a.ed25519PublicKey).toEqual(b.ed25519PublicKey);
    expect(a.mlDsaPublicKey).toEqual(b.mlDsaPublicKey);
    expect(a.ed25519PublicKey).not.toEqual(c.ed25519PublicKey);
    expect(a.mlDsaPublicKey.length).toBe(1952);
  });

  it('sign a recovery approval both legs verify over the composite message', () => {
    const k = deriveGuardianKeys(prf);
    const hash = new Uint8Array(32).fill(3);
    const { classical, pq } = readComposite(k.approve(hash));
    const m = compositeMessage(hash);
    expect(classical.length).toBe(64);
    expect(ed25519.verify(classical, m, k.ed25519PublicKey)).toBe(true);
    const context = utf8('COMPSIG-MLDSA65-Ed25519-SHA512');
    expect(ml_dsa65.verify(pq, m, k.mlDsaPublicKey, { context })).toBe(true);
    expect(ml_dsa65.verify(pq, compositeMessage(new Uint8Array(32)), k.mlDsaPublicKey, { context })).toBe(false);
    k.wipe();
  });
});

describe('recoveryOpHash', () => {
  const base = {
    account: `0x${'ab'.repeat(20)}`,
    newPasskeyPublicKey: new Uint8Array(64).fill(1),
    newMlDsaPublicKey: new Uint8Array(1952).fill(2),
    newCredentialId: new Uint8Array(16).fill(3),
    recoveryId: 'rec-1',
    expiresAtMs: 1_700_000_000_000,
  };
  it('binds every part', () => {
    const h = recoveryOpHash(base);
    expect(h.length).toBe(32);
    expect(recoveryOpHash({ ...base, recoveryId: 'rec-2' })).not.toEqual(h);
    expect(recoveryOpHash({ ...base, expiresAtMs: base.expiresAtMs + 1 })).not.toEqual(h);
    expect(recoveryOpHash({ ...base, newMlDsaPublicKey: new Uint8Array(1952) })).not.toEqual(h);
  });
});

const card = (over: Partial<GuardianCard>): GuardianCard => ({
  format: 'tenzro-guardian',
  version: 1,
  label: 'g',
  source: 'trusted_person',
  ed25519: `0x${'11'.repeat(32)}`,
  mlDsa65: `0x${'22'.repeat(1952)}`,
  tier: 'synced',
  credentialId: `0x${Math.random().toString(16).slice(2)}`,
  ...over,
});

describe('guardian cards and quorum independence', () => {
  it('round-trip a card and refuse anything else', () => {
    const c = card({ aaguid: 'ea9b8d664d011d213ce4b6b48cb575d4' });
    expect(decodeGuardianCard(encodeGuardianCard(c))).toEqual(c);
    expect(() => decodeGuardianCard('not a card')).toThrow(/not a guardian card/);
  });

  it('maps sources to node roles', () => {
    expect(guardianRole('security_key')).toBe('recovery_key');
    expect(guardianRole('own_passkey')).toBe('device');
    expect(guardianRole('trusted_person')).toBe('device');
  });

  it('accepts a quorum only when no provider can reach the threshold alone', () => {
    const icloud = 'fbfc3007154e4ecc8c0b6e020557d7bd';
    const gpm = 'ea9b8d664d011d213ce4b6b48cb575d4';
    const twoSame = [card({ aaguid: icloud }), card({ aaguid: icloud })];
    expect(checkGuardianQuorum(twoSame, 0, 2).ok).toBe(false);
    expect(checkGuardianQuorum([card({ aaguid: icloud }), card({ aaguid: gpm })], 0, 2).ok).toBe(true);
    expect(checkGuardianQuorum([card({ aaguid: icloud }), card({ tier: 'device-bound' })], 0, 2).ok).toBe(true);
    expect(checkGuardianQuorum([card({}), card({})], 0, 2).ok).toBe(false);
    expect(checkGuardianQuorum([card({ aaguid: icloud })], 0, 1).ok).toBe(false);
    expect(checkGuardianQuorum([card({ aaguid: icloud })], 2, 2).ok).toBe(false);
    expect(checkGuardianQuorum([card({ aaguid: icloud }), card({ aaguid: gpm })], 1, 3).ok).toBe(true);
    expect(checkGuardianQuorum([card({ aaguid: icloud }), card({ aaguid: gpm })], 0, 3).ok).toBe(false);
  });
});
