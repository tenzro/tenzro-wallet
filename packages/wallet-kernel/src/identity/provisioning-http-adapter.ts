/**
 * ProvisioningHttpAdapter — fetch-based driver against a Tenzro RPC node's
 * `/wallet/new/*` endpoints. Implements `ProvisioningPort`; mirrors
 * `PairingHttpAdapter` and `ShareEnvelopeHttpAdapter` for shape.
 *
 * Wire shape per DESIGN.md §4.3.2:
 *
 *   POST /wallet/new/start
 *     body  = { kind }
 *     reply = { session_id, challenge_b64, user_handle_b64,
 *               user_display_name }
 *
 *   POST /wallet/new/finalize
 *     body  = { session_id,
 *               enrolment: { credential_id, attestation_object,
 *                            client_data_json } }
 *     reply = { identity, threshold: { k, n },
 *               wrapped_share: { credential_id, wrapped_share_b64,
 *                                alg, salt_b64 } }
 *
 *   POST /wallet/new/confirm  → 204
 *   POST /wallet/new/cancel   → 204 (idempotent)
 *
 * Bytes on the wire are standard base64 (RFC 4648 §4) — same convention
 * the FROST + Canton + ShareEnvelope adapters use. The `_b64` suffix is
 * load-bearing.
 *
 * The `/wallet/new/*` endpoints are pre-auth: provisioning runs before
 * the user has any session, and the new device's consent is asserted by
 * the WebAuthn attestation embedded in `finalize`. So no `Authorization`
 * header is threaded through. The optional `headers` callback exists for
 * hosts that still want to attach `X-Trace-Id` or rate-limit tokens.
 *
 * Browser-clean: `fetch` only.
 */

import type { TdipIdentity, TdipKind } from '../types/identity.ts';
import type {
  PasskeyEnrolment,
  ProvisioningPort,
  WalletThresholdRecord,
  WrappedDeviceShare,
} from './wallet-new.ts';

export interface ProvisioningHttpConfig {
  /** Base URL of the Tenzro RPC node, e.g. `https://rpc.tenzro.xyz`. */
  readonly baseUrl: string;
  /** Optional `fetch` override for tests. */
  readonly fetch?: typeof fetch;
  /**
   * Per-request headers. Optional — the routes are pre-auth, but a host
   * may still want to attach `X-Trace-Id` or similar.
   */
  readonly headers?: () => Promise<Record<string, string>> | Record<string, string>;
}

export class ProvisioningHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(
      `provisioning http ${status} on ${url}: ${
        body.length > 200 ? body.slice(0, 200) + '…' : body
      }`,
    );
    this.name = 'ProvisioningHttpError';
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

export class ProvisioningHttpAdapter implements ProvisioningPort {
  readonly #cfg: ProvisioningHttpConfig;

  constructor(cfg: ProvisioningHttpConfig) {
    this.#cfg = cfg;
  }

  async start(req: { readonly kind: TdipKind }): Promise<{
    readonly sessionId: string;
    readonly challenge: Uint8Array;
    readonly userHandle: Uint8Array;
    readonly userDisplayName: string;
  }> {
    const raw = await this.#post<RawStart>('/wallet/new/start', { kind: req.kind });
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
    const raw = await this.#post<RawFinalize>('/wallet/new/finalize', {
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
    await this.#post<unknown>('/wallet/new/confirm', { session_id: req.sessionId });
  }

  async cancel(req: { readonly sessionId: string }): Promise<void> {
    await this.#post<unknown>('/wallet/new/cancel', { session_id: req.sessionId });
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
      throw new ProvisioningHttpError(res.status, url, text);
    }
    if (res.status === 204) return undefined as TRes;
    return (await res.json()) as TRes;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
