/**
 * FROST-secp256k1 device driver. Implements `SigningDriver` by walking
 * the FROST round protocol against a `FrostCoordinator` (Tenzro-hosted)
 * and a `FrostDeviceShareHolder` (passkey-unwrapped, device-local).
 *
 * Endpoint contracts the coordinator wraps are documented on
 * `FrostCoordinator`. This file only orchestrates the rounds; it
 * produces *no* secret material itself.
 *
 * Use this driver for EVM surfaces (ECDSA over secp256k1). The node
 * returns a 64-byte `r||s` aggregate; the EVM surface module is
 * responsible for recovering or appending the `v` byte to make a
 * 65-byte tx signature. This is consistent with how internal-mpc
 * stubs the curve today.
 *
 * Returns a single signature (64 or 65 bytes — see DESIGN.md §4.3.4
 * for the convention each surface uses).
 */

import type {
  SigningDriver,
  SigningRequest,
  SigningResult,
} from '../../types/signing-driver.ts';
import { surfaceKeyId } from '../surface-key-id.ts';
import type {
  FrostCoordinator,
  FrostDeviceShareHolder,
} from './coordinator.ts';

export interface FrostSecp256k1Options {
  readonly coordinator: FrostCoordinator;
  readonly resolveShareHolder: (
    req: SigningRequest,
  ) => Promise<FrostDeviceShareHolder>;
}

export function frostSecp256k1Driver(
  opts: FrostSecp256k1Options,
): SigningDriver {
  return {
    id: 'frost-secp256k1',
    async sign(req: SigningRequest): Promise<SigningResult> {
      if (req.scheme !== 'secp256k1') {
        throw new Error(
          `frost-secp256k1 driver cannot sign scheme '${req.scheme}'`,
        );
      }

      const holder = await opts.resolveShareHolder(req);
      if (holder.scheme !== 'secp256k1') {
        throw new Error(
          `share-holder scheme mismatch: expected secp256k1, got ${holder.scheme}`,
        );
      }

      let sessionId: string | undefined;
      try {
        const started = await opts.coordinator.start({
          did: req.did.toString(),
          surfaceKey: surfaceKeyId(req.surfaceKey),
          scheme: 'secp256k1',
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
          throw new Error(
            `frost-secp256k1 finalize returned state=${finalized.state}`,
          );
        }
        const len = finalized.signature.length;
        if (len !== 64 && len !== 65) {
          throw new Error(
            `frost-secp256k1 signature has wrong length: ${len}`,
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
