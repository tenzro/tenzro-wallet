/**
 * Browser JSON-RPC client for Tenzro Network 1. Reads only; everything that
 * moves value or changes custody is signed with the user's passkey (see
 * `./wallet`).
 */

import { HttpJsonRpcTransport, JsonRpcError } from 'tenzro-wallet/custody';

import { TENZRO_RPC_URL } from './config';

export const transport = new HttpJsonRpcTransport({ url: TENZRO_RPC_URL });

export { JsonRpcError as RpcError };

export function rpcCall<T = unknown>(method: string, params: unknown = []): Promise<T> {
  return transport.call<T>(method, params);
}
