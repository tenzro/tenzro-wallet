import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';

import { concatBytes, toHex, utf8 } from './bytes.ts';
import {
  humanDidFromPasskey,
  normalizeP256PublicKey,
  recoverAssertionPublicKeys,
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
    expect(a).toMatch(
      /^did:tenzro:human:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
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
