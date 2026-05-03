/**
 * FrostCoordinator — wallet-side view of the FROST round-coordination
 * protocol the node hosts at `/wallet/frost/*`. Specified in DESIGN.md
 * §4.3.4 + §11. Wraps two parallel curves:
 *
 *   - FROST-Ed25519 (RFC 9591)         → driver id `frost-ed25519`
 *   - FROST-secp256k1 (taproot-ready)  → driver id `frost-secp256k1`
 *
 * Both curves use the same 3-round flow. The wallet device holds one
 * secret share (passkey-bound, unwrapped per signing). The node-TEE
 * holds the second share. A 2-of-2 quorum signs; for 2-of-3 (post-
 * pairing) any two of {device A, device B, node-TEE} can co-sign.
 *
 * Tenzro endpoints (Tenzro implements; wallet kernel only consumes):
 *
 *   1. `start({did, scheme, preimage, surfaceKey, purpose?})`
 *      → `POST /wallet/frost/{scheme}/start`
 *      Response: `{sessionId, expiresAt, participants[]}` where
 *      `participants` is the list of co-signer identifiers (passkey
 *      cred-ids + `node-tee`) the node will round-coordinate against.
 *
 *   2. `commit({sessionId, deviceCommitment})`
 *      → `POST /wallet/frost/{scheme}/commit`
 *      Round 1: device submits its hiding/binding commitments
 *      (`(D_i, E_i)` per RFC 9591 §4.1). Response: `{state}`. The node
 *      blocks the response until enough commitments are in or
 *      `state === 'aborted'`.
 *
 *   3. `awaitChallenge({sessionId})`
 *      → `POST /wallet/frost/{scheme}/await-challenge`
 *      Round 2: device long-polls for the aggregated commitment +
 *      Lagrange-coefficient bundle the node assembled from all
 *      participants. Response: `{groupCommitment, signerSet, lambda}`.
 *
 *   4. `respond({sessionId, deviceShare})`
 *      → `POST /wallet/frost/{scheme}/respond`
 *      Round 3: device submits its signature share `z_i`. Response:
 *      `{state}`. Successful responses commit the share into the round.
 *
 *   5. `finalize({sessionId})`
 *      → `POST /wallet/frost/{scheme}/finalize`
 *      Device polls for the aggregated signature. Response:
 *      `{signature}`. Once aggregated, the round is destroyed and
 *      cannot be replayed.
 *
 *   6. `abort({sessionId, reason?})`
 *      → `POST /wallet/frost/{scheme}/abort`
 *      Idempotent. Used when the user cancels mid-round.
 *
 * The port is intentionally agnostic about how device shares are
 * unwrapped — that's the passkey-quorum custody layer. The coordinator
 * only carries opaque commitment / share bytes that the device-side
 * FROST library produced.
 *
 * Browser-clean: `fetch` only. No Node-specific globals.
 */

export type FrostScheme = 'ed25519' | 'secp256k1';

export type FrostSessionState =
  | 'pending'        // round started, waiting for commitments
  | 'committed'      // all commitments in, challenge ready
  | 'responded'      // device submitted z_i, waiting for aggregation
  | 'finalized'      // signature aggregated and returned
  | 'aborted'
  | 'expired';

/**
 * Identifier of a single FROST participant. The node maps these to
 * passkey credential ids / `node-tee`. The device only needs them to
 * verify the `signerSet` returned in round 2 includes itself.
 */
export type FrostParticipantId = string;

export interface FrostStartRequest {
  /** TDIP DID whose surface key is being signed for. */
  readonly did: string;
  /** Stable id of the surface key (matches `SurfaceKey.keyId`). */
  readonly surfaceKey: string;
  readonly scheme: FrostScheme;
  /** Canonical preimage bytes — surface module canonicalised. */
  readonly preimage: Uint8Array;
  /** Optional context tag for the audit log. */
  readonly purpose?: string;
}

export interface FrostStartResult {
  readonly sessionId: string;
  /** Unix-ms timestamp when this session is dropped. */
  readonly expiresAt: number;
  /** Set of co-signers the node will coordinate. Includes this device. */
  readonly participants: readonly FrostParticipantId[];
}

export interface FrostCommitRequest {
  readonly sessionId: string;
  /** RFC 9591 commitment bundle `(D_i, E_i)` produced device-side,
   *  serialized as opaque bytes. The node only forwards/aggregates. */
  readonly deviceCommitment: Uint8Array;
}

export interface FrostCommitResult {
  readonly sessionId: string;
  readonly state: FrostSessionState;
}

export interface FrostChallenge {
  readonly sessionId: string;
  readonly state: FrostSessionState;
  /** Aggregated group commitment `R = Σ D_i + ρ_i·E_i`, opaque bytes. */
  readonly groupCommitment: Uint8Array;
  /** Final signer set chosen for this round (subset of `participants`). */
  readonly signerSet: readonly FrostParticipantId[];
  /** Lagrange coefficient λ_i for *this device*, encoded as scalar bytes
   *  (curve-dependent: 32 bytes for Ed25519, 32 bytes for secp256k1). */
  readonly lambda: Uint8Array;
}

export interface FrostRespondRequest {
  readonly sessionId: string;
  /** Device's signature share `z_i`, opaque bytes. */
  readonly deviceShare: Uint8Array;
}

export interface FrostRespondResult {
  readonly sessionId: string;
  readonly state: FrostSessionState;
}

export interface FrostFinalizeResult {
  readonly sessionId: string;
  readonly state: FrostSessionState;
  /** Aggregated signature, wire-format. 64 bytes for Ed25519, 64-65 for
   *  secp256k1 (sans recovery byte; surface module appends `v` if
   *  needed by recomputing it). Set when `state === 'finalized'`. */
  readonly signature?: Uint8Array;
}

export interface FrostCoordinator {
  start(req: FrostStartRequest): Promise<FrostStartResult>;
  commit(req: FrostCommitRequest): Promise<FrostCommitResult>;
  awaitChallenge(sessionId: string): Promise<FrostChallenge>;
  respond(req: FrostRespondRequest): Promise<FrostRespondResult>;
  finalize(sessionId: string): Promise<FrostFinalizeResult>;
  abort(sessionId: string, reason?: string): Promise<void>;
}

/**
 * Device-side share-holder. Produced by the passkey-unwrap layer; the
 * FROST drivers don't care how the share was obtained, only that the
 * holder can produce a commitment and a response on demand.
 */
export interface FrostDeviceShareHolder {
  readonly scheme: FrostScheme;
  /** Round 1 — produce `(D_i, E_i)` commitment bytes. */
  commit(): Promise<Uint8Array>;
  /** Round 3 — produce `z_i` from the round-2 challenge bundle. */
  respond(args: {
    readonly preimage: Uint8Array;
    readonly groupCommitment: Uint8Array;
    readonly signerSet: readonly FrostParticipantId[];
    readonly lambda: Uint8Array;
  }): Promise<Uint8Array>;
  /** Best-effort wipe of any in-memory secret material. */
  dispose?(): void;
}
