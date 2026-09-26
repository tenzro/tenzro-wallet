/**
 * Byte helpers shared by the passkey custody module. Browser-clean: no Node
 * `Buffer`, no `crypto` module imports.
 */

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Lowercase hex, optionally `0x`-prefixed. */
export function toHex(bytes: Uint8Array, prefix = false): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return prefix ? `0x${s}` : s;
}

/** Parses hex with or without `0x`. Throws on odd length or non-hex input. */
export function fromHex(hex: string): Uint8Array {
  const s = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (s.length % 2 !== 0 || /[^0-9a-f]/i.test(s)) {
    throw new Error(`invalid hex string: ${hex.slice(0, 16)}`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Lowercase, `0x`-free form used to compare ids that may come back prefixed. */
export const normalizeHex = (hex: string): string =>
  (hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex).toLowerCase();

export function concatBytes(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export const asBytes = (v: ArrayBuffer | ArrayBufferView): Uint8Array =>
  v instanceof Uint8Array
    ? v
    : ArrayBuffer.isView(v)
      ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
      : new Uint8Array(v);

/** WebAuthn wants an ArrayBuffer-backed source; copy so views across realms are safe. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/** Byte arrays travel to the node as JSON number arrays (base64 is rejected). */
export const toNumberArray = (bytes: Uint8Array): number[] => Array.from(bytes);

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}
