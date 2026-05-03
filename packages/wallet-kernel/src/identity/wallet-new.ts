/**
 * `walletNew()` — passkey-quorum provisioning flow per DESIGN.md §4.3.2.
 *
 * Replaces M1's deterministic `provisionIdentity()` (which mocks shares
 * locally) with the M5 network-governed ceremony. The kernel orchestrates;
 * Tenzro's `/wallet/new/*` endpoints + the host's WebAuthn glue do the
 * heavy lifting.
 *
 * Steps mapped to DESIGN.md §4.3.2:
 *
 *   1. Host opens an onboarding page; the kernel is invoked from that page.
 *   2. Host runs `navigator.credentials.create` via `PasskeyEnroller`,
 *      yielding a fresh passkey credential bound to the Tenzro relying-party.
 *   3. Kernel calls `ProvisioningPort.start({credentialId, attestation, kind})`.
 *      The node-TEE runs DKG, returns the new DID + per-surface public keys
 *      + the wrapped device share + AEAD metadata.
 *   4. Kernel hands the wrapped share to `ShareStore.put(...)` so the host
 *      can persist it under the platform's secure storage (IndexedDB, OS
 *      keychain, largeBlob, …). The unwrap key never enters JS memory.
 *   5. Kernel calls `ProvisioningPort.confirm({did, sessionId})` so the
 *      node-TEE finalises the topology record (DID Document, threshold,
 *      verificationMethods).
 *   6. Kernel returns the resulting `TdipIdentity` and the credential id
 *      bound to the device share, so subsequent signing flows can pass
 *      it into `PasskeyShareUnwrapper`.
 *
 * Errors abort cleanly: if `confirm` fails, the kernel calls
 * `ProvisioningPort.cancel(sessionId)` so the node drops the half-built
 * record and the wrapped share, and re-throws the original error. The
 * host is responsible for surfacing the failure to the user.
 *
 * Browser-clean: no Node-specific globals.
 */

import type { TdipIdentity, TdipKind } from '../types/identity.ts';

export type WalletThresholdRecord = {
  readonly k: number;
  readonly n: number;
};

/**
 * Wrapped device-share envelope handed back by the node at provisioning.
 * Bytes are decoded already (the HTTP layer does base64 ↔ Uint8Array).
 *
 * `alg`/`salt` are surfaced so the same share envelope can later flow
 * through `ShareEnvelopePort.fetchEnvelope()` on subsequent unwraps —
 * the node treats provisioning as a "first envelope" and re-uses the
 * same wrapping at sign time.
 */
export interface WrappedDeviceShare {
  readonly credentialId: string;
  readonly wrappedShare: Uint8Array;
  readonly alg: string;
  readonly salt: Uint8Array;
}

export interface PasskeyEnrolment {
  readonly credentialId: string;
  /** WebAuthn attestation object, base64url. Forwarded verbatim to node. */
  readonly attestationObject: string;
  /** WebAuthn clientDataJSON, base64url. */
  readonly clientDataJson: string;
}

/**
 * Browser passkey *create* (not *get*). Wraps `navigator.credentials.create`
 * with the wallet's relying-party id and a node-issued challenge.
 */
export interface PasskeyEnroller {
  enroll(opts: {
    readonly challenge: Uint8Array;
    readonly userId: Uint8Array;
    readonly userDisplayName: string;
  }): Promise<PasskeyEnrolment>;
}

/**
 * Server transport for `/wallet/new/*`. Tenzro implements; kernel consumes.
 *
 *   POST /wallet/new/start    → { session_id, challenge_b64,
 *                                 user_handle_b64 }
 *   POST /wallet/new/finalize → { did, identity, threshold,
 *                                 wrapped_share }   // see WrappedDeviceShare
 *   POST /wallet/new/confirm  → 204                  // identity persisted
 *   POST /wallet/new/cancel   → 204                  // idempotent abort
 */
export interface ProvisioningPort {
  start(req: { readonly kind: TdipKind }): Promise<{
    readonly sessionId: string;
    readonly challenge: Uint8Array;
    readonly userHandle: Uint8Array;
    readonly userDisplayName: string;
  }>;

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

/**
 * Where the host persists the wrapped device share. The kernel never
 * reads from this directly at sign time — that's `ShareEnvelopePort`'s
 * job — but the host needs a hook to put the freshly-wrapped share into
 * its persistence layer at provision time, in case the node doesn't
 * also keep an envelope copy (deployment configurable).
 */
export interface DeviceShareStore {
  put(req: {
    readonly did: string;
    readonly share: WrappedDeviceShare;
  }): Promise<void>;
}

export interface WalletNewOptions {
  readonly kind?: TdipKind;
  readonly enroller: PasskeyEnroller;
  readonly provisioning: ProvisioningPort;
  /** Optional: persist locally too, in addition to whatever the node keeps. */
  readonly shareStore?: DeviceShareStore;
}

export interface WalletNewResult {
  readonly identity: TdipIdentity;
  readonly threshold: WalletThresholdRecord;
  readonly credentialId: string;
}

export async function walletNew(opts: WalletNewOptions): Promise<WalletNewResult> {
  const kind = opts.kind ?? 'human';
  const start = await opts.provisioning.start({ kind });

  let enrolment: PasskeyEnrolment;
  try {
    enrolment = await opts.enroller.enroll({
      challenge: start.challenge,
      userId: start.userHandle,
      userDisplayName: start.userDisplayName,
    });
  } catch (err) {
    // User cancelled the passkey UI, or the authenticator failed.
    await safeCancel(opts.provisioning, start.sessionId);
    throw err;
  }

  let finalised: Awaited<ReturnType<ProvisioningPort['finalize']>>;
  try {
    finalised = await opts.provisioning.finalize({
      sessionId: start.sessionId,
      enrolment,
    });
  } catch (err) {
    await safeCancel(opts.provisioning, start.sessionId);
    throw err;
  }

  if (opts.shareStore) {
    try {
      await opts.shareStore.put({
        did: finalised.identity.did,
        share: finalised.wrappedShare,
      });
    } catch (err) {
      await safeCancel(opts.provisioning, start.sessionId);
      throw err;
    }
  }

  try {
    await opts.provisioning.confirm({ sessionId: start.sessionId });
  } catch (err) {
    await safeCancel(opts.provisioning, start.sessionId);
    throw err;
  }

  return {
    identity: finalised.identity,
    threshold: finalised.threshold,
    credentialId: finalised.wrappedShare.credentialId,
  };
}

async function safeCancel(p: ProvisioningPort, sessionId: string): Promise<void> {
  try {
    await p.cancel({ sessionId });
  } catch {
    // Best-effort; the node's own session-TTL will clean up.
  }
}
