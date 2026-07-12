/**
 * MlDsaHttpAdapter — fetch-based driver against a Tenzro RPC node's
 * `/wallet/mldsa/*` endpoints. Implements the `MlDsaCoordinator` port;
 * mirrors `FrostHttpAdapter` and `PairingHttpAdapter` for shape.
 *
 * Wire shape per `coordinator.ts` header + DESIGN.md §4.3.4 / §11:
 *
 *   GET  /wallet/mldsa/capabilities
 *     reply = { mode: 'tee-only' | 'threshold', public_key? }
 *
 *   POST /wallet/mldsa/sign
 *     body  = { did, surface_key, preimage_b64, purpose? }
 *     reply = { signature_b64 }   // 3293-byte ML-DSA-65 signature
 *
 * As of 2026-05, the node operates in `tee-only` mode (NIST IR 8214C —
 * no audited threshold ML-DSA-65 yet). The threshold-mode round-coord
 * endpoints (`start-round` / `commit` / `respond` / `finalize`) are not
 * surfaced through this adapter because the `MlDsaCoordinator` port
 * itself doesn't expose them yet — they'll land alongside the port
 * extension when threshold ML-DSA matures.
 *
 * Bytes on the wire are standard base64 (RFC 4648 §4) — same convention
 * the FROST + Canton adapters use. The `_b64` suffix on field names is
 * load-bearing.
 *
 * The `/wallet/mldsa/*` endpoints are pre-auth in the same sense as the
 * other `/wallet/*` routes: ML-DSA signing is authenticated by the
 * caller's session (DPoP-bound bearer for M2-style sessions, passkey
 * assertion for M5). Threading auth is the host app's job — the adapter
 * accepts an optional `headers` callback for it.
 *
 * Browser-clean: `fetch` only.
 */

import type {
  MlDsaCapabilities,
  MlDsaCoordinator,
  MlDsaMode,
  MlDsaSignRequest,
  MlDsaSignResult,
} from './coordinator.ts';

export interface MlDsaHttpConfig {
  /** Base URL of the Tenzro RPC node, e.g. `https://rpc.tenzro.xyz`. */
  readonly baseUrl: string;
  /** Optional `fetch` override for tests. */
  readonly fetch?: typeof fetch;
  /**
   * Per-request headers (e.g. `{ Authorization: 'DPoP …', DPoP: '…' }`).
   * Called for every request — let the host rotate proofs as needed.
   * Returning `{}` is fine; the adapter sets `content-type` on writes.
   */
  readonly headers?: () => Promise<Record<string, string>> | Record<string, string>;
}

export class MlDsaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`mldsa http ${status} on ${url}: ${body.length > 200 ? body.slice(0, 200) + '…' : body}`);
    this.name = 'MlDsaHttpError';
  }
}

interface RawCapabilities {
  mode: MlDsaMode;
  public_key?: string;
}

interface RawSign {
  signature_b64: string;
}

export class MlDsaHttpAdapter implements MlDsaCoordinator {
  readonly #cfg: MlDsaHttpConfig;

  constructor(cfg: MlDsaHttpConfig) {
    this.#cfg = cfg;
  }

  async capabilities(): Promise<MlDsaCapabilities> {
    const raw = await this.#request<RawCapabilities>('GET', 'capabilities');
    return {
      mode: raw.mode,
      ...(raw.public_key !== undefined ? { publicKey: raw.public_key } : {}),
    };
  }

  async sign(req: MlDsaSignRequest): Promise<MlDsaSignResult> {
    const raw = await this.#request<RawSign>('POST', 'sign', {
      did: req.did,
      surface_key: req.surfaceKey,
      preimage_b64: bytesToBase64(req.preimage),
      ...(req.purpose !== undefined ? { purpose: req.purpose } : {}),
    });
    return { signature: base64ToBytes(raw.signature_b64) };
  }

  // --- internals ---

  async #request<TRes>(method: 'GET' | 'POST', action: string, body?: unknown): Promise<TRes> {
    const f = this.#cfg.fetch ?? globalThis.fetch;
    const url = this.#cfg.baseUrl.replace(/\/+$/, '') + `/wallet/mldsa/${action}`;
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
      throw new MlDsaHttpError(res.status, url, text);
    }
    if (res.status === 204) return undefined as TRes;
    return (await res.json()) as TRes;
  }
}

// ─── base64 helpers ───────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
