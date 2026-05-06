/**
 * FROST-Ed25519 device driver. Implements `SigningDriver` by walking
 * the FROST round protocol against a `FrostCoordinator` (Tenzro-hosted)
 * and a `FrostDeviceShareHolder` (passkey-unwrapped, device-local).
 *
 * Endpoint contracts the coordinator wraps are documented on
 * `FrostCoordinator`. This file only orchestrates the rounds; it
 * produces *no* secret material itself.
 *
 * Use this driver for:
 *   - Tenzro-native ed25519 surfaces (non-hybrid).
 *   - SVM (Solana) surfaces.
 *   - The Ed25519 leg of a hybrid signature (composed via
 *     `hybrid-driver.ts`).
 *
 * Returns a single 64-byte Ed25519 signature.
 */

import type { SigningDriver, SigningRequest, SigningResult } from '../../types/signing-driver.ts';
import { surfaceKeyId } from '../surface-key-id.ts';
import type { FrostCoordinator, FrostDeviceShareHolder } from './coordinator.ts';

export interface FrostEd25519Options {
  readonly coordinator: FrostCoordinator;
  /**
   * Resolves the device-share holder for a given signing request. Lets
   * the host plug in passkey-unwrap (PRF/largeBlob) or escrow-envelope
   * unwrap without the driver knowing which.
   */
  readonly resolveShareHolder: (req: SigningRequest) => Promise<FrostDeviceShareHolder>;
}

export function frostEd25519Driver(opts: FrostEd25519Options): SigningDriver {
  return {
    id: 'frost-ed25519',
    async sign(req: SigningRequest): Promise<SigningResult> {
      if (req.scheme !== 'ed25519' && req.scheme !== 'ed25519+ml-dsa-65') {
        throw new Error(`frost-ed25519 driver cannot sign scheme '${req.scheme}'`);
      }

      const holder = await opts.resolveShareHolder(req);
      if (holder.scheme !== 'ed25519') {
        throw new Error(`share-holder scheme mismatch: expected ed25519, got ${holder.scheme}`);
      }

      let sessionId: string | undefined;
      try {
        const started = await opts.coordinator.start({
          did: req.did.toString(),
          surfaceKey: surfaceKeyId(req.surfaceKey),
          scheme: 'ed25519',
          preimage: req.preimage,
          ...(req.purpose !== undefined ? { purpose: req.purpose } : {}),
        });
        sessionId = started.sessionId;

        const deviceCommitment = await holder.commit();
        await opts.coordinator.commit({ sessionId, deviceCommitment });

        const challenge = await opts.coordinator.awaitChallenge(sessionId);
        if (challenge.state !== 'committed') {
          throw new Error(`frost round in unexpected state: ${challenge.state}`);
        }

        const deviceShare = await holder.respond({
          preimage: req.preimage,
          groupCommitment: challenge.groupCommitment,
          signerSet: challenge.signerSet,
          lambda: challenge.lambda,
        });
        await opts.coordinator.respond({ sessionId, deviceShare });

        const finalized = await opts.coordinator.finalize(sessionId);
        if (finalized.state !== 'finalized' || !finalized.signature) {
          throw new Error(`frost-ed25519 finalize returned state=${finalized.state}`);
        }
        if (finalized.signature.length !== 64) {
          throw new Error(
            `frost-ed25519 signature has wrong length: ${finalized.signature.length}`,
          );
        }
        return { signatures: [finalized.signature] };
      } catch (err) {
        if (sessionId !== undefined) {
          await opts.coordinator
            .abort(sessionId, err instanceof Error ? err.message : 'unknown')
            .catch(() => undefined);
        }
        throw err;
      } finally {
        holder.dispose?.();
      }
    },
  };
}
