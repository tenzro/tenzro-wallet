/**
 * Agent ports: payments, approvals, attestation, escrow, bonds and fees.
 * Each port is a thin facade over a `tenzro-sdk` client; the SDK is the
 * single source of protocol truth.
 */

// Agent payments
export type {
  AgentPaymentPort,
  AgentTermsChallenge,
  AgentTermsUpdated,
  AgentTermsState,
  UpdateAgentTermsRequest,
} from './agent-payment.ts';
export type {
  AgentTermsWire,
  AssetLimitTerms,
  ContractTerms,
  GovernanceTerms,
  RemoteLimitTerms,
  ServingNodeTerms,
  TermsScope,
} from './agent-terms.ts';
export { agentTermsTarget } from './agent-terms.ts';
export { AgentPaymentSdkAdapter, checkCompletedTerms } from './adapters/agent-payment-adapter.ts';
export type {
  AgentPaymentClientLike,
  AgentTermsClientLike,
} from './adapters/agent-payment-adapter.ts';

// TEE attestation
export type {
  TeeAttestationPort,
  TeeInfo,
  AttestationReport,
  AttestationVerifyResult,
} from './tee-attestation.ts';
export { TeeAttestationSdkAdapter } from './adapters/tee-attestation-adapter.ts';
export type { TeeClientLike } from './adapters/tee-attestation-adapter.ts';

// Native escrow primitive
export type {
  EscrowPort,
  EscrowReleaseMode,
  CreateEscrowRequest,
  ReleaseEscrowRequest,
  RefundEscrowRequest,
  EscrowRecord,
} from './escrow.ts';
export { EscrowSdkAdapter } from './adapters/escrow-adapter.ts';
export type { EscrowClientLike } from './adapters/escrow-adapter.ts';

// HTLC cross-chain escrow (v2-pending — see DESIGN.md §11.7).
export type {
  HtlcEscrowPort,
  HtlcStatus,
  HtlcLockRequest,
  HtlcLockResult,
  HtlcRedeemRequest,
  HtlcRefundRequest,
  HtlcRecord,
} from './htlc-escrow.ts';
export { HtlcEscrowSdkAdapter } from './adapters/htlc-escrow-adapter.ts';
export type { HtlcSdkClientLike } from './adapters/htlc-escrow-adapter.ts';

// ACP (OpenAI Agentic Commerce Protocol) — buyer-side. The adapter wraps a
// structural `AcpClientLike`; when `tenzro-sdk` ships `AcpClient`, swap the
// structural type for the SDK type — wire mapping is unchanged.
export type {
  AcpPort,
  AcpLineItem,
  AcpCheckoutSession,
  AcpAuthorizeRequest,
  AcpAuthorizationResult,
} from './acp.ts';
export { AcpSdkAdapter } from './adapters/acp-adapter.ts';
export type { AcpClientLike } from './adapters/acp-adapter.ts';

// AgentBond (Spec 9) — controller-posted bonds backing autonomous-tier agents.
export type {
  AgentBondPort,
  AgentBondRecord,
  AgentBondState,
  PostAgentBondRequest,
  IncreaseAgentBondRequest,
  WithdrawAgentBondRequest,
} from './agent-bond.ts';
export { AgentBondSdkAdapter } from './adapters/agent-bond-adapter.ts';
export type { BondClientLike } from './adapters/agent-bond-adapter.ts';

// Fee estimator (EIP-1559) — gas / tip / fee-history reads + suggestFees().
export type {
  FeeEstimatorPort,
  FeeHistoryRecord,
  FeeSpeed,
  SuggestedFees,
} from './fee-estimator.ts';
export { FeeEstimatorSdkAdapter } from './adapters/fee-estimator-adapter.ts';
export type { FeeEstimatorClientLike } from './adapters/fee-estimator-adapter.ts';
