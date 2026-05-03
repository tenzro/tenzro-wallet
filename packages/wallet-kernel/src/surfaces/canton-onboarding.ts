/**
 * Canton external-party onboarding flow.
 *
 * Kept separate from the canton-external/canton-internal "send" surface
 * because onboarding is a one-shot ceremony, not a transaction:
 *   1. Wallet derives namespace + signing keypairs (provisioned at identity
 *      creation time — see `provisionIdentity`).
 *   2. `generateTopology` asks the validator to render the three unsigned
 *      topology transactions (NamespaceDelegation, PartyToKeyMapping,
 *      PartyToParticipant) plus a bundle hash.
 *   3. Wallet signs the bundle hash with the **namespace key** (cold key —
 *      this is the only time it's used in normal operation; rotations re-use it).
 *   4. `submitTopology` ships the signed bundle to the synchronizer.
 *   5. `setupProposal` asks the Tenzro validator to publish a setup-proposal
 *      contract that, once accepted, federates the new external party with
 *      the validator's hosting participant.
 *   6. `prepareAcceptSetup` returns a PreparedTransaction for the
 *      `ExternalPartySetupProposal_Accept` choice.
 *   7. Wallet recomputes the prepared-tx hash, signs it with the namespace
 *      key (Canton's setup-proposal accept is namespace-signed by convention).
 *   8. `submitAcceptSetup` finalises — TransferPreapproval + featured-app
 *      delegate are created in the same atomic submission.
 *
 * After step 8 the party can transact normally through `cantonExternalSurface`.
 *
 * Spec refs:
 *   - DESIGN.md §4.5.5 (onboarding flow), §4.5.6 (auto-renewal)
 *   - Splice docs `validator-onboarding-external-party.md`
 *   - Canton OSS `topology.proto` (NamespaceDelegation, PartyToKeyMapping,
 *     PartyToParticipant)
 */

import {
  bytesEqualConstantTime,
  preparedTransactionHash,
  topologyBundleHash,
} from '../ports/canton/hash.ts';
import type { CantonValidatorPort } from '../ports/canton/canton-validator.ts';
import type { CantonPartyKey, SurfaceKey, TdipDid } from '../types/identity.ts';
import type { SigningDriver } from '../types/signing-driver.ts';

export interface CantonOnboardingDeps {
  readonly keyResolver: (did: TdipDid) => SurfaceKey | undefined;
  readonly signingDriver: SigningDriver;
  /** Pointed at the Tenzro validator hosting the new party (canton-external
   *  goes to the GSN-attached validator; canton-internal to the Tenzro-
   *  operated synchronizer's validator). */
  readonly validatorPort: CantonValidatorPort;
}

export interface OnboardExternalPartyRequest {
  readonly did: TdipDid;
  /** `canton-internal` or `canton-external` — selects which provisioned
   *  party key to onboard. */
  readonly surface: 'canton-internal' | 'canton-external';
  /** Hint portion of the resulting party id; the validator may sanitize it. */
  readonly partyHint: string;
}

export interface OnboardExternalPartyResult {
  /** The fully-qualified party id (`<hint>::<namespace-fingerprint>`). */
  readonly partyId: string;
}

/**
 * Run the complete onboarding ceremony. Idempotent at the validator-app
 * layer — the validator no-ops topology submissions for a party already on
 * the synchronizer, and `setupProposal` no-ops if a live proposal exists.
 * Re-running on a party that's already accepted-setup will fail at step 7
 * (the validator returns 409); that's fine — the surface caller should only
 * invoke this once.
 */
export async function onboardExternalParty(
  deps: CantonOnboardingDeps,
  req: OnboardExternalPartyRequest,
): Promise<OnboardExternalPartyResult> {
  const key = deps.keyResolver(req.did);
  if (!key || key.surface !== req.surface) {
    throw new Error(`onboarding: no ${req.surface} key for ${req.did}`);
  }
  const partyKey: CantonPartyKey = key;

  // 1) Ask the validator to render the unsigned topology bundle.
  const generated = await deps.validatorPort.generateTopology({
    partyHint: req.partyHint,
    namespacePublicKey: partyKey.namespaceKey.publicKey,
    signingPublicKeys: partyKey.signingKeys.map((k) => ({
      publicKey: k.publicKey,
      scheme: k.scheme,
    })),
    threshold: partyKey.threshold,
  });

  // 2) Recompute the bundle hash and verify it matches the validator's hash.
  // Same security argument as `preparedTransactionHash` recomputation: we
  // can't sign the validator's claim of what the bundle hashes to without
  // verifying it ourselves, otherwise a malicious validator could swap in
  // a different topology behind our back.
  const recomputedBundle = await topologyBundleHash(generated.topologyTransactions);
  if (!bytesEqualConstantTime(recomputedBundle, generated.bundleHash)) {
    throw new Error(
      'onboarding: topology bundle hash mismatch — refusing to sign. ' +
        'Validator returned bundle bytes whose hash differs from its claimed bundle hash.',
    );
  }

  // 3) Sign the bundle hash with the namespace (cold) key.
  const namespaceSig = await deps.signingDriver.sign({
    did: req.did,
    surfaceKey: key,
    scheme: 'ed25519',
    preimage: recomputedBundle,
    purpose: 'canton-topology-bundle',
  });
  if (namespaceSig.signatures.length === 0) {
    throw new Error('onboarding: signing driver returned no signatures');
  }
  const namespaceSignature = namespaceSig.signatures[0]!;

  // 4) Submit the signed topology bundle to the synchronizer.
  await deps.validatorPort.submitTopology({
    topologyTransactions: generated.topologyTransactions,
    namespaceSignature,
  });

  // 5) Ask the Tenzro validator to publish a setup-proposal contract.
  await deps.validatorPort.setupProposal({ partyId: generated.partyId });

  // 6) Get the prepared accept-setup tx + its hash from the validator.
  const accept = await deps.validatorPort.prepareAcceptSetup({
    partyId: generated.partyId,
  });

  // 7) Recompute the accept-setup hash and assert equality before signing.
  const recomputedAccept = await preparedTransactionHash(accept.preparedTransaction);
  if (!bytesEqualConstantTime(recomputedAccept, accept.preparedTransactionHash)) {
    throw new Error(
      'onboarding: accept-setup preparedTransactionHash mismatch — refusing to sign.',
    );
  }
  const acceptSig = await deps.signingDriver.sign({
    did: req.did,
    surfaceKey: key,
    scheme: 'ed25519',
    preimage: recomputedAccept,
    purpose: 'canton-accept-setup',
  });
  if (acceptSig.signatures.length === 0) {
    throw new Error('onboarding: signing driver returned no signatures for accept-setup');
  }

  // 8) Finalise — submit the signed accept-setup.
  await deps.validatorPort.submitAcceptSetup({
    preparedTransaction: accept.preparedTransaction,
    signature: acceptSig.signatures[0]!,
    hashingSchemeVersion: accept.hashingSchemeVersion,
  });

  return { partyId: generated.partyId };
}
