/**
 * Tests for Canton key fingerprinting. Pin the `1220` multihash prefix +
 * SHA-256 hex format so the kernel matches the validator's lookup key in
 * `PartyToKeyMapping`.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '../../crypto/sha256.ts';
import { cantonFingerprint } from './fingerprint.ts';

describe('cantonFingerprint', () => {
  it('produces `1220` + lowercase-hex SHA-256 of the public key', async () => {
    const pub = new Uint8Array([1, 2, 3, 4]);
    const fp = await cantonFingerprint(pub);
    const hash = await sha256(pub);
    let hex = '';
    for (const b of hash) hex += b.toString(16).padStart(2, '0');
    expect(fp).toBe(`1220${hex}`);
    expect(fp.startsWith('1220')).toBe(true);
    // 4 hex chars for prefix + 64 chars for SHA-256 = 68 total.
    expect(fp).toHaveLength(68);
  });

  it('is deterministic — same input → same fingerprint', async () => {
    const pub = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
    const a = await cantonFingerprint(pub);
    const b = await cantonFingerprint(pub);
    expect(a).toBe(b);
  });

  it('different keys produce different fingerprints', async () => {
    const a = await cantonFingerprint(new Uint8Array([1]));
    const b = await cantonFingerprint(new Uint8Array([2]));
    expect(a).not.toBe(b);
  });
});
