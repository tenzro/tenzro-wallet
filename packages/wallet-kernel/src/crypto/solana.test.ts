import { describe, expect, it } from 'vitest';
import {
  base58Decode,
  base58Encode,
  compactArrayLength,
  readCompactArrayLength,
  serializeCompiledMessage,
  serializeTransaction,
  type CompiledMessage,
} from './solana.ts';
import { bytesToHex, hexToBytes } from './rlp.ts';

describe('solana / compactArrayLength (short_vec)', () => {
  it('encodes 0 as a single 0x00 byte', () => {
    expect(compactArrayLength(0)).toEqual(new Uint8Array([0x00]));
  });

  it('encodes 127 as a single byte', () => {
    expect(compactArrayLength(127)).toEqual(new Uint8Array([0x7f]));
  });

  it('encodes 128 as two bytes (0x80 0x01)', () => {
    expect(compactArrayLength(128)).toEqual(new Uint8Array([0x80, 0x01]));
  });

  it('encodes 16383 as two bytes (0xff 0x7f)', () => {
    expect(compactArrayLength(16_383)).toEqual(new Uint8Array([0xff, 0x7f]));
  });

  it('encodes 16384 as three bytes (0x80 0x80 0x01)', () => {
    expect(compactArrayLength(16_384)).toEqual(new Uint8Array([0x80, 0x80, 0x01]));
  });

  it('round-trips a range of values', () => {
    for (const n of [0, 1, 127, 128, 255, 16_383, 16_384, 100_000]) {
      const enc = compactArrayLength(n);
      const { value, consumed } = readCompactArrayLength(enc, 0);
      expect(value).toBe(n);
      expect(consumed).toBe(enc.length);
    }
  });
});

describe('solana / base58', () => {
  it('encodes the empty string for empty input', () => {
    expect(base58Encode(new Uint8Array(0))).toBe('');
  });

  it('encodes leading zeros as leading "1" characters', () => {
    // 0x42 = 66 = 1*58 + 8 → digits [1,8] → "29"; three leading zeros → "111".
    expect(base58Encode(new Uint8Array([0, 0, 0, 0x42]))).toBe('11129');
    expect(base58Decode('11129')).toEqual(new Uint8Array([0, 0, 0, 0x42]));
  });

  it('matches the canonical Bitcoin/Solana vector for 32-byte pubkey', () => {
    // Vendor a known Solana pubkey vector: System Program ID. Its on-chain
    // 32-byte representation is all zeros, base58-encoded as
    // "11111111111111111111111111111111" (32 leading "1"s).
    const sysProg = new Uint8Array(32);
    expect(base58Encode(sysProg)).toBe('11111111111111111111111111111111');
    expect(base58Decode('11111111111111111111111111111111')).toEqual(sysProg);
  });

  it('round-trips a random 32-byte pubkey', () => {
    const bytes = hexToBytes('0xdeadbeef'.padEnd(66, 'a').replace('0x', '0x'));
    const fixed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) fixed[i] = (i * 31 + 7) & 0xff;
    const s = base58Encode(fixed);
    expect(base58Decode(s)).toEqual(fixed);
    void bytes;
  });

  it('rejects invalid base58 characters', () => {
    expect(() => base58Decode('0OIl')).toThrow(/invalid character/);
  });
});

describe('solana / compiled message + tx serialisation', () => {
  // Smallest non-trivial message: one signer (the fee payer), one program
  // (system program), one instruction with 1 byte of data.
  const signer = new Uint8Array(32).fill(0xaa);
  const sysProgram = new Uint8Array(32); // 11111…11
  const blockhash = new Uint8Array(32).fill(0xbb);
  const message: CompiledMessage = {
    numRequiredSignatures: 1,
    numReadonlySignedAccounts: 0,
    numReadonlyUnsignedAccounts: 1, // program is read-only non-signer
    accountKeys: [signer, sysProgram],
    recentBlockhash: blockhash,
    instructions: [
      {
        programIdIndex: 1,
        accountKeyIndices: [0],
        data: new Uint8Array([0x42]),
      },
    ],
  };

  it('serialises the header correctly', () => {
    const bytes = serializeCompiledMessage(message);
    expect(bytes[0]).toBe(1); // numRequiredSignatures
    expect(bytes[1]).toBe(0); // numReadonlySignedAccounts
    expect(bytes[2]).toBe(1); // numReadonlyUnsignedAccounts
  });

  it('places account keys, blockhash, and instructions in the right offsets', () => {
    const bytes = serializeCompiledMessage(message);
    // header(3) + compact-array-len(2 → 1 byte) = 4
    expect(bytes[3]).toBe(2);
    // 32-byte signer pubkey at offset 4..36
    expect(bytesToHex(bytes.subarray(4, 36))).toBe('0x' + 'aa'.repeat(32));
    // 32-byte sysProgram at offset 36..68
    expect(bytesToHex(bytes.subarray(36, 68))).toBe('0x' + '00'.repeat(32));
    // 32-byte blockhash at offset 68..100
    expect(bytesToHex(bytes.subarray(68, 100))).toBe('0x' + 'bb'.repeat(32));
    // instructions count = 1 at offset 100
    expect(bytes[100]).toBe(1);
    // ix: programIdIndex=1, accounts-count=1, account-idx=0, data-len=1, data=0x42
    expect(bytes[101]).toBe(1);
    expect(bytes[102]).toBe(1);
    expect(bytes[103]).toBe(0);
    expect(bytes[104]).toBe(1);
    expect(bytes[105]).toBe(0x42);
    expect(bytes.length).toBe(106);
  });

  it('serialises a signed transaction with one signature prepended', () => {
    const sig = new Uint8Array(64).fill(0xcc);
    const tx = serializeTransaction(message, [sig]);
    // compact-array-len(1) = 1 byte, then 64-byte sig, then message
    expect(tx[0]).toBe(1);
    expect(bytesToHex(tx.subarray(1, 65))).toBe('0x' + 'cc'.repeat(64));
    expect(tx.length).toBe(1 + 64 + 106);
  });

  it('rejects mismatched signature counts', () => {
    expect(() => serializeTransaction(message, [])).toThrow(/expected 1 signatures/);
  });

  it('rejects non-64-byte signatures', () => {
    expect(() =>
      serializeTransaction(message, [new Uint8Array(32)]),
    ).toThrow(/64 bytes/);
  });
});
