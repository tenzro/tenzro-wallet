import { describe, expect, it } from 'vitest';
import {
  encodeForSigning,
  serializeSigned,
  signingHash,
  splitSignature,
  type Eip1559Signature,
  type Eip1559Tx,
} from './eip1559.ts';
import { bytesToHex, hexToBytes, rlpDecode, type RLPItem } from './rlp.ts';

const TX: Eip1559Tx = {
  chainId: 1337,
  nonce: 5,
  maxPriorityFeePerGas: 100_000_000n,
  maxFeePerGas: 1_000_000_000n,
  gasLimit: 21_000n,
  to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  value: 1_000_000_000_000_000_000n, // 1 ETH
  data: new Uint8Array(0),
};

describe('eip1559', () => {
  it('encodes the type byte 0x02 as the first byte of the signing payload', () => {
    const enc = encodeForSigning(TX);
    expect(enc[0]).toBe(0x02);
  });

  it('produces a 32-byte signing hash', () => {
    const h = signingHash(TX);
    expect(h.length).toBe(32);
  });

  it('round-trips: decoded RLP body matches input fields', () => {
    const enc = encodeForSigning(TX);
    // Strip type byte, decode the RLP body.
    const decoded = rlpDecode(enc.subarray(1)) as RLPItem[];
    expect(decoded).toHaveLength(9);
    // chainId is `numberToBytes(1337)` = 0x0539
    expect(bytesToHex(decoded[0] as Uint8Array)).toBe('0x0539');
    // nonce = 5
    expect(bytesToHex(decoded[1] as Uint8Array)).toBe('0x05');
    // gasLimit = 21000 = 0x5208
    expect(bytesToHex(decoded[4] as Uint8Array)).toBe('0x5208');
    // to address (lowercase, no 0x prefix in bytes)
    expect(bytesToHex(decoded[5] as Uint8Array)).toBe(
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
    // accessList is the empty list
    expect(decoded[8]).toEqual([]);
  });

  it('serialised tx prepends 0x02 and appends [yParity, r, s] to the body', () => {
    const sig: Eip1559Signature = {
      yParity: 1,
      r: hexToBytes('0x' + 'aa'.repeat(32)),
      s: hexToBytes('0x' + 'bb'.repeat(32)),
    };
    const wire = serializeSigned(TX, sig);
    expect(wire[0]).toBe(0x02);
    const decoded = rlpDecode(wire.subarray(1)) as RLPItem[];
    expect(decoded).toHaveLength(12);
    expect(bytesToHex(decoded[9] as Uint8Array)).toBe('0x01'); // yParity
    expect(bytesToHex(decoded[10] as Uint8Array)).toBe('0x' + 'aa'.repeat(32));
    expect(bytesToHex(decoded[11] as Uint8Array)).toBe('0x' + 'bb'.repeat(32));
  });

  it('splitSignature accepts both legacy v=27/28 and modern yParity=0/1', () => {
    const r = new Uint8Array(32).fill(0x11);
    const s = new Uint8Array(32).fill(0x22);
    const legacy = new Uint8Array(65);
    legacy.set(r, 0);
    legacy.set(s, 32);
    legacy[64] = 28;
    expect(splitSignature(legacy).yParity).toBe(1);

    const modern = new Uint8Array(65);
    modern.set(r, 0);
    modern.set(s, 32);
    modern[64] = 0;
    expect(splitSignature(modern).yParity).toBe(0);
  });

  it('rejects malformed signatures', () => {
    expect(() => splitSignature(new Uint8Array(64))).toThrow(/65-byte/);
    const bad = new Uint8Array(65);
    bad[64] = 99;
    expect(() => splitSignature(bad)).toThrow(/yParity/);
  });
});
