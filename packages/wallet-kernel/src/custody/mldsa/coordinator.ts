/**
 * MlDsaCoordinator — wallet-side view of ML-DSA-65 (FIPS 204 / Dilithium)
 * signing the node hosts at `/wallet/mldsa/*`. As of 2026-04, the leg is
 * single-party in the node TEE (DESIGN.md §4.3.4 + §11). Once threshold
 * ML-DSA matures (NIST IR 8214B / FROST-PQ), the same port surface
 * gains a round-coordinated mode and `capabilities()` advertises
 * `'threshold'`.
 *
 * Tenzro endpoints (Tenzro implements; wallet kernel only consumes):
 *
 *   1. `capabilities()`
 *      → `GET  /wallet/mldsa/capabilities`
 *      Response: `{mode: 'tee-only' | 'threshold', publicKey?}` —
 *      lets the wallet know whether device round-coordination is
 *      required. While `mode === 'tee-only'`, the device sends only
 *      the preimage and receives the full signature.
 *
 *   2. `sign({did, surfaceKey, preimage, purpose?})`
 *      → `POST /wallet/mldsa/sign`
 *      TEE-only path. Response: `{signature}` — 3293 bytes wire-format.
 *      Latency: dominated by ML-DSA-65 sign cost in the TEE (~ ms).
 *
 *   3. `startRound({did, surfaceKey, preimage, purpose?})`
 *      → `POST /wallet/mldsa/start-round`        (threshold mode only)
 *      `commit({sessionId, deviceCommitment})`
 *      → `POST /wallet/mldsa/commit`             (threshold mode only)
 *      `respond({sessionId, deviceShare})`
 *      → `POST /wallet/mldsa/respond`            (threshold mode only)
 *      `finalize({sessionId})`
 *      → `POST /wallet/mldsa/finalize`           (threshold mode only)
 *
 *      These mirror the FROST coordinator surface and only become
 *      callable once `capabilities().mode === 'threshold'`. Until
 *      then, calling them must throw `MlDsaThresholdUnavailable`.
 *
 * Browser-clean: `fetch` only.
 */

export type MlDsaMode = 'tee-only' | 'threshold';

export interface MlDsaCapabilities {
  readonly mode: MlDsaMode;
  /** Multibase-encoded ML-DSA-65 public key, when bound to a DID. */
  readonly publicKey?: string;
}

export interface MlDsaSignRequest {
  readonly did: string;
  readonly surfaceKey: string;
  readonly preimage: Uint8Array;
  readonly purpose?: string;
}

export interface MlDsaSignResult {
  /** ML-DSA-65 signature, 3293 bytes wire-format. */
  readonly signature: Uint8Array;
}

export class MlDsaThresholdUnavailable extends Error {
  constructor() {
    super(
      'threshold ML-DSA-65 unavailable: node advertises tee-only mode (DESIGN.md §11)',
    );
    this.name = 'MlDsaThresholdUnavailable';
  }
}

export interface MlDsaCoordinator {
  /** Read which mode the node is operating in. Cheap; cache-friendly. */
  capabilities(): Promise<MlDsaCapabilities>;
  /** TEE-only sign. Mode-agnostic — the node hosts both internally. */
  sign(req: MlDsaSignRequest): Promise<MlDsaSignResult>;
}
