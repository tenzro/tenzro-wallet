/**
 * Identity derivation for passkey custody. Pure functions.
 *
 * The human DID is a one-way function of the passkey's P-256 public key, so
 * the same passkey always yields the same identity. No other key is derived
 * from a passkey: the passkey itself is the only signing key.
 */

import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, toHex, utf8 } from './bytes.ts';
import { HUMAN_DID_DOMAIN, P256_PUBLIC_KEY_BYTES } from './constants.ts';

/**
 * Normalises a P-256 public key to raw `x || y` (64 bytes). Accepts raw,
 * SEC1 uncompressed (`0x04 || x || y`) and DER SPKI (what
 * `AuthenticatorAttestationResponse.getPublicKey()` returns).
 */
export function normalizeP256PublicKey(key: Uint8Array): Uint8Array {
  if (key.length === P256_PUBLIC_KEY_BYTES) return key;
  if (key.length === 65 && key[0] === 0x04) return key.slice(1);
  // SPKI for P-256 is 91 bytes and ends with the uncompressed point.
  if (key.length > 65 && key[key.length - 65] === 0x04) return key.slice(-64);
  throw new Error(`unsupported P-256 public key encoding (${key.length} bytes)`);
}

/**
 * `did:tenzro:human:` + UUIDv8 of `SHA-256("tenzro/human-did" || x || y)[0..16]`,
 * version bits `(b6 & 0x0f) | 0x80`, variant bits `(b8 & 0x3f) | 0x80`.
 */
export function humanDidFromPasskey(publicKey: Uint8Array): string {
  const xy = normalizeP256PublicKey(publicKey);
  const h = sha256(concatBytes(utf8(HUMAN_DID_DOMAIN), xy)).slice(0, 16);
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x80;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const s = toHex(h);
  return `did:tenzro:human:${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/**
 * Recovers the candidate P-256 public keys (`x || y`) that could have produced
 * a WebAuthn assertion signature. Used to find the account behind a
 * discoverable passkey on a device that has no local record: each candidate's
 * DID is resolved on the node, and the one that resolves is the account.
 */
export function recoverAssertionPublicKeys(
  authenticatorData: Uint8Array,
  clientDataJson: Uint8Array,
  signature: Uint8Array,
): Uint8Array[] {
  const msgHash = sha256(concatBytes(authenticatorData, sha256(clientDataJson)));
  const format = signature.length === 64 ? 'compact' : 'der';
  const out: Uint8Array[] = [];
  for (const bit of [0, 1]) {
    try {
      const point = p256.Signature.fromBytes(signature, format)
        .addRecoveryBit(bit)
        .recoverPublicKey(msgHash);
      out.push(point.toBytes(false).slice(1));
    } catch {
      // Not every recovery id yields a valid point.
    }
  }
  return out;
}
