/**
 * Minimal `fetch`-based HTTP helpers for the Canton adapter. Browser-clean —
 * uses only the platform `fetch` API. No openapi-fetch dep, no Buffer
 * polyfills, no Node-only globals.
 *
 * Two distinct base URLs talk to one Canton validator deployment:
 *   - Ledger API (`/v2/...`) — port 7575 by default; the JSON Ledger API
 *     every Canton participant exposes.
 *   - Splice validator-app (`/api/validator/v0/...`) — port 5003 by default;
 *     the convenience endpoints for external-party onboarding and Scan
 *     proxying.
 *
 * Both share an Auth0 JWT (audience `https://canton.network.global`,
 * client_credentials grant). The token provider is injected — the kernel
 * doesn't manage the OAuth dance, that lives in the host app or the node-
 * side `/wallet/*` endpoints.
 */

export interface CantonHttpConfig {
  /** Base URL for the JSON Ledger API, e.g. `https://canton.example:7575`. */
  readonly ledgerBaseUrl: string;
  /** Base URL for the Splice validator-app, e.g. `https://canton.example:5003`. */
  readonly validatorBaseUrl: string;
  /**
   * Async token getter. Called per-request — the implementation can cache
   * and refresh as it likes. Throwing here surfaces as a request failure.
   */
  readonly token: () => Promise<string>;
  /**
   * Optional `fetch` override. Defaults to `globalThis.fetch`. Tests inject
   * a mock; real builds typically leave it unset.
   */
  readonly fetch?: typeof fetch;
}

export class CantonHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`canton http ${status} on ${url}: ${truncate(body, 200)}`);
    this.name = 'CantonHttpError';
  }
}

/**
 * POST a JSON body to either base URL and parse the JSON response. Throws
 * `CantonHttpError` on non-2xx; the surface modules let those propagate.
 *
 * `base` selects the URL prefix. The path argument is the suffix
 * (e.g. `/v2/interactive-submission/prepare`).
 */
export async function postJson<TReq, TRes>(
  cfg: CantonHttpConfig,
  base: 'ledger' | 'validator',
  path: string,
  body: TReq,
): Promise<TRes> {
  const baseUrl = base === 'ledger' ? cfg.ledgerBaseUrl : cfg.validatorBaseUrl;
  const url = `${stripTrailingSlash(baseUrl)}${path}`;
  const token = await cfg.token();
  const f = cfg.fetch ?? globalThis.fetch;
  if (!f) throw new Error('canton http: no fetch implementation available');
  const res = await f(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body, replacer),
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new CantonHttpError(res.status, url, text);
  }
  return (await res.json()) as TRes;
}

/** GET a JSON resource. Same auth + error model as `postJson`. */
export async function getJson<TRes>(
  cfg: CantonHttpConfig,
  base: 'ledger' | 'validator',
  path: string,
): Promise<TRes> {
  const baseUrl = base === 'ledger' ? cfg.ledgerBaseUrl : cfg.validatorBaseUrl;
  const url = `${stripTrailingSlash(baseUrl)}${path}`;
  const token = await cfg.token();
  const f = cfg.fetch ?? globalThis.fetch;
  if (!f) throw new Error('canton http: no fetch implementation available');
  const res = await f(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new CantonHttpError(res.status, url, text);
  }
  return (await res.json()) as TRes;
}

/**
 * Open a streaming response (Server-Sent Events shape used by
 * `/v2/commands/completions` and `/v2/updates/flats`). Yields parsed JSON
 * objects line-by-line.
 *
 * Canton's Ledger API streaming format: newline-delimited JSON over a
 * keep-alive HTTP/1.1 connection. No SSE `data:` prefix on the JSON Ledger
 * API path — that's the gRPC bridge's territory.
 */
export async function* streamNdjson<T>(
  cfg: CantonHttpConfig,
  base: 'ledger' | 'validator',
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncIterable<T> {
  const baseUrl = base === 'ledger' ? cfg.ledgerBaseUrl : cfg.validatorBaseUrl;
  const url = `${stripTrailingSlash(baseUrl)}${path}`;
  const token = await cfg.token();
  const f = cfg.fetch ?? globalThis.fetch;
  if (!f) throw new Error('canton http: no fetch implementation available');
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson, application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body, replacer),
    ...(signal !== undefined ? { signal } : {}),
  };
  const res = await f(url, init);
  if (!res.ok) {
    const text = await safeText(res);
    throw new CantonHttpError(res.status, url, text);
  }
  if (!res.body) throw new Error('canton http: streaming response has no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // Flush a trailing line if present.
      const trimmed = buffer.trim();
      if (trimmed.length > 0) yield JSON.parse(trimmed) as T;
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length > 0) yield JSON.parse(line) as T;
      nl = buffer.indexOf('\n');
    }
  }
}

// ─────────────────────────── helpers ───────────────────────────

/**
 * JSON.stringify replacer that handles bigint and Uint8Array — both common
 * in Canton wire payloads (amounts as bigint kernel-side; proto bytes as
 * Uint8Array). Bigint serialises as a decimal string; bytes serialise as
 * standard base64. Canton's JSON Ledger API expects base64 for `bytes`
 * fields per its OpenAPI spec.
 */
function replacer(_k: string, v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return base64Encode(v);
  return v;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Standard base64 (not base64url). Browser-clean, no Buffer dep. */
export function base64Encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  // btoa is universal in browsers and Node 16+.
  return btoa(s);
}

/** Standard base64 decode. */
export function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
