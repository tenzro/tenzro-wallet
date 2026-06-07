/**
 * HyperlanePort — Hyperlane V3 messaging through the canonical Mailbox
 * with Tenzro's sovereign Tenzro-validator-set ISM (Interchain Security
 * Module).
 *
 * Wallet usage: a 7th vendor on the cross-chain route picker. The
 * wallet asks for a quote, builds a dispatch tx, and tracks the
 * resulting message by id.
 */

export interface HyperlaneChain {
  readonly name: string;
  readonly domain_id: number;
  readonly mailbox?: string;
}

export interface HyperlaneDispatchRequest {
  readonly origin_domain: number;
  readonly destination_domain: number;
  readonly recipient: string;
  readonly body_hex: string;
  readonly sender?: string;
  readonly interchain_gas_payment?: string;
}

export interface HyperlaneDispatchQuote {
  readonly gas_payment: string;
  readonly gas_payment_token: string;
}

export interface HyperlaneDispatchResult {
  readonly message_id: string;
  readonly nonce: number;
  readonly origin_domain: number;
  readonly destination_domain: number;
}

export interface HyperlaneMessage {
  readonly message_id: string;
  readonly nonce: number;
  readonly origin_domain: number;
  readonly destination_domain: number;
  readonly sender: string;
  readonly recipient: string;
  readonly body_hex: string;
  readonly status: string;
}

export interface HyperlanePort {
  listChains(): Promise<HyperlaneChain[]>;
  quoteDispatch(req: HyperlaneDispatchRequest): Promise<HyperlaneDispatchQuote>;
  dispatch(req: HyperlaneDispatchRequest): Promise<HyperlaneDispatchResult>;
  getMessage(messageId: string): Promise<HyperlaneMessage | null>;
}
