/**
 * TenzroIdentityAdapter — wraps the SDK's `IdentityClient.resolveDidDocument`
 * and exposes the narrow `TenzroIdentityPort` the kernel uses.
 *
 * Mapping `DidDocument` → tenzro-native address:
 *   - Find the verification method whose key is tagged for the tenzro-native
 *     surface. The DID Document carries a list of `verificationMethod`
 *     entries; the one we want has a controller key suitable for native
 *     signing (Ed25519, the canonical scheme for tenzro-native per
 *     `SurfaceKey`).
 *   - Decode `publicKeyMultibase` (multibase prefix `z` → base58btc) to raw
 *     public-key bytes.
 *   - Base58-encode those bytes — that *is* the Tenzro address (per the
 *     SDK's `Address = Base58-encoded` convention).
 *
 * What's NOT here: per-surface address resolution for EVM/SVM/Canton.
 * The current kernel only needs tenzro-native recipient resolution because
 * that's the only surface that accepts TDIP recipients today; EVM/SVM
 * recipients arrive as raw addresses, Canton as raw partyId. Extending
 * to full surface-aware resolution lands when M4 adds Canton-via-DID.
 */

import { base58Decode, base58Encode } from '../../crypto/solana.ts';
import type { TdipDid } from '../../types/identity.ts';
import type { TenzroIdentityPort } from '../tenzro-identity.ts';

/**
 * The slice of `IdentityClient` the adapter touches. Listed explicitly so
 * tests can inject a hand-rolled object. Mirrors the pattern used by
 * `TenzroSdkAdapter` / `TenzroClientLike`.
 */
export interface IdentityClientLike {
  resolveDidDocument(did: string): Promise<{
    verificationMethod: ReadonlyArray<{
      id: string;
      type: string;
      controller: string;
      publicKeyMultibase?: string;
    }>;
  }>;
}

export class TenzroIdentityAdapter implements TenzroIdentityPort {
  constructor(private readonly client: IdentityClientLike) {}

  async resolveTenzroAddress(did: TdipDid): Promise<string | undefined> {
    const doc = await this.client.resolveDidDocument(did);
    // Pick the first Ed25519 verification method — that's the tenzro-native
    // signing key. The W3C type tag for Ed25519 is `Ed25519VerificationKey2020`
    // (or the older `Ed25519VerificationKey2018`); accept both since the
    // node-side serialization isn't pinned in the SDK.
    const vm = doc.verificationMethod.find(
      (m) =>
        m.type === 'Ed25519VerificationKey2020' ||
        m.type === 'Ed25519VerificationKey2018',
    );
    if (!vm || !vm.publicKeyMultibase) return undefined;
    const pubkey = decodeMultibase(vm.publicKeyMultibase);
    return base58Encode(pubkey);
  }
}

/**
 * Decode a multibase string to raw bytes. Multibase prefixes the encoded
 * string with a single character identifying the base; `z` is base58btc,
 * which is what Tenzro / W3C DID v1 use for Ed25519 keys.
 *
 * Spec: https://github.com/multiformats/multibase
 */
function decodeMultibase(s: string): Uint8Array {
  if (s.length === 0) throw new Error('multibase: empty input');
  const prefix = s[0];
  const body = s.slice(1);
  switch (prefix) {
    case 'z':
      return base58Decode(body);
    default:
      throw new Error(`multibase: unsupported prefix '${prefix}' (expected 'z')`);
  }
}
