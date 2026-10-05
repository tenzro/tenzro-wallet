/**
 * Browser JSON-RPC client for Tenzro Network 1, over the network's
 * discovered and checked endpoints (see `./config`). Reads only; everything
 * that moves value or changes custody is signed with the user's passkey (see
 * `./wallet`).
 */

import { RpcClient } from 'tenzro-sdk';
import { JsonRpcError, NetworkTransport } from 'tenzro-wallet/custody';

import { TENZRO_BOOTSTRAP_RPC_URLS, TENZRO_CHAIN_ID } from './config';

export const transport = new NetworkTransport({
  bootstrap: TENZRO_BOOTSTRAP_RPC_URLS,
  chainId: TENZRO_CHAIN_ID,
});

export { JsonRpcError as RpcError };

export function rpcCall<T = unknown>(method: string, params: unknown = []): Promise<T> {
  return transport.call<T>(method, params);
}

/** An SDK client over the same endpoints. */
export function sdkRpc(): RpcClient {
  return new RpcClient(
    TENZRO_BOOTSTRAP_RPC_URLS[0] ?? '',
    undefined,
    undefined,
    transport.sdkTransport,
  );
}

/** The endpoint calls go to now, once discovery has run. */
export function currentEndpoint(): string | null {
  return transport.endpoints()[0] ?? null;
}
