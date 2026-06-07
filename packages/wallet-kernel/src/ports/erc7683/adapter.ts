/**
 * Erc7683Adapter — `Erc7683Port` backed by `tenzro-sdk` `Erc7683Client`.
 */

import type { Erc7683Client } from 'tenzro-sdk';
import type { Erc7683Port, ListOrdersOpts, RecordFillRequest } from './erc7683.ts';

export type Erc7683ClientLike = Pick<
  Erc7683Client,
  'getOrder' | 'listOrders' | 'recordFill' | 'getFill' | 'listFills'
>;

export class Erc7683Adapter implements Erc7683Port {
  constructor(private readonly client: Erc7683ClientLike) {}

  getOrder(orderId: string): Promise<unknown> {
    return this.client.getOrder(orderId);
  }
  listOrders(opts: ListOrdersOpts = {}): Promise<unknown> {
    return this.client.listOrders(opts as never);
  }
  recordFill(args: RecordFillRequest): Promise<unknown> {
    return this.client.recordFill(args as never);
  }
  getFill(orderId: string, originChainId: number): Promise<unknown> {
    return this.client.getFill(orderId, originChainId);
  }
  listFills(): Promise<unknown> {
    return this.client.listFills();
  }
}
