/**
 * TenzroJsonRpcAdapter — `TenzroRpcPort` over plain JSON-RPC.
 *
 * Uses the custody module's transport, so custody ceremonies and sending go
 * through the same discovered, checked endpoints.
 */

import {
  type HybridSigner,
  type RpcClient,
  type SignedTransactionJson,
  type TypedTransaction,
  TypedTxClient,
} from 'tenzro-sdk';

import {
  type JsonRpcTransport,
  NetworkTransport,
  type NetworkTransportOptions,
  parseQuantity,
} from '../../custody/passkey/rpc.ts';
import type { TenzroRpcPort, TransactionReceipt } from '../tenzro-rpc.ts';

const hex = (bytes: readonly number[]) =>
  `0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;

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

  async getGasPrice(): Promise<bigint> {
    return parseQuantity(await this.#rpc.call<string>('eth_gasPrice', []));
  }

  signTransaction(signer: HybridSigner, tx: TypedTransaction): Promise<SignedTransactionJson> {
    return new TypedTxClient(this.#rpc as unknown as RpcClient).sign(signer, tx);
  }

  async sendTransaction(signed: SignedTransactionJson): Promise<string> {
    const t = signed.transaction;
    return this.#rpc.call<string>('tenzro_sendRawTransaction', {
      from: hex(t.from),
      to: hex(t.to),
      nonce: t.nonce,
      chain_id: t.chain_id,
      gas_limit: t.gas_limit,
      gas_price: t.gas_price,
      timestamp: t.timestamp,
      valid_until: t.valid_until,
      tx_type: t.tx_type,
      public_key: signed.public_key,
      signature: signed.signature,
    });
  }

  async getTransactionReceipt(hash: string): Promise<TransactionReceipt | null> {
    const r = await this.#rpc.call<{ status?: string } | null>('eth_getTransactionReceipt', [hash]);
    if (!r) return null;
    return { hash, success: r.status === '0x1' };
  }
}
