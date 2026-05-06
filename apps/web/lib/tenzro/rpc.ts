/**
 * Browser-side JSON-RPC 2.0 client for the live Tenzro testnet.
 *
 * Two flavors:
 *  - `rpcCall(method, params)` — public reads, no auth header.
 *  - `rpcCallAuthed(method, params, {jwt, dpopProof})` — writes that
 *    require the DPoP-bound JWT scheme (RFC 9449). The caller is
 *    responsible for minting the proof against the same key the JWT
 *    was issued against (see `./dpop`).
 *
 * Errors: JSON-RPC errors raise `RpcError` carrying `{code, data}` so
 * callers can branch on `-32601` (method not found) etc. without
 * string-matching the message.
 */

import { TENZRO_RPC_URL } from './config';

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let nextId = 1;

async function call<T>(method: string, params: unknown, headers: HeadersInit): Promise<T> {
  const id = nextId++;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const res = await fetch(TENZRO_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new RpcError(res.status, `HTTP ${res.status}: ${text || res.statusText}`);
  }
  const json = (await res.json()) as JsonRpcResponse<T>;
  if (json.error) {
    throw new RpcError(json.error.code, json.error.message, json.error.data);
  }
  if (json.result === undefined) {
    throw new RpcError(-32603, 'JSON-RPC response missing both result and error');
  }
  return json.result;
}

export function rpcCall<T = unknown>(method: string, params: unknown = []): Promise<T> {
  return call<T>(method, params, {});
}

/**
 * Public RPC call that also presents a DPoP proof header — used on
 * onboarding to bind the issued JWT to our key (server checks the
 * proof's JWK and pins `cnf.jkt` accordingly). No `Authorization`
 * header because there's no token yet.
 */
export function rpcCallWithProof<T = unknown>(
  method: string,
  params: unknown,
  dpopProof: string,
): Promise<T> {
  return call<T>(method, params, { DPoP: dpopProof });
}

export interface AuthedRpcOpts {
  /** DPoP-bound JWT issued by `tenzro_onboardHuman` / similar. */
  readonly jwt: string;
  /**
   * JWS-compact DPoP proof for *this exact* request. Mint with
   * `mintDpopProof()` from `./dpop` — htu must be the RPC URL, htm
   * the HTTP method (POST), and `ath` the SHA-256 of `jwt` (since
   * we're presenting an access token).
   */
  readonly dpopProof: string;
}

export function rpcCallAuthed<T = unknown>(
  method: string,
  params: unknown,
  { jwt, dpopProof }: AuthedRpcOpts,
): Promise<T> {
  return call<T>(method, params, {
    Authorization: `DPoP ${jwt}`,
    DPoP: dpopProof,
  });
}
