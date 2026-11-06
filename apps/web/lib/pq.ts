/**
 * The post-quantum leg. The network requires every passkey to be enrolled
 * with an ML-DSA-65 key, and an account's signatures carry that leg beside
 * the passkey's WebAuthn assertion. A browser has no ML-DSA hardware, so the
 * wallet derives the key from the passkey itself: the authenticator's PRF
 * extension (hmac-secret) answers a fixed salt with a secret only that
 * credential can produce, and the ML-DSA-65 seed is derived from it. Nothing
 * is stored: every device holding the passkey (a synced passkey included)
 * derives the same key, and a passkey that cannot answer the PRF cannot
 * make an account here.
 */

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

const PRF_SALT = new TextEncoder().encode('tenzro-wallet/ml-dsa-65/v1');
const SEED_INFO = new TextEncoder().encode('tenzro-wallet ml-dsa-65 seed');

/** The PRF input every passkey of this wallet is asked to evaluate. */
export function prfSalt(): Uint8Array {
  return PRF_SALT;
}

export interface PqKey {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

/** The ML-DSA-65 key a passkey's PRF output derives (HKDF-SHA-256 to a 32-byte seed). */
export async function pqKeyFromPrf(prf: Uint8Array): Promise<PqKey> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', prf as BufferSource, 'HKDF', false, ['deriveBits']);
  const seed = new Uint8Array(
    await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: SEED_INFO },
      base,
      256,
    ),
  );
  return ml_dsa65.keygen(seed);
}

/** ML-DSA-65 over `message` with the FIPS 204 context string `context`. */
export function pqSign(key: PqKey, message: Uint8Array, context: Uint8Array): Uint8Array {
  return ml_dsa65.sign(message, key.secretKey, { context });
}
