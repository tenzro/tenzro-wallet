/**
 * NanopaymentSdkAdapter — wraps the SDK's `NanopaymentClient`.
 *
 * snake_case + decimal-string ↔ camelCase + bigint shape mapping. The
 * channel cryptography (signed off-chain receipts, dispute path) all lives
 * server-side; the wallet just originates open / send / flush / close calls.
 */

import type { NanopaymentClient } from 'tenzro-sdk';
import type {
  BatchSettlement,
  CloseChannelResult,
  NanoChannel,
  NanopaymentPort,
  NanopaymentReceipt,
  OpenChannelRequest,
  SendNanopaymentRequest,
} from '../nanopayment.ts';

interface RawChannelInfo {
  channel_id: string;
  payer: string;
  payee: string;
  deposit: string;
  balance: string;
  total_paid: string;
  asset: string;
  payment_count: number;
  status: 'open' | 'closing' | 'closed' | 'disputed';
}

interface RawNanopaymentReceipt {
  payment_id: string;
  channel_id: string;
  amount: string;
  memo?: string;
  sequence: number;
}

interface RawBatchSettlement {
  channel_id: string;
  payment_count: number;
  total_amount: string;
  tx_hash: string;
  status: string;
}

interface RawCloseResult {
  channel_id: string;
  final_amount: string;
  refunded: string;
  tx_hash: string;
  status: string;
}

export interface NanopaymentClientLike {
  openChannel(
    payer: string,
    payee: string,
    deposit: string,
    asset?: string,
  ): Promise<RawChannelInfo>;
  sendNanopayment(
    channelId: string,
    amount: string,
    memo?: string,
  ): Promise<RawNanopaymentReceipt>;
  flushBatch(channelId: string): Promise<RawBatchSettlement>;
  closeChannel(channelId: string): Promise<RawCloseResult>;
  getChannel(channelId: string): Promise<RawChannelInfo>;
  listChannels(address: string): Promise<RawChannelInfo[]>;
}

function mapChannel(raw: RawChannelInfo): NanoChannel {
  return {
    channelId: raw.channel_id,
    payer: raw.payer,
    payee: raw.payee,
    deposit: BigInt(raw.deposit),
    balance: BigInt(raw.balance),
    totalPaid: BigInt(raw.total_paid),
    asset: raw.asset,
    paymentCount: raw.payment_count,
    status: raw.status,
  };
}

export class NanopaymentSdkAdapter implements NanopaymentPort {
  constructor(private readonly client: NanopaymentClientLike) {}

  static fromClient(client: NanopaymentClient): NanopaymentSdkAdapter {
    return new NanopaymentSdkAdapter(client as unknown as NanopaymentClientLike);
  }

  async openChannel(req: OpenChannelRequest): Promise<NanoChannel> {
    const raw = await this.client.openChannel(
      req.payer,
      req.payee,
      req.deposit.toString(),
      req.asset ?? 'TNZO',
    );
    return mapChannel(raw);
  }

  async sendNanopayment(req: SendNanopaymentRequest): Promise<NanopaymentReceipt> {
    const raw = await this.client.sendNanopayment(
      req.channelId,
      req.amount.toString(),
      req.memo,
    );
    return {
      paymentId: raw.payment_id,
      channelId: raw.channel_id,
      amount: BigInt(raw.amount),
      ...(raw.memo !== undefined ? { memo: raw.memo } : {}),
      sequence: raw.sequence,
    };
  }

  async flushBatch(channelId: string): Promise<BatchSettlement> {
    const raw = await this.client.flushBatch(channelId);
    return {
      channelId: raw.channel_id,
      paymentCount: raw.payment_count,
      totalAmount: BigInt(raw.total_amount),
      txHash: raw.tx_hash,
      status: raw.status,
    };
  }

  async closeChannel(channelId: string): Promise<CloseChannelResult> {
    const raw = await this.client.closeChannel(channelId);
    return {
      channelId: raw.channel_id,
      finalAmount: BigInt(raw.final_amount),
      refunded: BigInt(raw.refunded),
      txHash: raw.tx_hash,
      status: raw.status,
    };
  }

  async getChannel(channelId: string): Promise<NanoChannel | null> {
    try {
      return mapChannel(await this.client.getChannel(channelId));
    } catch {
      return null;
    }
  }

  async listChannels(participant: string): Promise<readonly NanoChannel[]> {
    const raw = await this.client.listChannels(participant);
    return raw.map(mapChannel);
  }
}
