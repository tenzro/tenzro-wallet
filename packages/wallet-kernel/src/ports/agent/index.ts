/**
 * Agent-payments ports — AP2 (FIDO Alliance v0.2), ERC-8004 (mainnet
 * Jan 29 2026), Tenzro spending-policy/agent-payment, and nanopayment
 * channels. Each port is a thin facade over a `tenzro-sdk` client; the
 * SDK is the single source of protocol truth.
 */

// AP2
export type {
  Ap2Port,
  Ap2Vdc,
  Ap2Session,
  Ap2SessionStatus,
  Ap2Authorization,
  Ap2AuthorizationStatus,
  Ap2MandateVerification,
  Ap2MandatePairValidation,
  Ap2PaymentReceipt,
  Ap2CancelResult,
  CreateSessionRequest,
} from './ap2.ts';
export { Ap2SdkAdapter } from './adapters/ap2-adapter.ts';
export type { Ap2ClientLike } from './adapters/ap2-adapter.ts';

// ERC-8004
export type {
  Erc8004Port,
  Erc8004AgentIdHex,
  Erc8004DerivedAgentId,
  Erc8004Calldata,
  Erc8004Agent,
} from './erc8004.ts';
export { Erc8004SdkAdapter } from './adapters/erc8004-adapter.ts';
export type { Erc8004ClientLike } from './adapters/erc8004-adapter.ts';

// Agent payments
export type {
  AgentPaymentPort,
  AgentSpendingPolicy,
  SetPolicyRequest,
  SetPolicyResult,
  PayForServiceRequest,
  AgentPaymentReceipt,
  DailySpend,
  AgentTransactionRecord,
} from './agent-payment.ts';
export { AgentPaymentSdkAdapter } from './adapters/agent-payment-adapter.ts';
export type { AgentPaymentClientLike } from './adapters/agent-payment-adapter.ts';

// Nanopayment
export type {
  NanopaymentPort,
  NanoChannel,
  NanoChannelStatus,
  OpenChannelRequest,
  SendNanopaymentRequest,
  NanopaymentReceipt,
  BatchSettlement,
  CloseChannelResult,
} from './nanopayment.ts';
export { NanopaymentSdkAdapter } from './adapters/nanopayment-adapter.ts';
export type { NanopaymentClientLike } from './adapters/nanopayment-adapter.ts';

// HITL approval queue
export type {
  AuthApprovalPort,
  PendingApproval,
  PendingApprovalsList,
  ApprovalDecisionStatus,
  ApprovalDecisionResult,
} from './auth-approval.ts';
export { AuthApprovalSdkAdapter } from './adapters/auth-approval-adapter.ts';
export type { AuthClientLike } from './adapters/auth-approval-adapter.ts';

// TEE attestation
export type {
  TeeAttestationPort,
  TeeInfo,
  AttestationReport,
  AttestationVerifyResult,
} from './tee-attestation.ts';
export { TeeAttestationSdkAdapter } from './adapters/tee-attestation-adapter.ts';
export type { TeeClientLike } from './adapters/tee-attestation-adapter.ts';

// Session keys (delegated agent scopes, AP2/Mastercard/x402 substrate)
export type {
  SessionKeyPort,
  SessionScope,
  CreateSessionRequest as CreateSessionKeyRequest,
  CreatedSession,
  ActiveSession,
  RevokeSessionRequest,
  RevokeSessionResult,
} from './session-key.ts';
export { SessionKeySdkAdapter } from './adapters/session-key-adapter.ts';
export type { SessionKeyClientLike } from './adapters/session-key-adapter.ts';

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

// ERC-7802 SuperchainERC20 cross-chain mint/burn — supply-consistent moves
// between chains where the token implements ERC-7802 directly (no aggregator).
// Wraps tenzro-sdk Erc7802Client; the SDK performs the operation atomically
// via tenzro_signAndSendTransaction (no calldata returned to the wallet).
export type {
  Erc7802Port,
  Erc7802MintResult,
  Erc7802BurnResult,
  Erc7802SupplyBreakdown,
  CrosschainMintRequest,
  CrosschainBurnRequest,
} from './erc7802.ts';
export { Erc7802SdkAdapter } from './adapters/erc7802-adapter.ts';
export type { Erc7802ClientLike } from './adapters/erc7802-adapter.ts';

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

// Payment rails (MPP / x402 / AP2 / Visa TAP / Mastercard) — settlement only.
// Visa TAP credential signing + Mastercard token issuance + ACP buyer-side
// flow are SDK gaps tracked in DESIGN.md §11; the wallet wraps them when
// the SDK exposes them.
export type {
  PaymentRailsPort,
  PaymentReceipt as PaymentRailReceipt,
  PaymentChallenge,
  CreateChallengeRequest,
  PayMppRequest,
  PayX402Request,
  PayAp2Request,
  PayVisaTapRequest,
  PayMastercardRequest,
  SignVisaTapRequest,
  VisaTapSignedRequest,
  IssueMastercardTokenRequest,
  MastercardToken,
  MastercardTokenKind,
} from './payment-rails.ts';
export { PaymentRailsSdkAdapter } from './adapters/payment-rails-adapter.ts';
export type { PaymentClientLike } from './adapters/payment-rails-adapter.ts';
