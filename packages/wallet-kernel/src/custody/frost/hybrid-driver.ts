/**
 * Hybrid (Ed25519 + ML-DSA-65) signing driver for Tenzro-native
 * surfaces. Per DESIGN.md §4.3.4 + §11, the Ed25519 leg is
 * threshold-signed across the passkey quorum (FROST-Ed25519); the
 * ML-DSA-65 leg is supplied by the node TEE alone — there is no
 * audited threshold ML-DSA implementation as of 2026-04, so the leg
 * is single-party until NIST IR 8214B + FROST-PQ mature.
 *
 * Tenzro endpoints:
 *
 *   - The Ed25519 leg uses `FrostCoordinator` against
 *     `/wallet/frost/ed25519/*` (see `coordinator.ts`).
 *   - The ML-DSA-65 leg uses `MlDsaCoordinator` against
 *     `/wallet/mldsa/*` (see `../mldsa/coordinator.ts`).
 *
 * Returns a 2-element `signatures` array:
 *   [0] = 64-byte FROST-Ed25519 signature
 *   [1] = 3293-byte ML-DSA-65 signature
 *
 * The hybrid driver stitches the two legs in parallel — the Ed25519
 * threshold round and the ML-DSA TEE call run concurrently, so
 * latency is `max(frost, mldsa)`, not the sum.
 *
 * When the underlying ML-DSA coordinator advertises threshold
 * capability (see DESIGN.md §11), this driver swaps over without the
 * caller noticing, as long as the response stays a single 3293-byte
 * signature.
 */

import type {
  SigningDriver,
  SigningRequest,
  SigningResult,
} from '../../types/signing-driver.ts';
import type { MlDsaCoordinator } from '../mldsa/coordinator.ts';
import { surfaceKeyId } from '../surface-key-id.ts';
import { frostEd25519Driver, type FrostEd25519Options } from './ed25519-driver.ts';

export interface HybridDriverOptions extends FrostEd25519Options {
  /** ML-DSA-65 coordinator. Today: TEE-only. Future: threshold. */
  readonly mlDsaCoordinator: MlDsaCoordinator;
}

export function hybridEd25519MlDsaDriver(
  opts: HybridDriverOptions,
): SigningDriver {
  const ed25519 = frostEd25519Driver(opts);

  return {
    id: 'hybrid-ed25519-mldsa',
    async sign(req: SigningRequest): Promise<SigningResult> {
      if (req.scheme !== 'ed25519+ml-dsa-65') {
        throw new Error(
          `hybrid driver cannot sign scheme '${req.scheme}'`,
        );
      }

      // Run both legs in parallel — neither depends on the other.
      const [ed, ml] = await Promise.all([
        ed25519.sign(req),
        opts.mlDsaCoordinator.sign({
          did: req.did.toString(),
          surfaceKey: surfaceKeyId(req.surfaceKey),
          preimage: req.preimage,
          ...(req.purpose !== undefined ? { purpose: req.purpose } : {}),
        }),
      ]);

      const edSig = ed.signatures[0];
      if (!edSig || edSig.length !== 64) {
        throw new Error('hybrid: ed25519 leg returned wrong-length signature');
      }
      if (ml.signature.length !== 3293) {
        throw new Error(
          `hybrid: ml-dsa leg returned wrong-length signature: ${ml.signature.length}`,
        );
      }

      return { signatures: [edSig, ml.signature] };
    },
  };
}
