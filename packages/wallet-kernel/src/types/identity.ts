/**
 * TDIP identity types — the root of all wallet identity.
 *
 * A user has exactly one root DID. Each surface (native, evm, svm, canton-internal,
 * canton-external) projects a derived key from the same MPC quorum.
 *
 * Spec refs:
 *  - https://tenzro.com/docs/identity (TDIP)
 *  - W3C DID 1.0 (DID Document compatibility)
 */

export type DidMethod = 'tenzro';

export type TdipKind = 'human' | 'controlled-machine' | 'autonomous-machine';

/**
 * A `did:tenzro:human:{uuid}` or `did:tenzro:machine:{controller?}:{uuid}`.
 * Stored as a normalized string; parsed via `parseTdipDid`.
 */
export type TdipDid = string & { readonly __brand: 'TdipDid' };

export interface TdipDidParts {
  readonly method: DidMethod;
  readonly kind: TdipKind;
  /** Controller DID, only present when kind === 'controlled-machine'. */
  readonly controller?: TdipDid;
  readonly uuid: string;
}

/**
 * Canton signing schemes accepted on `PartyToKeyMapping`. Mirrors the
 * `CantonSigningScheme` in `ports/canton/canton-validator.ts`; redeclared
 * here to avoid a port→type reverse import. See DESIGN.md §4.5.5.
 */
export type CantonKeyScheme = 'ed25519' | 'ec-dsa-p256';

/**
 * Canton party shape on a `SurfaceKey`. Both canton-internal and
 * canton-external use this — they differ only in `synchronizerId` and
 * which validator hosts the party. See DESIGN.md §4.5.4.
 *
 * Two-key model:
 *   - `namespaceKey` roots the identity (cold/recovery key, fingerprint =
 *     the `::xxxx` part of the party id, used for topology changes).
 *   - `signingKeys` are the warm/online keys (per-tx). The party id is
 *     immutable; signing keys can be rotated via topology updates.
 *   - `threshold` is the M-of-N over `signingKeys`. M-of-N requires
 *     `threshold <= signingKeys.length`.
 */
export interface CantonPartyKey {
  /** `<hint>::<32-byte-fingerprint-hex>` */
  readonly partyId: string;
  /** Synchronizer the party is hosted on. `global-domain::<fp>` for MainNet
   *  external, Tenzro-operated synchronizer id for internal. */
  readonly synchronizerId: string;
  /** Participant id hosting the party. */
  readonly hostingParticipantId: string;
  readonly namespaceKey: {
    readonly scheme: 'ed25519';
    readonly publicKey: Uint8Array;
    /** Canton fingerprint string: `1220` + lowercase-hex SHA-256 of `publicKey`.
     *  Matches the `::xxxx` portion of the party id when this is the namespace
     *  key. Computed at provision time so the signing path stays sync. */
    readonly fingerprint: string;
  };
  readonly signingKeys: ReadonlyArray<{
    readonly scheme: CantonKeyScheme;
    readonly publicKey: Uint8Array;
    /** Canton fingerprint string: `1220` + lowercase-hex SHA-256 of `publicKey`.
     *  Used as `signedBy` on the wire so the validator can look the key up
     *  in `PartyToKeyMapping` without us carrying the pubkey. */
    readonly fingerprint: string;
  }>;
  /** M of `signingKeys.length`. */
  readonly threshold: number;
}

/**
 * The set of cryptographic personas the wallet derives from one TDIP root.
 * Each entry's `kind` matches the surface that consumes it.
 */
export type SurfaceKey =
  | {
      readonly surface: 'tenzro-native';
      readonly scheme: 'ed25519';
      readonly publicKey: Uint8Array;
      /** Base58-encoded Tenzro address (per `Address` in tenzro-sdk types). */
      readonly address: string;
    }
  | { readonly surface: 'evm-on-tenzro'; readonly scheme: 'secp256k1'; readonly address: `0x${string}` }
  | {
      readonly surface: 'svm-on-tenzro';
      readonly scheme: 'ed25519';
      readonly publicKey: Uint8Array;
      /** Base58-encoded SVM public-key/address. */
      readonly address: string;
    }
  | ({ readonly surface: 'canton-internal' } & CantonPartyKey)
  | ({ readonly surface: 'canton-external' } & CantonPartyKey);

export interface TdipIdentity {
  readonly did: TdipDid;
  readonly parts: TdipDidParts;
  /** Surface keys derived from the MPC quorum. Indexed by surface name. */
  readonly keys: ReadonlyMap<SurfaceKey['surface'], SurfaceKey>;
  readonly createdAt: number;
}
