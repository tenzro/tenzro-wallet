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
 * `did:tenzro:human:` + lowercase hex of
 * `SHA-256("tenzro/human-did" || u32be(64) || x || y)`: the network's
 * derivation of a human identity from its passkey.
 */
export function humanDidFromPasskey(publicKey: Uint8Array): string {
  const xy = normalizeP256PublicKey(publicKey);
  return `did:tenzro:human:${toHex(sha256(concatBytes(utf8(HUMAN_DID_DOMAIN), u32be(xy.length), xy)))}`;
}

/** The account factory every passkey account's address is derived under. */
const FACTORY_ADDRESS = (() => {
  const a = new Uint8Array(20);
  a[18] = 0x04;
  return a;
})();

/**
 * The address of the passkey account whose first passkey is `credentialId`
 * with key `publicKey`, as wallet number `salt` of its identity: the first 20
 * bytes of `SHA-256(factory || SHA-256(key || credential id || DID) || salt_le)`.
 */
export function smartAccountAddress(
  publicKey: Uint8Array,
  credentialId: Uint8Array,
  salt: number,
): Uint8Array {
  const xy = normalizeP256PublicKey(publicKey);
  const owner = sha256(concatBytes(xy, credentialId, utf8(humanDidFromPasskey(xy))));
  const saltLe = new Uint8Array(8);
  new DataView(saltLe.buffer).setBigUint64(0, BigInt(salt), true);
  return sha256(concatBytes(FACTORY_ADDRESS, owner, saltLe)).slice(0, 20);
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
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
