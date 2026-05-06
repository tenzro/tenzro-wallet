/**
 * AgentPaymentSdkAdapter — wraps the SDK's `AgentPaymentClient`.
 *
 * snake_case + decimal-string ↔ camelCase + bigint shape mapping. The
 * authoritative spending policy lives at the node and is enforced there;
 * the wallet just originates the call.
 */

import type { AgentPaymentClient } from 'tenzro-sdk';
import type {
  AgentPaymentPort,
  AgentPaymentReceipt,
  AgentSpendingPolicy,
  AgentTransactionRecord,
  DailySpend,
  PayForServiceRequest,
  SetPolicyRequest,
  SetPolicyResult,
} from '../agent-payment.ts';

interface RawSpendingPolicy {
  agent_did: string;
  max_per_transaction: string;
  max_daily_spend: string;
  allowed_services: string[];
  active: boolean;
}

interface RawAgentPaymentReceipt {
  receipt_id: string;
  agent_did: string;
  provider: string;
  amount: string;
  service_type: string;
  tx_hash: string;
}

interface RawDailySpend {
  agent_did: string;
  total_spent: string;
  daily_limit: string;
  remaining: string;
  transaction_count: number;
}

interface RawAgentTransaction {
  tx_id: string;
  agent_did: string;
  recipient: string;
  amount: string;
  service_type: string;
  status: string;
}

export interface AgentPaymentClientLike {
  setSpendingPolicy(
    agentDid: string,
    policy: {
      max_per_transaction: string;
      max_daily_spend: string;
      allowed_services: string[];
      active: boolean;
    },
  ): Promise<{ agent_did: string; status: string }>;
  getSpendingPolicy(agentDid: string): Promise<RawSpendingPolicy>;
  payForService(
    agentDid: string,
    provider: string,
    amount: string,
    serviceType: string,
  ): Promise<RawAgentPaymentReceipt>;
  getDailySpend(agentDid: string): Promise<RawDailySpend>;
  listAgentTransactions(agentDid: string, limit?: number): Promise<RawAgentTransaction[]>;
}

function mapPolicy(raw: RawSpendingPolicy): AgentSpendingPolicy {
  return {
    agentDid: raw.agent_did,
    maxPerTransaction: BigInt(raw.max_per_transaction),
    maxDailySpend: BigInt(raw.max_daily_spend),
    allowedServices: raw.allowed_services,
    active: raw.active,
  };
}

export class AgentPaymentSdkAdapter implements AgentPaymentPort {
  constructor(private readonly client: AgentPaymentClientLike) {}

  static fromClient(client: AgentPaymentClient): AgentPaymentSdkAdapter {
    return new AgentPaymentSdkAdapter(client as unknown as AgentPaymentClientLike);
  }

  async setSpendingPolicy(req: SetPolicyRequest): Promise<SetPolicyResult> {
    const raw = await this.client.setSpendingPolicy(req.agentDid, {
      max_per_transaction: req.maxPerTransaction.toString(),
      max_daily_spend: req.maxDailySpend.toString(),
      allowed_services: [...req.allowedServices],
      active: req.active,
    });
    return { agentDid: raw.agent_did, status: raw.status };
  }

  async getSpendingPolicy(agentDid: string): Promise<AgentSpendingPolicy | null> {
    try {
      return mapPolicy(await this.client.getSpendingPolicy(agentDid));
    } catch {
      return null;
    }
  }

  async payForService(req: PayForServiceRequest): Promise<AgentPaymentReceipt> {
    const raw = await this.client.payForService(
      req.agentDid,
      req.provider,
      req.amount.toString(),
      req.serviceType,
    );
    return {
      receiptId: raw.receipt_id,
      agentDid: raw.agent_did,
      provider: raw.provider,
      amount: BigInt(raw.amount),
      serviceType: raw.service_type,
      txHash: raw.tx_hash,
    };
  }

  async getDailySpend(agentDid: string): Promise<DailySpend> {
    const raw = await this.client.getDailySpend(agentDid);
    return {
      agentDid: raw.agent_did,
      totalSpent: BigInt(raw.total_spent),
      dailyLimit: BigInt(raw.daily_limit),
      remaining: BigInt(raw.remaining),
      transactionCount: raw.transaction_count,
    };
  }

  async listAgentTransactions(
    agentDid: string,
    limit?: number,
  ): Promise<readonly AgentTransactionRecord[]> {
    const raw = await this.client.listAgentTransactions(agentDid, limit);
    return raw.map((r) => ({
      txId: r.tx_id,
      agentDid: r.agent_did,
      recipient: r.recipient,
      amount: BigInt(r.amount),
      serviceType: r.service_type,
      status: r.status,
    }));
  }
}
