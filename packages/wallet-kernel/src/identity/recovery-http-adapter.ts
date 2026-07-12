/**
 * RecoveryHttpAdapter — fetch-based driver against a Tenzro RPC node's
 * `/wallet/recover/*` endpoints. Implements `RecoveryPort`; mirrors
 * `ProvisioningHttpAdapter` for shape.
 *
 * Wire shape per DESIGN.md §4.3.5:
 *
 *   POST /wallet/recover/start
 *     body  = { did, proof, force_rotate? }
 *       proof discriminator: { kind: 'email-otp', otp }
 *                          | { kind: 'social',
 *                              delegate_signatures: [{
 *                                delegate_did, signature_b64
 *                              }] }
 *                          | { kind: 'tenzro-id-kyc', proof_token }
 *     reply = { session_id, challenge_b64, user_handle_b64,
 *               user_display_name }
 *
 *   POST /wallet/recover/finalize
 *     body  = { session_id,
 *               enrolment: { credential_id, attestation_object,
 *                            client_data_json } }
 *     reply = { identity, threshold: { k, n },
 *               wrapped_share: { credential_id, wrapped_share_b64,
 *                                alg, salt_b64 } }
 *
 *   POST /wallet/recover/confirm  → 204
 *   POST /wallet/recover/cancel   → 204 (idempotent)
 *
 * Pre-auth: the recovery proof in `start` and the WebAuthn attestation
 * in `finalize` are what the node verifies. No `Authorization` header.
 *
 * Browser-clean: `fetch` only.
 */

import type { TdipDid, TdipIdentity } from '../types/identity.ts';
import type { PasskeyEnrolment, WalletThresholdRecord, WrappedDeviceShare } from './wallet-new.ts';
import type { RecoveryPort, RecoveryProof } from './wallet-recover.ts';

export interface RecoveryHttpConfig {
  /** Base URL of the Tenzro RPC node, e.g. `https://rpc.tenzro.xyz`. */
  readonly baseUrl: string;
  /** Optional `fetch` override for tests. */
  readonly fetch?: typeof fetch;
  /**
   * Per-request headers. Optional — pre-auth routes; included for
   * `X-Trace-Id` or rate-limit tokens.
   */
  readonly headers?: () => Promise<Record<string, string>> | Record<string, string>;
}

export class RecoveryHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(
      `recovery http ${status} on ${url}: ${body.length > 200 ? body.slice(0, 200) + '…' : body}`,
    );
    this.name = 'RecoveryHttpError';
  }
}

interface RawStart {
  session_id: string;
  challenge_b64: string;
  user_handle_b64: string;
  user_display_name: string;
}

interface RawWrappedShare {
  credential_id: string;
  wrapped_share_b64: string;
  alg: string;
  salt_b64: string;
}

interface RawFinalize {
  identity: TdipIdentity;
  threshold: WalletThresholdRecord;
  wrapped_share: RawWrappedShare;
}

export class RecoveryHttpAdapter implements RecoveryPort {
  readonly #cfg: RecoveryHttpConfig;

  constructor(cfg: RecoveryHttpConfig) {
    this.#cfg = cfg;
  }

  async start(req: {
    readonly did: TdipDid;
    readonly proof: RecoveryProof;
    readonly forceRotate?: boolean;
  }): Promise<{
    readonly sessionId: string;
    readonly challenge: Uint8Array;
    readonly userHandle: Uint8Array;
    readonly userDisplayName: string;
  }> {
    const raw = await this.#post<RawStart>('/wallet/recover/start', {
      did: req.did,
      proof: encodeProof(req.proof),
      ...(req.forceRotate !== undefined ? { force_rotate: req.forceRotate } : {}),
    });
    return {
      sessionId: raw.session_id,
      challenge: b64ToBytes(raw.challenge_b64),
      userHandle: b64ToBytes(raw.user_handle_b64),
      userDisplayName: raw.user_display_name,
    };
  }

  async finalize(req: {
    readonly sessionId: string;
    readonly enrolment: PasskeyEnrolment;
  }): Promise<{
    readonly identity: TdipIdentity;
    readonly threshold: WalletThresholdRecord;
    readonly wrappedShare: WrappedDeviceShare;
  }> {
    const raw = await this.#post<RawFinalize>('/wallet/recover/finalize', {
      session_id: req.sessionId,
      enrolment: {
        credential_id: req.enrolment.credentialId,
        attestation_object: req.enrolment.attestationObject,
        client_data_json: req.enrolment.clientDataJson,
      },
    });
    return {
      identity: raw.identity,
      threshold: raw.threshold,
      wrappedShare: {
        credentialId: raw.wrapped_share.credential_id,
        wrappedShare: b64ToBytes(raw.wrapped_share.wrapped_share_b64),
        alg: raw.wrapped_share.alg,
        salt: b64ToBytes(raw.wrapped_share.salt_b64),
      },
    };
  }

  async confirm(req: { readonly sessionId: string }): Promise<void> {
    await this.#post<unknown>('/wallet/recover/confirm', { session_id: req.sessionId });
  }

  async cancel(req: { readonly sessionId: string }): Promise<void> {
    await this.#post<unknown>('/wallet/recover/cancel', { session_id: req.sessionId });
  }

  // --- internals ---

  async #post<TRes>(path: string, body: unknown): Promise<TRes> {
    const f = this.#cfg.fetch ?? globalThis.fetch;
    const url = this.#cfg.baseUrl.replace(/\/+$/, '') + path;
    const extra = (await this.#cfg.headers?.()) ?? {};
    const res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new RecoveryHttpError(res.status, url, text);
    }
    if (res.status === 204) return undefined as TRes;
    return (await res.json()) as TRes;
  }
}

function encodeProof(proof: RecoveryProof): unknown {
  switch (proof.kind) {
    case 'email-otp':
      return { kind: 'email-otp', otp: proof.otp };
    case 'social':
      return {
        kind: 'social',
        delegate_signatures: proof.delegateSignatures.map((d) => ({
          delegate_did: d.delegateDid,
          signature_b64: bytesToB64(d.signature),
        })),
      };
    case 'tenzro-id-kyc':
      return { kind: 'tenzro-id-kyc', proof_token: proof.proofToken };
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
