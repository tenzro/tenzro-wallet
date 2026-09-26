/**
 * Minimal JSON-RPC 2.0 transport for the custody flows. Every call goes
 * straight to a Tenzro node; there is no wallet backend.
 *
 * Custody challenges are issued and consumed by the node that answers, so
 * all calls of one ceremony must reach the same node. Hosts that talk to a
 * load-balanced endpoint can pin a node (`url`) or add an affinity header
 * (`headers`).
 */

import { DEFAULT_RPC_URL } from './constants.ts';

export interface JsonRpcTransport {
  call<T>(method: string, params?: unknown): Promise<T>;
}

export class JsonRpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
  }
}

export interface HttpJsonRpcTransportOptions {
  /** Defaults to `https://rpc.tenzro.xyz`. */
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

export class HttpJsonRpcTransport implements JsonRpcTransport {
  readonly url: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: typeof fetch;
  #nextId = 1;

  constructor(opts: HttpJsonRpcTransportOptions = {}) {
    this.url = opts.url ?? DEFAULT_RPC_URL;
    this.#headers = opts.headers ?? {};
    this.#fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async call<T>(method: string, params: unknown = []): Promise<T> {
    const id = this.#nextId++;
    let res: Response;
    try {
      res = await this.#fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.#headers },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
    } catch (err) {
      throw new JsonRpcError(
        -32000,
        `The Tenzro node could not be reached: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new JsonRpcError(res.status, `HTTP ${res.status}: ${text || res.statusText}`);
    }
    const body = (await res.json()) as {
      result?: T;
      error?: { code: number; message: string; data?: unknown };
    };
    if (body.error) throw new JsonRpcError(body.error.code, body.error.message, body.error.data);
    return body.result as T;
  }
}

/** Parses a JSON-RPC quantity (`"0x…"` hex, decimal string or number) into a bigint. */
export function parseQuantity(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string' && v.length > 0) return BigInt(v);
  throw new Error(`not a JSON-RPC quantity: ${String(v)}`);
}

/** Chain id as the node reports it (`eth_chainId`). Never assume a value. */
export async function readChainId(rpc: JsonRpcTransport): Promise<bigint> {
  return parseQuantity(await rpc.call<string>('eth_chainId', []));
}
