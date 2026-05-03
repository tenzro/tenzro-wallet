/**
 * NanopaymentPort — sub-cent streaming payments via channels.
 *
 * Tenzro nanopayment channels let a payer-payee pair settle thousands of
 * sub-cent transfers off-chain, then post a single batched settlement
 * on-chain. Used for per-token LLM streaming, per-API-call pricing, and
 * per-chunk bandwidth payments — the cost basis where on-chain settlement
 * per call would exceed the call value.
 *
 * Protocol details (HTLC-equivalent dispute resolution, deposit locks,
 * batch flushing) live in the node and the SDK's `NanopaymentClient`. The
 * wallet exposes the lifecycle through this port and signs nothing here —
 * the node's hybrid-signing path handles per-channel cryptography.
 */

export type NanoChannelStatus = 'open' | 'closing' | 'closed' | 'disputed';

export interface NanoChannel {
  readonly channelId: string;
  readonly payer: string;
  readonly payee: string;
  /** Initial deposit, smallest units. */
  readonly deposit: bigint;
  /** Currently-locked balance, smallest units. */
  readonly balance: bigint;
  /** Cumulative paid through this channel, smallest units. */
  readonly totalPaid: bigint;
  /** Asset symbol (e.g. 'TNZO', 'CC'). */
  readonly asset: string;
  readonly paymentCount: number;
  readonly status: NanoChannelStatus;
}

export interface OpenChannelRequest {
  readonly payer: string;
  readonly payee: string;
  readonly deposit: bigint;
  /** Defaults to 'TNZO'. */
  readonly asset?: string;
}

export interface SendNanopaymentRequest {
  readonly channelId: string;
  readonly amount: bigint;
  readonly memo?: string;
}

export interface NanopaymentReceipt {
  readonly paymentId: string;
  readonly channelId: string;
  readonly amount: bigint;
  readonly memo?: string;
  readonly sequence: number;
}

export interface BatchSettlement {
  readonly channelId: string;
  readonly paymentCount: number;
  readonly totalAmount: bigint;
  readonly txHash: string;
  readonly status: string;
}

export interface CloseChannelResult {
  readonly channelId: string;
  readonly finalAmount: bigint;
  readonly refunded: bigint;
  readonly txHash: string;
  readonly status: string;
}

export interface NanopaymentPort {
  openChannel(req: OpenChannelRequest): Promise<NanoChannel>;
  sendNanopayment(req: SendNanopaymentRequest): Promise<NanopaymentReceipt>;
  flushBatch(channelId: string): Promise<BatchSettlement>;
  closeChannel(channelId: string): Promise<CloseChannelResult>;
  getChannel(channelId: string): Promise<NanoChannel | null>;
  listChannels(participant: string): Promise<readonly NanoChannel[]>;
}
