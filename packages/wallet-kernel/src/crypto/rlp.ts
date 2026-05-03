/**
 * Minimal RLP encoder per Ethereum Yellow Paper appendix B.
 *
 * Why we have our own:
 *   - The kernel package has no `@types/node` and ships to browsers, so we
 *     can't pull in the canonical `rlp` / `ethereumjs-util` packages without
 *     dragging Node's Buffer into the dep tree.
 *   - Our use is narrow: encode an EIP-1559 typed-tx body. ~60 lines covers
 *     it; reaching for a 50KB dep would be silly.
 *
 * Decoder is included only to support round-trip tests — not exported from
 * the package root.
 *
 * Spec: https://ethereum.org/en/developers/docs/data-structures-and-encoding/rlp/
 */

export type RLPItem = Uint8Array | RLPItem[];

/** Encode a single RLP item (bytes or list of items) to its wire form. */
export function rlpEncode(item: RLPItem): Uint8Array {
  if (item instanceof Uint8Array) return encodeBytes(item);
  return encodeList(item);
}

function encodeBytes(b: Uint8Array): Uint8Array {
  if (b.length === 1 && b[0]! < 0x80) return b;
  if (b.length < 56) {
    const out = new Uint8Array(1 + b.length);
    out[0] = 0x80 + b.length;
    out.set(b, 1);
    return out;
  }
  const lenBytes = bigEndian(BigInt(b.length));
  const out = new Uint8Array(1 + lenBytes.length + b.length);
  out[0] = 0xb7 + lenBytes.length;
  out.set(lenBytes, 1);
  out.set(b, 1 + lenBytes.length);
  return out;
}

function encodeList(items: readonly RLPItem[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let payloadLen = 0;
  for (const it of items) {
    const enc = rlpEncode(it);
    parts.push(enc);
    payloadLen += enc.length;
  }
  const payload = concat(parts);
  if (payloadLen < 56) {
    const out = new Uint8Array(1 + payloadLen);
    out[0] = 0xc0 + payloadLen;
    out.set(payload, 1);
    return out;
  }
  const lenBytes = bigEndian(BigInt(payloadLen));
  const out = new Uint8Array(1 + lenBytes.length + payloadLen);
  out[0] = 0xf7 + lenBytes.length;
  out.set(lenBytes, 1);
  out.set(payload, 1 + lenBytes.length);
  return out;
}

/**
 * Convert a non-negative bigint to its minimal big-endian byte form.
 * 0n encodes as the empty byte string per RLP convention (NOT 0x00).
 */
export function bigintToBytes(n: bigint): Uint8Array {
  if (n < 0n) throw new Error('rlp: negative integers are not encodable');
  if (n === 0n) return new Uint8Array(0);
  return bigEndian(n);
}

/** Convert a non-negative number to RLP-minimal big-endian bytes. */
export function numberToBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('rlp: only non-negative integers are encodable');
  }
  return bigintToBytes(BigInt(n));
}

/** Hex string `0x…` (even-length; odd-length nibbles are zero-padded). */
export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const norm = h.length % 2 === 0 ? h : '0' + h;
  const out = new Uint8Array(norm.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(norm.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '0x';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}

function bigEndian(n: bigint): Uint8Array {
  const hex = n.toString(16);
  return hexToBytes(hex.length % 2 === 0 ? hex : '0' + hex);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// --- decoder (round-trip tests only) ---

export function rlpDecode(input: Uint8Array): RLPItem {
  const { item, consumed } = decodeOne(input, 0);
  if (consumed !== input.length) throw new Error('rlp: trailing bytes');
  return item;
}

function decodeOne(buf: Uint8Array, off: number): { item: RLPItem; consumed: number } {
  const first = buf[off];
  if (first === undefined) throw new Error('rlp: unexpected EOF');

  if (first < 0x80) {
    return { item: buf.subarray(off, off + 1), consumed: 1 };
  }
  if (first < 0xb8) {
    const len = first - 0x80;
    return { item: buf.subarray(off + 1, off + 1 + len), consumed: 1 + len };
  }
  if (first < 0xc0) {
    const lenLen = first - 0xb7;
    const len = readLen(buf, off + 1, lenLen);
    return { item: buf.subarray(off + 1 + lenLen, off + 1 + lenLen + len), consumed: 1 + lenLen + len };
  }
  if (first < 0xf8) {
    const len = first - 0xc0;
    return decodeList(buf, off + 1, len, 1 + len);
  }
  const lenLen = first - 0xf7;
  const len = readLen(buf, off + 1, lenLen);
  return decodeList(buf, off + 1 + lenLen, len, 1 + lenLen + len);
}

function decodeList(
  buf: Uint8Array,
  start: number,
  payloadLen: number,
  totalConsumed: number,
): { item: RLPItem; consumed: number } {
  const items: RLPItem[] = [];
  let cursor = start;
  const end = start + payloadLen;
  while (cursor < end) {
    const { item, consumed } = decodeOne(buf, cursor);
    items.push(item);
    cursor += consumed;
  }
  return { item: items, consumed: totalConsumed };
}

function readLen(buf: Uint8Array, off: number, lenLen: number): number {
  let n = 0;
  for (let i = 0; i < lenLen; i++) {
    const b = buf[off + i];
    if (b === undefined) throw new Error('rlp: short length');
    n = n * 256 + b;
  }
  return n;
}
