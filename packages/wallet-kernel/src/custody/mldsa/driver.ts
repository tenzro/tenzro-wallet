/**
 * Threshold-aware ML-DSA-65 driver.
 *
 * As of 2026-04 this is functionally TEE-only (single party at the
 * node), since no audited threshold ML-DSA-65 exists. The driver
 * exposes the eventual-threshold shape today so callers don't have
 * to re-wire when the node flips `capabilities().mode` to
 * `'threshold'`.
 *
 * Use directly only for *non-hybrid* ML-DSA surfaces (rare; reserved
 * for ML-DSA-only audit attestations). For Tenzro-native txs use
 * `hybridEd25519MlDsaDriver` which composes this with the FROST-Ed25519
 * leg.
 *
 * Returns one 3293-byte ML-DSA-65 signature.
 */

import type { SigningDriver, SigningRequest, SigningResult } from '../../types/signing-driver.ts';
import { surfaceKeyId } from '../surface-key-id.ts';
import type { MlDsaCoordinator } from './coordinator.ts';

export interface ThresholdMlDsaOptions {
  readonly coordinator: MlDsaCoordinator;
}

export function thresholdMlDsaDriver(opts: ThresholdMlDsaOptions): SigningDriver {
  return {
    // Reuse `tenzro-tee` until the node flips to threshold mode; the
    // surface modules already classify this id as "node-attested".
    id: 'tenzro-tee',
    async sign(req: SigningRequest): Promise<SigningResult> {
      // Standalone ML-DSA-65 isn't a `SigningScheme` value today, but
      // the hybrid driver invokes the coordinator directly — so reach
      // this driver only via misconfiguration. Guard explicitly.
      if (req.scheme !== 'ed25519+ml-dsa-65') {
        throw new Error(
          `threshold-mldsa driver expected scheme ed25519+ml-dsa-65, got '${req.scheme}'`,
        );
      }
      const { signature } = await opts.coordinator.sign({
        did: req.did.toString(),
        surfaceKey: surfaceKeyId(req.surfaceKey),
        preimage: req.preimage,
        ...(req.purpose !== undefined ? { purpose: req.purpose } : {}),
      });
      if (signature.length !== 3293) {
        throw new Error(`ml-dsa-65 signature wrong length: ${signature.length}`);
      }
      return { signatures: [signature] };
    },
  };
}
