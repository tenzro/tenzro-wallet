import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';

import { concatBytes, toHex, utf8 } from './bytes.ts';
import {
  humanDidFromPasskey,
  normalizeP256PublicKey,
  recoverAssertionPublicKeys,
  smartAccountAddress,
} from './derive.ts';

describe('humanDidFromPasskey', () => {
  it('matches the network derivation (the shared vector in the node repository)', () => {
    expect(humanDidFromPasskey(new Uint8Array(64).fill(0x11))).toBe(
      'did:tenzro:human:f7ee7b699f1ecc0948fc09b1f084f3b1740e645c242e245442f6b8899f0d8360',
    );
  });

  it('is deterministic per key and separates keys', () => {
    const a = humanDidFromPasskey(new Uint8Array(64).fill(0xa1));
    expect(humanDidFromPasskey(new Uint8Array(64).fill(0xa1))).toBe(a);
    expect(humanDidFromPasskey(new Uint8Array(64).fill(0x22))).not.toBe(a);
    expect(a).toMatch(/^did:tenzro:human:[0-9a-f]{64}$/);
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

describe('smartAccountAddress', () => {
  it('matches the network derivation for each wallet of an identity', () => {
    const key = new Uint8Array(64).fill(0x11);
    const credential = new Uint8Array(16).fill(0x22);
    expect(toHex(smartAccountAddress(key, credential, 0))).toBe(
      '584cea8771076642829ddfab5ef731a3c3df9a92',
    );
    expect(toHex(smartAccountAddress(key, credential, 1))).toBe(
      '3727a36a5d0491d76eb580c9c6307e6d65764f19',
    );
  });
});
