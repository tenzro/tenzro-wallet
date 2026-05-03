/**
 * PairingPort — wallet-side view of the QR pairing flow that upgrades a
 * 2-of-2 quorum (passkey-bound device share + node-TEE share) to 2-of-3
 * by adding a second user device. Specified in DESIGN.md §4.3.6.
 *
 * Flow (originally-paired device drives steps 1, 4, 5; second device
 * drives step 3):
 *
 *   1. `start({did})` — POST /wallet/pairing/start
 *      → returns `{sessionId, pairingUrl, expiresAt}`. The wallet renders
 *      `pairingUrl` as a QR code.
 *
 *   2. (User scans the QR on the new device — this happens out-of-band
 *      from the originally-paired device's perspective.)
 *
 *   3. (On the new device, the wallet POSTs /wallet/pairing/claim with a
 *      passkey assertion — `claim()` below for that side of the protocol.)
 *
 *   4. `poll({sessionId})` — POST /wallet/pairing/poll
 *      → repeated until `state === 'claimed' | 'expired' | 'cancelled'`.
 *      Returns the claimed device's passkey public key once available.
 *
 *   5. `finalize({sessionId, originalDeviceAssertion})` —
 *      POST /wallet/pairing/finalize. After the originally-paired device
 *      runs its own passkey ceremony, it submits the assertion here. The
 *      node mediates the threshold-redeal (existing key → 3 shares,
 *      threshold updated to 2-of-3) and updates the DID Document. Returns
 *      the post-redeal `verificationMethod` set so the wallet can update
 *      its local DID cache.
 *
 * The port is intentionally opaque about how passkey assertions are
 * obtained — that's a WebAuthn / native-platform call that lives in the
 * host app. The port only carries the assertion bytes through to the
 * node.
 *
 * Browser-clean: the adapter uses only `fetch` + the assertion bytes the
 * caller supplies; no Node-only globals, no Buffer.
 */

/** A WebAuthn assertion, transport-encoded so the node can verify it. */
export interface PasskeyAssertion {
  /** Base64url credential id used to look up the passkey on the node. */
  readonly credentialId: string;
  /** Base64url client-data JSON. */
  readonly clientDataJson: string;
  /** Base64url authenticator data. */
  readonly authenticatorData: string;
  /** Base64url signature over `authenticatorData || sha256(clientDataJson)`. */
  readonly signature: string;
}

export interface PairingStartRequest {
  /** TDIP DID of the wallet that's initiating the pairing. */
  readonly did: string;
  /** Optional human-readable label for the pairing (shown in approver UI). */
  readonly label?: string;
}

export interface PairingStartResult {
  /** Opaque session id. The wallet uses this for `poll` and `finalize`. */
  readonly sessionId: string;
  /** Full URL that should be rendered as a QR code. The new device opens
   *  this URL in any browser to start the claim ceremony. */
  readonly pairingUrl: string;
  /** Unix-ms timestamp when this session expires. */
  readonly expiresAt: number;
}

export type PairingState =
  | 'pending'    // Session created, waiting for the second device.
  | 'claimed'    // Second device finished its passkey ceremony.
  | 'finalized'  // Threshold-redeal complete; quorum is now 2-of-3.
  | 'expired'
  | 'cancelled';

export interface PairingPollResult {
  readonly sessionId: string;
  readonly state: PairingState;
  /** Set once `state === 'claimed'` or later. The originally-paired
   *  device should display this to the user before finalising, so they
   *  can confirm they're approving the right new device. */
  readonly claimedPublicKey?: string;
  /** Set when `state === 'expired' | 'cancelled'`. */
  readonly reason?: string;
}

export interface PairingClaimRequest {
  readonly sessionId: string;
  readonly assertion: PasskeyAssertion;
  /** Public key of the new passkey, transport-encoded. The node will
   *  attach this to the DID Document on finalization. */
  readonly newDevicePublicKey: string;
}

export interface PairingClaimResult {
  readonly sessionId: string;
  readonly state: PairingState;
}

export interface PairingFinalizeRequest {
  readonly sessionId: string;
  /** Passkey assertion from the originally-paired device, proving it
   *  actively consented to the redeal (rather than the node redealing
   *  silently). */
  readonly originalDeviceAssertion: PasskeyAssertion;
}

export interface VerificationMethod {
  readonly id: string;
  readonly type: string;
  readonly controller: string;
  /** Multibase-encoded public key (e.g. `z6Mk...`). */
  readonly publicKeyMultibase: string;
}

export interface PairingFinalizeResult {
  readonly sessionId: string;
  /** Updated `verificationMethod` set after the redeal — should now hold
   *  three entries (original device, new device, node-TEE). */
  readonly verificationMethods: readonly VerificationMethod[];
  /** New threshold record — expected to be `2-of-3`. */
  readonly threshold: string;
}

export interface PairingPort {
  /** Originally-paired device: mint a pairing session and get the QR URL. */
  start(req: PairingStartRequest): Promise<PairingStartResult>;

  /** New device: claim the session with a passkey assertion. */
  claim(req: PairingClaimRequest): Promise<PairingClaimResult>;

  /** Originally-paired device: poll for the new device's claim. */
  poll(sessionId: string): Promise<PairingPollResult>;

  /** Originally-paired device: finalise with own passkey + trigger redeal. */
  finalize(req: PairingFinalizeRequest): Promise<PairingFinalizeResult>;

  /** Originally-paired device: cancel a pending session. Idempotent. */
  cancel(sessionId: string): Promise<void>;
}
