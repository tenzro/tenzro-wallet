/**
 * TenzroIdentityPort — narrow port for resolving *other people's* DIDs.
 *
 * The kernel already knows the user's own surface keys synchronously (they
 * come in through the constructor as `identity.keys`). This port exists for
 * the *recipient* side: when a user sends to a DID that isn't their own,
 * the kernel needs to ask the network "what tenzro-native address does
 * `did:tenzro:human:...` map to?".
 *
 * Why a separate port (vs. folding into a single `identityPort` that also
 * serves the user's own keys): own-keys are cached locally and used on the
 * sign-time hot path. Conflating them with a remote lookup would force an
 * `await` on every signing operation. This port stays remote-only.
 *
 * Backed by `IdentityClient.resolveDidDocument` over JSON-RPC; see
 * `TenzroIdentityAdapter`.
 */

import type { TdipDid } from '../types/identity.ts';

export interface TenzroIdentityPort {
  /**
   * Resolve a DID to its tenzro-native base58 address.
   *
   * Returns `undefined` when the DID exists but has no tenzro-native key
   * (e.g., a Canton-only identity). Throws if the DID is unknown or the
   * RPC fails — callers should let those propagate.
   */
  resolveTenzroAddress(did: TdipDid): Promise<string | undefined>;
}
