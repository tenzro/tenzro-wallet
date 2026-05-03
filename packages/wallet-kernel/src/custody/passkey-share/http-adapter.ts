/**
 * ShareEnvelopeHttpAdapter — fetch-based driver against a Tenzro RPC
 * node's `/wallet/share/*` endpoints. Implements the `ShareEnvelopePort`
 * port; mirrors `FrostHttpAdapter`, `MlDsaHttpAdapter`, and
 * `PairingHttpAdapter` for shape.
 *
 * Wire shape per `unwrapper.ts` header + DESIGN.md §4.3.5:
 *
 *   GET  /wallet/share/envelope?credential_id=…&surface_key=…&scheme=…
 *     reply = { wrapped_share_b64, alg, salt_b64 }
 *
 *   POST /wallet/share/escrow/challenge
 *     body  = { credential_id, surface_key, scheme }
 *     reply = { nonce, expires_at }
 *
 *   POST /wallet/share/escrow/unwrap
 *     body  = { credential_id, surface_key, scheme, nonce,
 *               assertion: { credential_id, client_data_json,
 *                            authenticator_data, signature } }
 *     reply = { wrapped_share_b64, pepper_b64 }
 *
 * Bytes on the wire are standard base64 (RFC 4648 §4) — same convention
 * the FROST + Canton adapters use. The `_b64` suffix is load-bearing.
 *
 * The `/wallet/share/*` endpoints are pre-auth: the envelope and escrow
 * routes are authenticated by the passkey assertion in the body itself
 * (escrow path) or by the credential id + surface-key tuple (envelope
 * path; the wrapped share is useless without the PRF/largeBlob output).
 * The optional `headers` callback exists for hosts that still want to
 * attach a session token for rate-limiting or tracing.
 *
 * The `assertion` fields ship as base64url strings (matches WebAuthn's
 * native shape from `navigator.credentials.get`), not base64 — the host's
 * WebAuthn glue produces them already-encoded; the adapter passes them
 * through verbatim.
 *
 * Browser-clean: `fetch` only.
 */

import type {
  PasskeyAssertion,
  ShareEnvelopePort,
  ShareUnwrapRequest,
} from './unwrapper.ts';

export interface ShareEnvelopeHttpConfig {
  /** Base URL of the Tenzro RPC node, e.g. `https://rpc.tenzro.network`. */
  readonly baseUrl: string;
  /** Optional `fetch` override for tests. */
  readonly fetch?: typeof fetch;
  /**
   * Per-request headers. Optional — the routes are pre-auth, but a host
   * may still want to attach `X-Trace-Id` or similar.
   */
  readonly headers?: () => Promise<Record<string, string>> | Record<string, string>;
}

export class ShareEnvelopeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(
      `share http ${status} on ${url}: ${body.length > 200 ? body.slice(0, 200) + '…' : body}`,
    );
    this.name = 'ShareEnvelopeHttpError';
  }
}

interface RawEnvelope {
  wrapped_share_b64: string;
  alg: string;
  salt_b64: string;
}

interface RawChallenge {
  nonce: string;
  expires_at: number;
}

interface RawEscrowUnwrap {
  wrapped_share_b64: string;
  pepper_b64: string;
}

export class ShareEnvelopeHttpAdapter implements ShareEnvelopePort {
  readonly #cfg: ShareEnvelopeHttpConfig;

  constructor(cfg: ShareEnvelopeHttpConfig) {
    this.#cfg = cfg;
  }

  async fetchEnvelope(req: ShareUnwrapRequest): Promise<{
    wrappedShare: Uint8Array;
    alg: string;
    salt: Uint8Array;
  }> {
    const qs = new URLSearchParams({
      credential_id: req.credentialId,
      surface_key: req.surfaceKeyId,
      scheme: req.scheme,
    });
    const raw = await this.#request<RawEnvelope>(
      'GET',
      `envelope?${qs.toString()}`,
    );
    return {
      wrappedShare: base64ToBytes(raw.wrapped_share_b64),
      alg: raw.alg,
      salt: base64ToBytes(raw.salt_b64),
    };
  }

  async startEscrow(req: ShareUnwrapRequest): Promise<{
    nonce: string;
    expiresAt: number;
  }> {
    const raw = await this.#request<RawChallenge>(
      'POST',
      'escrow/challenge',
      {
        credential_id: req.credentialId,
        surface_key: req.surfaceKeyId,
        scheme: req.scheme,
      },
    );
    return { nonce: raw.nonce, expiresAt: raw.expires_at };
  }

  async finishEscrow(
    req: ShareUnwrapRequest & {
      readonly assertion: PasskeyAssertion;
      readonly nonce: string;
    },
  ): Promise<{ wrappedShare: Uint8Array; pepper: Uint8Array }> {
    const raw = await this.#request<RawEscrowUnwrap>(
      'POST',
      'escrow/unwrap',
      {
        credential_id: req.credentialId,
        surface_key: req.surfaceKeyId,
        scheme: req.scheme,
        nonce: req.nonce,
        assertion: {
          credential_id: req.assertion.credentialId,
          client_data_json: req.assertion.clientDataJson,
          authenticator_data: req.assertion.authenticatorData,
          signature: req.assertion.signature,
        },
      },
    );
    return {
      wrappedShare: base64ToBytes(raw.wrapped_share_b64),
      pepper: base64ToBytes(raw.pepper_b64),
    };
  }

  // --- internals ---

  async #request<TRes>(
    method: 'GET' | 'POST',
    action: string,
    body?: unknown,
  ): Promise<TRes> {
    const f = this.#cfg.fetch ?? globalThis.fetch;
    const url = this.#cfg.baseUrl.replace(/\/+$/, '') + `/wallet/share/${action}`;
    const extraHeaders = this.#cfg.headers ? await this.#cfg.headers() : {};
    const headers: Record<string, string> = { ...extraHeaders };
    if (method === 'POST') headers['content-type'] = 'application/json';
    const res = await f(url, {
      method,
      headers,
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ShareEnvelopeHttpError(res.status, url, text);
    }
    if (res.status === 204) return undefined as TRes;
    return (await res.json()) as TRes;
  }
}

// ─── base64 helpers ───────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
