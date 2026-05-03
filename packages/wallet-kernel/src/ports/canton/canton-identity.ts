/**
 * CantonIdentityPort — narrow port for resolving DIDs to Canton party ids.
 *
 * Mirror of `TenzroIdentityPort` but for Canton parties. Like its tenzro-
 * native sibling, this port handles *other people's* DIDs only — the user's
 * own canton-internal/canton-external party ids come in synchronously through
 * the kernel constructor as `identity.keys`.
 *
 * Two distinct backing paths share the same port:
 *   - **canton-external**: lookup goes through the validator's Scan proxy
 *     (`/v0/scan-proxy/...`) and Canton Name Service (`name.cns` → party id).
 *     A DID maps to at most one party on the Global Synchronizer.
 *   - **canton-internal**: lookup goes through the Tenzro-operated
 *     synchronizer's directory (validator-app endpoint TBD until 2026-05-05).
 *     A DID maps to at most one party on the Tenzro synchronizer.
 *
 * The kernel asks for both in parallel because the two surfaces are routed
 * separately — a DID can have a canton-internal party, a canton-external
 * party, both, or neither. Returning `undefined` for the missing surface
 * is normal (vs. throwing — only RPC failures throw).
 *
 * Spec refs:
 *   - DESIGN.md §4.4 (canton-internal) + §4.5 (canton-external)
 *   - Splice Wallet Kernel `openrpc-dapp-remote-api.json` for the wire shape
 *     of party-resolution requests
 */

import type { TdipDid } from '../../types/identity.ts';

export interface TenzroSurfaceCantonParty {
  /** `<hint>::<32-byte-fingerprint-hex>` */
  readonly partyId: string;
  /** Synchronizer the party is hosted on. `global-domain::<fp>` for MainNet
   *  external, Tenzro-operated synchronizer id for internal. */
  readonly synchronizerId: string;
  /** Participant id hosting the party — used when constructing
   *  `PartyToParticipant` topology references and when filtering
   *  completions. */
  readonly hostingParticipantId: string;
}

export interface CantonIdentityPort {
  /**
   * Resolve a DID to its Canton party on the Global Synchronizer (the
   * canton-external surface). Returns `undefined` if the DID has no
   * external party registered.
   */
  resolveCantonExternalParty(
    did: TdipDid,
  ): Promise<TenzroSurfaceCantonParty | undefined>;

  /**
   * Resolve a DID to its Canton party on the Tenzro-operated synchronizer
   * (the canton-internal surface). Returns `undefined` if the DID has no
   * internal party registered.
   */
  resolveCantonInternalParty(
    did: TdipDid,
  ): Promise<TenzroSurfaceCantonParty | undefined>;

  /**
   * Reverse direction: Canton Name Service entry → party id. Used for
   * "send to alice.cns" UX flows on canton-external. Tenzro-internal CNS
   * (if any) is TBD — implementations may throw "not supported" for
   * the internal synchronizer until the namespace is published.
   */
  resolveCnsName(name: string): Promise<string | null>;
}
