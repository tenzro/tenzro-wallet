import { describe, expect, it } from 'vitest';
import {
  bigintToBytes,
  bytesToHex,
  hexToBytes,
  numberToBytes,
  rlpDecode,
  rlpEncode,
  type RLPItem,
} from './rlp.ts';

describe('rlp', () => {
  // Canonical vectors from the Ethereum Yellow Paper appendix B and
  // ethereumjs-rlp test fixtures.

  it('encodes the empty string as 0x80', () => {
    expect(bytesToHex(rlpEncode(new Uint8Array(0)))).toBe('0x80');
  });

  it('encodes single byte < 0x80 as itself', () => {
    expect(bytesToHex(rlpEncode(new Uint8Array([0x7f])))).toBe('0x7f');
  });

  it('encodes "dog" as 83 64 6f 67', () => {
    expect(bytesToHex(rlpEncode(new TextEncoder().encode('dog')))).toBe('0x83646f67');
  });

  it('encodes the empty list as 0xc0', () => {
    expect(bytesToHex(rlpEncode([]))).toBe('0xc0');
  });

  it('encodes ["cat","dog"] correctly', () => {
    const items: RLPItem = [
      new TextEncoder().encode('cat'),
      new TextEncoder().encode('dog'),
    ];
    expect(bytesToHex(rlpEncode(items))).toBe('0xc88363617483646f67');
  });

  it('encodes 0 as the empty byte string (RLP minimal-int convention)', () => {
    expect(bytesToHex(rlpEncode(numberToBytes(0)))).toBe('0x80');
  });

  it('encodes 15 as 0x0f', () => {
    expect(bytesToHex(rlpEncode(numberToBytes(15)))).toBe('0x0f');
  });

  it('encodes 1024 as 82 04 00', () => {
    expect(bytesToHex(rlpEncode(numberToBytes(1024)))).toBe('0x820400');
  });

  it('encodes a long string with the 0xb7+lenLen prefix', () => {
    const s = 'Lorem ipsum dolor sit amet, consectetur adipisicing elit'; // 56 chars
    const bytes = new TextEncoder().encode(s);
    const enc = rlpEncode(bytes);
    expect(enc[0]).toBe(0xb8);
    expect(enc[1]).toBe(56);
    expect(enc.subarray(2)).toEqual(bytes);
  });

  it('round-trips a complex EIP-1559-shaped tuple', () => {
    const items: RLPItem = [
      numberToBytes(1337), // chainId
      numberToBytes(0), // nonce (zero → empty bytes)
      bigintToBytes(100_000_000n), // maxPriorityFeePerGas
      bigintToBytes(1_000_000_000n), // maxFeePerGas
      numberToBytes(21000), // gasLimit
      hexToBytes('0xdeadbeef00000000000000000000000000000001'), // to (20 bytes)
      bigintToBytes(123_456_789_000_000_000n), // value
      new Uint8Array(0), // data
      [] as RLPItem[], // accessList
    ];
    const enc = rlpEncode(items);
    const dec = rlpDecode(enc) as RLPItem[];
    expect(dec).toHaveLength(9);
    // Round-trip: re-encoding the decoded items must match.
    expect(bytesToHex(rlpEncode(dec))).toBe(bytesToHex(enc));
  });
});
