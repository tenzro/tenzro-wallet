/**
 * SHA-256 wrapper around WebCrypto's `crypto.subtle.digest`. Available in
 * browsers, Node 16+, Cloudflare Workers, Deno, Bun — every modern JS
 * runtime. Avoids vendoring a pure-JS SHA-256 the way we vendored keccak —
 * SHA-256 is universally provided, keccak isn't.
 *
 * Used by the Canton adapter for `preparedTransactionHash` recomputation
 * (Canton hash purpose 11, SHA-256 over the proto bytes per
 * `HASHING_SCHEME_VERSION_V2`).
 */

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'sha256: globalThis.crypto.subtle unavailable. Tenzro wallet-kernel ' +
        'requires a WebCrypto-capable runtime (Node 16+, browsers, Workers).',
    );
  }
  const buf = await subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

/** Concatenate byte slices — small helper to avoid pulling in a util module. */
export function concatBytes(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
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
