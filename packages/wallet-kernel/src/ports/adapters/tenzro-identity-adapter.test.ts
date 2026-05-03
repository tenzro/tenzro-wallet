/**
 * Adapter contract: take a `DidDocument` shape from the SDK, return the
 * tenzro-native base58 address. Pins the verification-method selection
 * (Ed25519 only) and the multibase decode path (`z` prefix → base58btc).
 */

import { describe, expect, it } from 'vitest';
import { base58Encode } from '../../crypto/solana.ts';
import type { TdipDid } from '../../types/identity.ts';
import {
  TenzroIdentityAdapter,
  type IdentityClientLike,
} from './tenzro-identity-adapter.ts';

const DID = 'did:tenzro:human:adapter-test' as TdipDid;

function fakeClient(
  doc: Awaited<ReturnType<IdentityClientLike['resolveDidDocument']>>,
): IdentityClientLike {
  return {
    resolveDidDocument: async () => doc,
  };
}

describe('TenzroIdentityAdapter', () => {
  it('extracts the Ed25519 verification method and returns its base58 address', async () => {
    const pubkey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) pubkey[i] = (i * 7 + 3) & 0xff;
    const expectedAddress = base58Encode(pubkey);
    const multibase = 'z' + base58Encode(pubkey);

    const adapter = new TenzroIdentityAdapter(
      fakeClient({
        verificationMethod: [
          {
            id: `${DID}#key-1`,
            type: 'Ed25519VerificationKey2020',
            controller: DID,
            publicKeyMultibase: multibase,
          },
        ],
      }),
    );

    expect(await adapter.resolveTenzroAddress(DID)).toBe(expectedAddress);
  });

  it('also accepts the older Ed25519VerificationKey2018 type tag', async () => {
    const pubkey = new Uint8Array(32).fill(0x11);
    const adapter = new TenzroIdentityAdapter(
      fakeClient({
        verificationMethod: [
          {
            id: `${DID}#key-1`,
            type: 'Ed25519VerificationKey2018',
            controller: DID,
            publicKeyMultibase: 'z' + base58Encode(pubkey),
          },
        ],
      }),
    );

    expect(await adapter.resolveTenzroAddress(DID)).toBe(base58Encode(pubkey));
  });

  it('returns undefined when the DID has no Ed25519 verification method', async () => {
    const adapter = new TenzroIdentityAdapter(
      fakeClient({
        verificationMethod: [
          {
            id: `${DID}#key-1`,
            type: 'EcdsaSecp256k1VerificationKey2019',
            controller: DID,
            publicKeyMultibase: 'z' + base58Encode(new Uint8Array(33)),
          },
        ],
      }),
    );

    expect(await adapter.resolveTenzroAddress(DID)).toBeUndefined();
  });

  it('returns undefined when the verification method has no publicKeyMultibase', async () => {
    const adapter = new TenzroIdentityAdapter(
      fakeClient({
        verificationMethod: [
          {
            id: `${DID}#key-1`,
            type: 'Ed25519VerificationKey2020',
            controller: DID,
          },
        ],
      }),
    );

    expect(await adapter.resolveTenzroAddress(DID)).toBeUndefined();
  });

  it('rejects unsupported multibase prefixes', async () => {
    const adapter = new TenzroIdentityAdapter(
      fakeClient({
        verificationMethod: [
          {
            id: `${DID}#key-1`,
            type: 'Ed25519VerificationKey2020',
            controller: DID,
            // 'm' is base64 in the multibase table — not supported here.
            publicKeyMultibase: 'mAAAA',
          },
        ],
      }),
    );

    await expect(adapter.resolveTenzroAddress(DID)).rejects.toThrow(
      /unsupported prefix/,
    );
  });
});
