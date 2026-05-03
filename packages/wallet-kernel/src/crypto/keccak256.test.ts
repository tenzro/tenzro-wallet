import { describe, expect, it } from 'vitest';
import { keccak256 } from './keccak256.ts';
import { bytesToHex } from './rlp.ts';

describe('keccak256', () => {
  it('matches the canonical empty-string digest', () => {
    // keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
    expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });

  it('matches the canonical "abc" digest', () => {
    // keccak256("abc") = 4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45
    const abc = new TextEncoder().encode('abc');
    expect(bytesToHex(keccak256(abc))).toBe(
      '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });

  it('matches the canonical 1M-"a" digest', () => {
    // NIST/keccak reference vector: keccak256 of one million ASCII 'a'.
    // Forces dozens of absorption blocks to exercise the rate boundary.
    // Result per https://emn178.github.io/online-tools/keccak_256.html
    // and the Keccak Code Package test vectors.
    const million = new Uint8Array(1_000_000).fill(0x61); // 'a'
    expect(bytesToHex(keccak256(million))).toBe(
      '0xfadae6b49f129bbb812be8407b7b2894f34aecf6dbd1f9b0f0c7e9853098fc96',
    );
  });
});
