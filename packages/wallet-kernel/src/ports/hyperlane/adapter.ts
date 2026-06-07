/**
 * HyperlaneAdapter — `HyperlanePort` backed by `tenzro-sdk` `HyperlaneClient`.
 */

import type { HyperlaneClient } from 'tenzro-sdk';
import type {
  HyperlaneChain,
  HyperlaneDispatchQuote,
  HyperlaneDispatchRequest,
  HyperlaneDispatchResult,
  HyperlaneMessage,
  HyperlanePort,
} from './hyperlane.ts';

export type HyperlaneClientLike = Pick<
  HyperlaneClient,
  'listChains' | 'quoteDispatch' | 'dispatch' | 'getMessage'
>;

export class HyperlaneAdapter implements HyperlanePort {
  constructor(private readonly client: HyperlaneClientLike) {}

  listChains(): Promise<HyperlaneChain[]> {
    return this.client.listChains() as Promise<HyperlaneChain[]>;
  }
  quoteDispatch(req: HyperlaneDispatchRequest): Promise<HyperlaneDispatchQuote> {
    return this.client.quoteDispatch(req as never) as Promise<HyperlaneDispatchQuote>;
  }
  dispatch(req: HyperlaneDispatchRequest): Promise<HyperlaneDispatchResult> {
    return this.client.dispatch(req as never) as Promise<HyperlaneDispatchResult>;
  }
  getMessage(messageId: string): Promise<HyperlaneMessage | null> {
    return this.client.getMessage(messageId) as Promise<HyperlaneMessage | null>;
  }
}
