/**
 * AgentPaymentPort — spending policy + per-call agent payment.
 *
 * Agents on Tenzro carry their own spending policies (max-per-tx, daily
 * cap, allowed service types) enforced server-side. The SDK calls
 * `tenzro_setSpendingPolicy` / `tenzro_getSpendingPolicy` and the node
 * runs `SpendingPolicy::is_allowed()` before every transfer. This port
 * exposes those calls plus `payForService` (a one-shot, policy-checked
 * payment from agent → service-provider).
 *
 * The wallet does NOT make policy decisions itself — it asks the node and
 * the node enforces. A malicious wallet client cannot forge a higher
 * limit; the wallet's role is to surface state to the user and originate
 * the call.
 */

export interface AgentSpendingPolicy {
  readonly agentDid: string;
  readonly maxPerTransaction: bigint;
  readonly maxDailySpend: bigint;
  readonly allowedServices: readonly string[];
  readonly active: boolean;
}

export interface SetPolicyRequest {
  readonly agentDid: string;
  readonly maxPerTransaction: bigint;
  readonly maxDailySpend: bigint;
  readonly allowedServices: readonly string[];
  readonly active: boolean;
}

export interface SetPolicyResult {
  readonly agentDid: string;
  readonly status: string;
}

export interface PayForServiceRequest {
  readonly agentDid: string;
  /** Provider's DID or hex address. */
  readonly provider: string;
  readonly amount: bigint;
  /** Free-form service-type tag (e.g. "inference", "rpc-call", "storage"). */
  readonly serviceType: string;
}

export interface AgentPaymentReceipt {
  readonly receiptId: string;
  readonly agentDid: string;
  readonly provider: string;
  readonly amount: bigint;
  readonly serviceType: string;
  readonly txHash: string;
}

export interface DailySpend {
  readonly agentDid: string;
  readonly totalSpent: bigint;
  readonly dailyLimit: bigint;
  readonly remaining: bigint;
  readonly transactionCount: number;
}

export interface AgentTransactionRecord {
  readonly txId: string;
  readonly agentDid: string;
  readonly recipient: string;
  readonly amount: bigint;
  readonly serviceType: string;
  readonly status: string;
}

export interface AgentPaymentPort {
  setSpendingPolicy(req: SetPolicyRequest): Promise<SetPolicyResult>;
  getSpendingPolicy(agentDid: string): Promise<AgentSpendingPolicy | null>;
  payForService(req: PayForServiceRequest): Promise<AgentPaymentReceipt>;
  getDailySpend(agentDid: string): Promise<DailySpend>;
  listAgentTransactions(
    agentDid: string,
    limit?: number,
  ): Promise<readonly AgentTransactionRecord[]>;
}
