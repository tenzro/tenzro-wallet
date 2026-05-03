/**
 * `walletRecover()` — passkey-quorum recovery flow per DESIGN.md §4.3.5.
 *
 * Two recovery paths covered by the same orchestrator (the node decides
 * which proof to accept based on what the user pre-registered at
 * provisioning time):
 *
 *   - **Device lost, TEE survives** (single-device or `2-of-2` testnet
 *     case): user opens `/wallet/recover` on a new device, runs a
 *     passkey ceremony, and submits a recovery proof (verified email
 *     OTP, social-recovery delegate signatures per
 *     `delegate-set.ts`, or pre-registered Tenzro-id KYC re-assertion).
 *     The TEE re-randomises the device leg and deals a fresh share to
 *     the new device. Same DID, rotated public keys + new credentialId.
 *
 *   - **Compromise suspected**: same flow, optionally `forceRotate`
 *     forces both shares to re-randomise.
 *
 * The kernel orchestrates; Tenzro's `/wallet/recover/*` endpoints + the
 * host's WebAuthn enroller do the cryptographic work. We mirror
 * `wallet-new.ts` shape on purpose — the only differences are:
 *
 *   - `start` takes the existing `did` plus a recovery-proof envelope;
 *   - `finalize` may rotate per-surface public keys, so the result
 *     yields the *new* `TdipIdentity`;
 *   - the new `credentialId` is the freshly-enrolled passkey, not the
 *     lost device's.
 *
 * Errors abort cleanly via `cancel(sessionId)`, same as `walletNew`.
 *
 * Browser-clean: no Node-specific globals.
 */

import type { TdipDid, TdipIdentity } from '../types/identity.ts';
import type {
  PasskeyEnroller,
  PasskeyEnrolment,
  WalletThresholdRecord,
  WrappedDeviceShare,
  DeviceShareStore,
} from './wallet-new.ts';

/**
 * Recovery proof envelope. The kernel does not interpret these; the
 * node verifies them against what the user pre-registered at
 * provisioning. The discriminator is forwarded verbatim.
 *
 * Three kinds the M5 design covers:
 *   - `email-otp` — node-issued OTP delivered out-of-band.
 *   - `social` — k of n delegate signatures over a recovery message.
 *   - `tenzro-id-kyc` — fresh KYC re-assertion (vendor proof of liveness).
 */
export type RecoveryProof =
  | {
      readonly kind: 'email-otp';
      readonly otp: string;
    }
  | {
      readonly kind: 'social';
      /** Pre-validated against `delegate-set.ts` shape upstream. */
      readonly delegateSignatures: ReadonlyArray<{
        readonly delegateDid: TdipDid;
        readonly signature: Uint8Array;
      }>;
    }
  | {
      readonly kind: 'tenzro-id-kyc';
      /** Vendor-specific proof token (Persona, Sumsub, etc). */
      readonly proofToken: string;
    };

export interface RecoveryStartReply {
  readonly sessionId: string;
  readonly challenge: Uint8Array;
  readonly userHandle: Uint8Array;
  readonly userDisplayName: string;
}

/**
 * Server transport for `/wallet/recover/*`. Tenzro implements; kernel
 * consumes.
 *
 *   POST /wallet/recover/start    → { session_id, challenge_b64,
 *                                     user_handle_b64, user_display_name }
 *   POST /wallet/recover/finalize → { identity, threshold, wrapped_share }
 *   POST /wallet/recover/confirm  → 204
 *   POST /wallet/recover/cancel   → 204  (idempotent)
 */
export interface RecoveryPort {
  start(req: {
    readonly did: TdipDid;
    readonly proof: RecoveryProof;
    /**
     * Optional: also rotate the TEE-side share. Default `false` —
     * device-lost-TEE-survives only re-randomises the device leg.
     * `true` is for compromise-suspected: both legs rotate.
     */
    readonly forceRotate?: boolean;
  }): Promise<RecoveryStartReply>;

  finalize(req: {
    readonly sessionId: string;
    readonly enrolment: PasskeyEnrolment;
  }): Promise<{
    readonly identity: TdipIdentity;
    readonly threshold: WalletThresholdRecord;
    readonly wrappedShare: WrappedDeviceShare;
  }>;

  confirm(req: { readonly sessionId: string }): Promise<void>;
  cancel(req: { readonly sessionId: string }): Promise<void>;
}

export interface WalletRecoverOptions {
  readonly did: TdipDid;
  readonly proof: RecoveryProof;
  readonly forceRotate?: boolean;
  readonly enroller: PasskeyEnroller;
  readonly recovery: RecoveryPort;
  readonly shareStore?: DeviceShareStore;
}

export interface WalletRecoverResult {
  readonly identity: TdipIdentity;
  readonly threshold: WalletThresholdRecord;
  readonly credentialId: string;
}

export async function walletRecover(
  opts: WalletRecoverOptions,
): Promise<WalletRecoverResult> {
  const start = await opts.recovery.start({
    did: opts.did,
    proof: opts.proof,
    ...(opts.forceRotate !== undefined ? { forceRotate: opts.forceRotate } : {}),
  });

  let enrolment: PasskeyEnrolment;
  try {
    enrolment = await opts.enroller.enroll({
      challenge: start.challenge,
      userId: start.userHandle,
      userDisplayName: start.userDisplayName,
    });
  } catch (err) {
    await safeCancel(opts.recovery, start.sessionId);
    throw err;
  }

  let finalised: Awaited<ReturnType<RecoveryPort['finalize']>>;
  try {
    finalised = await opts.recovery.finalize({
      sessionId: start.sessionId,
      enrolment,
    });
  } catch (err) {
    await safeCancel(opts.recovery, start.sessionId);
    throw err;
  }

  if (opts.shareStore) {
    try {
      await opts.shareStore.put({
        did: finalised.identity.did,
        share: finalised.wrappedShare,
      });
    } catch (err) {
      await safeCancel(opts.recovery, start.sessionId);
      throw err;
    }
  }

  try {
    await opts.recovery.confirm({ sessionId: start.sessionId });
  } catch (err) {
    await safeCancel(opts.recovery, start.sessionId);
    throw err;
  }

  return {
    identity: finalised.identity,
    threshold: finalised.threshold,
    credentialId: finalised.wrappedShare.credentialId,
  };
}

async function safeCancel(p: RecoveryPort, sessionId: string): Promise<void> {
  try {
    await p.cancel({ sessionId });
  } catch {
    // Best-effort; node's session-TTL cleans up.
  }
}
