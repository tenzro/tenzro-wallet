import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';

import { concatBytes, toHex, utf8 } from './bytes.ts';
import { ML_DSA_65_PUBLIC_KEY_BYTES, ML_DSA_65_SIGNATURE_BYTES } from './constants.ts';
import {
  custodyPrfSalt,
  deriveCustodyKey,
  humanDidFromPasskey,
  normalizeP256PublicKey,
  recoverAssertionPublicKeys,
  signCustodyDigest,
  verifyCustodySignature,
} from './derive.ts';

describe('humanDidFromPasskey', () => {
  it('matches the network derivation (SHA-256("tenzro/human-did" || x || y), UUIDv8)', () => {
    // Independent vector: python3 hashlib over the same preimage, version and
    // variant bits as crates/tenzro-identity/src/did.rs human_id_from_passkey.
    expect(humanDidFromPasskey(new Uint8Array(64).fill(0x11))).toBe(
      'did:tenzro:human:a828941c-fe91-8250-af8b-a16527305188',
    );
  });

  it('is deterministic per key and separates keys', () => {
    const a = humanDidFromPasskey(new Uint8Array(64).fill(0xa1));
    expect(humanDidFromPasskey(new Uint8Array(64).fill(0xa1))).toBe(a);
    expect(humanDidFromPasskey(new Uint8Array(64).fill(0x22))).not.toBe(a);
    expect(a).toMatch(/^did:tenzro:human:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('accepts SEC1 and SPKI encodings of the same key', () => {
    const xy = new Uint8Array(64).fill(0x33);
    const sec1 = concatBytes(new Uint8Array([0x04]), xy);
    const spki = concatBytes(new Uint8Array(26), sec1);
    expect(humanDidFromPasskey(sec1)).toBe(humanDidFromPasskey(xy));
    expect(humanDidFromPasskey(spki)).toBe(humanDidFromPasskey(xy));
    expect(() => normalizeP256PublicKey(new Uint8Array(33))).toThrow();
  });
});

describe('deriveCustodyKey (passkey PRF -> ML-DSA-65)', () => {
  it('uses the canonical PRF salt', () => {
    expect(toHex(custodyPrfSalt())).toBe(
      'd522604ac7c348d837598a69872931523548d62e8d9b6db71c532b982cbac062',
    );
  });

  it('is deterministic in the PRF output', () => {
    const prf = sha256(utf8('prf-output-1'));
    const a = deriveCustodyKey(prf);
    const b = deriveCustodyKey(new Uint8Array(prf));
    expect(toHex(a.publicKey)).toBe(toHex(b.publicKey));
    expect(a.publicKey).toHaveLength(ML_DSA_65_PUBLIC_KEY_BYTES);
    const c = deriveCustodyKey(sha256(utf8('prf-output-2')));
    expect(toHex(c.publicKey)).not.toBe(toHex(a.publicKey));
  });

  it('signs a 32-byte digest that verifies against the derived key', () => {
    const { publicKey, secretKey } = deriveCustodyKey(sha256(utf8('prf')));
    const digest = sha256(utf8('digest'));
    const sig = signCustodyDigest(digest, secretKey);
    expect(sig).toHaveLength(ML_DSA_65_SIGNATURE_BYTES);
    expect(verifyCustodySignature(digest, sig, publicKey)).toBe(true);
    expect(verifyCustodySignature(sha256(utf8('other')), sig, publicKey)).toBe(false);
  });

  it('refuses a short PRF output', () => {
    expect(() => deriveCustodyKey(new Uint8Array(16))).toThrow(/PRF/);
  });
});

describe('recoverAssertionPublicKeys', () => {
  it('recovers the signing key from a DER assertion signature', () => {
    const sk = p256.utils.randomSecretKey();
    const xy = p256.getPublicKey(sk, false).slice(1);
    const authData = new Uint8Array(37).fill(5);
    const clientData = utf8('{"type":"webauthn.get"}');
    const sig = p256.sign(concatBytes(authData, sha256(clientData)), sk, { format: 'der' });
    const candidates = recoverAssertionPublicKeys(authData, clientData, sig).map((k) => toHex(k));
    expect(candidates).toContain(toHex(xy));
  });
});
