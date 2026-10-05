/**
 * JSON-RPC 2.0 transport for the custody flows. Every call goes straight to
 * a Tenzro node; there is no wallet backend, and no one endpoint the wallet
 * depends on.
 *
 * The endpoints are the network's staked RPC operators, found on chain from
 * the bootstrap hints with the SDK's discovery: each must answer for the
 * expected chain and agree with the others on its history, and calls fail
 * over between the ones that pass. A hint is only a way in. Calls stay on the
 * endpoint that last answered, so the calls of one custody ceremony reach
 * the node that issued its challenge unless that node stops answering.
 */

import { FailoverTransport, RpcCallError, type RpcTransport, discoverEndpoints } from 'tenzro-sdk';

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

export interface NetworkTransportOptions {
  /** Endpoints to start from: hints only, checked like any other endpoint. */
  readonly bootstrap: readonly string[];
  /** The chain every endpoint must answer for. */
  readonly chainId: number;
  /** Per-request timeout, ms. */
  readonly timeoutMs?: number;
}

export class NetworkTransport implements JsonRpcTransport {
  readonly #opts: NetworkTransportOptions;
  #endpoints: string[] = [];
  #transport: FailoverTransport | null = null;
  #discovering: Promise<FailoverTransport> | null = null;

  constructor(opts: NetworkTransportOptions) {
    if (opts.bootstrap.length === 0)
      throw new Error('the network transport needs at least one bootstrap endpoint');
    this.#opts = opts;
  }

  /** The endpoints calls may go to, the one in use first. Empty before the first call. */
  endpoints(): readonly string[] {
    const t = this.#transport;
    return t ? [t.endpoint, ...this.#endpoints.filter((e) => e !== t.endpoint)] : [];
  }

  /** The same endpoints as an SDK transport, for SDK clients. */
  get sdkTransport(): RpcTransport {
    return { call: (method, params) => this.#raw(method, params ?? []) };
  }

  async call<T>(method: string, params: unknown = []): Promise<T> {
    try {
      return await this.#raw<T>(method, params as unknown[] | Record<string, unknown>);
    } catch (e) {
      if (e instanceof RpcCallError) {
        throw new JsonRpcError(e.code, e.message.replace(/^RPC Error -?\d+: /, ''), e.data);
      }
      throw new JsonRpcError(
        -32000,
        `The Tenzro network could not be reached: ${(e as Error)?.message ?? String(e)}`,
      );
    }
  }

  async #raw<T>(method: string, params: unknown[] | Record<string, unknown>): Promise<T> {
    const transport = await this.#ready();
    try {
      return await transport.call<T>(method, params);
    } catch (e) {
      // Every endpoint failed: find the network again on the next call.
      if (!(e instanceof RpcCallError)) this.#transport = null;
      throw e;
    }
  }

  #ready(): Promise<FailoverTransport> {
    if (this.#transport) return Promise.resolve(this.#transport);
    this.#discovering ??= discoverEndpoints({
      seeds: [...this.#opts.bootstrap],
      chainId: this.#opts.chainId,
      ...(this.#opts.timeoutMs ? { timeout: this.#opts.timeoutMs } : {}),
    })
      .then((found) => {
        this.#endpoints = found.map((e) => e.url);
        this.#transport = new FailoverTransport(this.#endpoints, this.#opts.timeoutMs ?? 30_000);
        return this.#transport;
      })
      .finally(() => {
        this.#discovering = null;
      });
    return this.#discovering;
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
