/**
 * TenzroJsonRpcAdapter — `TenzroRpcPort` over plain JSON-RPC.
 *
 * Uses the custody module's transport, so custody ceremonies and sending go
 * through the same discovered, checked endpoints.
 */

import {
  type JsonRpcTransport,
  NetworkTransport,
  type NetworkTransportOptions,
  parseQuantity,
} from '../../custody/passkey/rpc.ts';
import type { TenzroRpcPort, UserOperationReceipt } from '../tenzro-rpc.ts';

export class TenzroJsonRpcAdapter implements TenzroRpcPort {
  readonly #rpc: JsonRpcTransport;

  constructor(rpc: JsonRpcTransport) {
    this.#rpc = rpc;
  }

  static fromNetwork(opts: NetworkTransportOptions): TenzroJsonRpcAdapter {
    return new TenzroJsonRpcAdapter(new NetworkTransport(opts));
  }

  async getChainId(): Promise<bigint> {
    return parseQuantity(await this.#rpc.call<string>('eth_chainId', []));
  }

  async getEntryPoint(): Promise<string> {
    const list = await this.#rpc.call<string[]>('eth_supportedEntryPoints', []);
    const first = list[0];
    if (!first) throw new Error('this node serves no EntryPoint');
    return first;
  }

  async getAccountNonce(account: string): Promise<bigint> {
    const acct = await this.#rpc.call<{ nonce: number | string }>('tenzro_getSmartAccount', {
      account_address: account,
    });
    return parseQuantity(acct.nonce);
  }

  async getGasPrice(): Promise<bigint> {
    return parseQuantity(await this.#rpc.call<string>('eth_gasPrice', []));
  }

  sendUserOperation(userOp: Readonly<Record<string, string>>, entryPoint: string): Promise<string> {
    return this.#rpc.call<string>('eth_sendUserOperation', [userOp, entryPoint]);
  }

  getUserOperationReceipt(userOpHash: string): Promise<UserOperationReceipt | null> {
    return this.#rpc.call<UserOperationReceipt | null>('eth_getUserOperationReceipt', [userOpHash]);
  }
}
