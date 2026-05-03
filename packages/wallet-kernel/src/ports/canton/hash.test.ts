/**
 * Tests for Canton hash recomputation. These pin the prefix shape (purpose
 * + algorithm byte) so a regression — say, dropping the algorithm byte —
 * trips immediately rather than silently producing the wrong hash on every
 * Canton submission.
 */

import { describe, expect, it } from 'vitest';
import { sha256, concatBytes } from '../../crypto/sha256.ts';
import {
  bytesEqualConstantTime,
  preparedTransactionHash,
  topologyBundleHash,
} from './hash.ts';

describe('canton hash', () => {
  it('preparedTransactionHash prepends purpose=11 + algo=0 to SHA-256', async () => {
    const payload = new TextEncoder().encode('hello-canton');
    const got = await preparedTransactionHash(payload);
    // Reproduce the expected hash from first principles to lock the prefix.
    const purposePrefix = new Uint8Array([0, 0, 0, 11]); // big-endian u32(11)
    const algoPrefix = new Uint8Array([0]); // SHA-256 = 0
    const expected = await sha256(concatBytes(purposePrefix, algoPrefix, payload));
    expect(bytesEqualConstantTime(got, expected)).toBe(true);
  });

  it('topologyBundleHash uses purpose=55 over concatenated bundle bytes', async () => {
    const tx1 = new Uint8Array([1, 2, 3]);
    const tx2 = new Uint8Array([4, 5, 6]);
    const got = await topologyBundleHash([tx1, tx2]);
    const expected = await sha256(
      concatBytes(new Uint8Array([0, 0, 0, 55]), new Uint8Array([0]), tx1, tx2),
    );
    expect(bytesEqualConstantTime(got, expected)).toBe(true);
  });

  it('different payloads produce different hashes (collision smoke check)', async () => {
    const a = await preparedTransactionHash(new Uint8Array([1, 2, 3]));
    const b = await preparedTransactionHash(new Uint8Array([1, 2, 4]));
    expect(bytesEqualConstantTime(a, b)).toBe(false);
  });

  it('bytesEqualConstantTime returns false on different lengths', () => {
    expect(
      bytesEqualConstantTime(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])),
    ).toBe(false);
  });

  it('bytesEqualConstantTime returns true for byte-equal slices of equal length', () => {
    expect(
      bytesEqualConstantTime(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])),
    ).toBe(true);
  });
});
