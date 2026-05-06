/**
 * Minimal Solana wire-format primitives.
 *
 * What's here, and why:
 *   - **compact-array length encoding** ("short_vec"): base-128 varint with
 *     high-bit continuation. Used for the count prefix on Solana arrays
 *     (signatures, account keys, instructions, instruction data, etc.).
 *   - **base58** (Bitcoin alphabet): Solana pubkeys, addresses, and tx
 *     signatures all serialise as base58. We need both directions because
 *     `SurfaceKey.address` for the SVM surface stores the base58 form.
 *   - **legacy compiled-message** + **transaction** serialisation: the byte
 *     layout `solana-validator` accepts on `sendTransaction`.
 *
 * Why not @solana/web3.js: it pulls in Buffer + Node crypto polyfills, and
 * we need a pure-JS, browser-clean kernel package. The slice we use here is
 * a few hundred lines; vendoring is cheaper than the dep tree.
 *
 * Scope deliberately narrow: legacy message (not Message-v0 with address
 * lookup tables — that's an M5+ optimisation when we have a working
 * pointer flow first). The Tenzro precompile's SVM-side trigger is a single
 * system-program-style instruction, which legacy messages handle fine.
 *
 * Refs:
 *   - https://docs.solana.com/developing/programming-model/transactions
 *   - https://docs.solana.com/developing/clients/jsonrpc-api#sendtransaction
 *   - https://github.com/solana-labs/solana/blob/master/sdk/program/src/short_vec.rs
 */

// ──────────────────────────── compact-array ────────────────────────────

/**
 * Encode an unsigned integer as Solana short_vec (1–3 bytes for values up to
 * 2^21 - 1, sufficient for any tx field count).
 */
export function compactArrayLength(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`compact-array length must be a non-negative integer, got ${n}`);
  }
  const bytes: number[] = [];
  let v = n;
  while (true) {
    let b = v & 0x7f;
    v >>>= 7;
    if (v === 0) {
      bytes.push(b);
      break;
    }
    b |= 0x80;
    bytes.push(b);
  }
  return new Uint8Array(bytes);
}

/** Decode a short_vec length from `buf` starting at `off`. */
export function readCompactArrayLength(
  buf: Uint8Array,
  off: number,
): { value: number; consumed: number } {
  let value = 0;
  let consumed = 0;
  for (let shift = 0; ; shift += 7) {
    const b = buf[off + consumed];
    if (b === undefined) throw new Error('short_vec: short read');
    consumed += 1;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    if (consumed > 3) throw new Error('short_vec: overlong');
  }
  return { value, consumed };
}

// ─────────────────────────────── base58 ───────────────────────────────

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_INDEX: number[] = (() => {
  const idx = new Array<number>(128).fill(-1);
  for (let i = 0; i < B58_ALPHABET.length; i++) {
    idx[B58_ALPHABET.charCodeAt(i)] = i;
  }
  return idx;
})();

/**
 * Encode bytes to base58. Leading zeros become leading '1's per the Bitcoin
 * convention used by Solana.
 */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  // Count leading zeros.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Convert big-endian bytes to a base-58 array.
  const size = ((bytes.length - zeros) * 138) / 100 + 1; // log(256)/log(58) ≈ 1.366
  const b58 = new Uint8Array(Math.ceil(size));
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    let j = 0;
    for (let k = b58.length - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * b58[k]!;
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  // Skip leading zeros in the result.
  let it = b58.length - length;
  while (it < b58.length && b58[it] === 0) it++;
  let out = '1'.repeat(zeros);
  for (; it < b58.length; it++) out += B58_ALPHABET[b58[it]!];
  return out;
}

/** Decode a base58 string to bytes. */
export function base58Decode(s: string): Uint8Array {
  if (s.length === 0) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const size = ((s.length - zeros) * 733) / 1000 + 1; // log(58)/log(256) ≈ 0.733
  const b256 = new Uint8Array(Math.ceil(size));
  let length = 0;
  for (let i = zeros; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const digit = code < 128 ? (B58_INDEX[code] ?? -1) : -1;
    if (digit < 0) throw new Error(`base58: invalid character at ${i}`);
    let carry = digit;
    let j = 0;
    for (let k = b256.length - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 58 * b256[k]!;
      b256[k] = carry & 0xff;
      carry >>>= 8;
    }
    length = j;
  }
  let it = b256.length - length;
  while (it < b256.length && b256[it] === 0) it++;
  const out = new Uint8Array(zeros + (b256.length - it));
  // leading zeros stay zero (Uint8Array is zero-init), copy the tail
  let dst = zeros;
  for (; it < b256.length; it++, dst++) out[dst] = b256[it]!;
  return out;
}

// ─────────────────────── compiled-message + tx ───────────────────────

export interface CompiledInstruction {
  /** Index into accountKeys identifying the program to invoke. */
  readonly programIdIndex: number;
  /** Indices into accountKeys identifying the accounts the instruction touches. */
  readonly accountKeyIndices: readonly number[];
  /** Instruction data bytes (program-specific). */
  readonly data: Uint8Array;
}

export interface CompiledMessage {
  readonly numRequiredSignatures: number;
  readonly numReadonlySignedAccounts: number;
  readonly numReadonlyUnsignedAccounts: number;
  /** 32-byte pubkeys, signers first then read-only signers, then writable
   *  non-signers, then read-only non-signers — as produced by the Solana
   *  message compiler. */
  readonly accountKeys: readonly Uint8Array[];
  readonly recentBlockhash: Uint8Array;
  readonly instructions: readonly CompiledInstruction[];
}

/**
 * Serialise a CompiledMessage to its on-the-wire bytes (legacy format).
 *
 * Layout:
 *   header (3 bytes)
 *   compact-array(account-keys, each 32 bytes)
 *   recent_blockhash (32 bytes)
 *   compact-array(instructions)
 *     each instruction:
 *       u8 program_id_index
 *       compact-array(account_indices, u8 each)
 *       compact-array(data, u8 each)
 */
export function serializeCompiledMessage(msg: CompiledMessage): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(
    new Uint8Array([
      msg.numRequiredSignatures,
      msg.numReadonlySignedAccounts,
      msg.numReadonlyUnsignedAccounts,
    ]),
  );

  parts.push(compactArrayLength(msg.accountKeys.length));
  for (const k of msg.accountKeys) {
    if (k.length !== 32) throw new Error(`account key must be 32 bytes, got ${k.length}`);
    parts.push(k);
  }

  if (msg.recentBlockhash.length !== 32) {
    throw new Error('recent_blockhash must be 32 bytes');
  }
  parts.push(msg.recentBlockhash);

  parts.push(compactArrayLength(msg.instructions.length));
  for (const ix of msg.instructions) {
    parts.push(new Uint8Array([ix.programIdIndex]));
    parts.push(compactArrayLength(ix.accountKeyIndices.length));
    parts.push(new Uint8Array(ix.accountKeyIndices));
    parts.push(compactArrayLength(ix.data.length));
    parts.push(ix.data);
  }

  return concat(parts);
}

/**
 * Build the wire-format signed transaction:
 *   compact-array(signatures, each 64 bytes) || message_bytes
 *
 * Signature count must equal `message.numRequiredSignatures`. Solana clients
 * reject mismatches.
 */
export function serializeTransaction(
  message: CompiledMessage,
  signatures: readonly Uint8Array[],
): Uint8Array {
  if (signatures.length !== message.numRequiredSignatures) {
    throw new Error(
      `expected ${message.numRequiredSignatures} signatures, got ${signatures.length}`,
    );
  }
  const messageBytes = serializeCompiledMessage(message);
  const parts: Uint8Array[] = [compactArrayLength(signatures.length)];
  for (const s of signatures) {
    if (s.length !== 64) throw new Error(`Ed25519 sig must be 64 bytes, got ${s.length}`);
    parts.push(s);
  }
  parts.push(messageBytes);
  return concat(parts);
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
