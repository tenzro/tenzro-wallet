export type {
  TenzroRpcPort,
  TenzroSendArgs,
  TenzroTxStatus,
} from './tenzro-rpc.ts';
export {
  TenzroSdkAdapter,
  TenzroNotInstalledError,
} from './adapters/tenzro-sdk-adapter.ts';
export type { TenzroClientLike } from './adapters/tenzro-sdk-adapter.ts';
export type { TenzroIdentityPort } from './tenzro-identity.ts';
export { TenzroIdentityAdapter } from './adapters/tenzro-identity-adapter.ts';
export type { IdentityClientLike } from './adapters/tenzro-identity-adapter.ts';
export type { CrossVmPointerOp } from './cross-vm.ts';
export {
  CROSS_VM_PRECOMPILE,
  decimalsFor,
  truncateForView,
  dustResidual,
} from './cross-vm.ts';

// ── Canton ports + adapter ──
export type {
  CantonValidatorPort,
  PrepareSubmissionRequest,
  PrepareSubmissionResponse,
  ExecuteSubmissionRequest,
  CantonCompletion,
  CompletionFilter,
  ActiveContractsFilter,
  CantonActiveContract,
  TransferPreapproval,
  GenerateTopologyRequest,
  GenerateTopologyResponse,
  SubmitTopologyRequest,
  SetupProposalRequest,
  PrepareAcceptSetupRequest,
  PrepareAcceptSetupResponse,
  SubmitAcceptSetupRequest,
  CantonHashingSchemeVersion,
  CantonSigningScheme,
} from './canton/canton-validator.ts';
export type { CantonIdentityPort, TenzroSurfaceCantonParty } from './canton/canton-identity.ts';
export type { CantonHttpConfig } from './canton/http.ts';
export { CantonHttpError } from './canton/http.ts';
export { LedgerApiAdapter } from './canton/adapters/ledger-api-adapter.ts';
export type { LedgerApiAdapterConfig } from './canton/adapters/ledger-api-adapter.ts';
export {
  preparedTransactionHash,
  topologyBundleHash,
  bytesEqualConstantTime,
} from './canton/hash.ts';

// ── Agent-payments ports + adapters (AP2, ERC-8004, agent-payments, nano) ──
export * from './agent/index.ts';

// ── Bridge router ports + adapter stubs (M8 — see DESIGN.md §10) ──
export * from './bridge/index.ts';

// ── Capital-markets ports + adapters ──
// Regulated capital allocation over tokenized assets (Capital Intents,
// reserve attestations, attested mints).
export * from './capital/index.ts';

// ── Multi-party workflow ports + adapters ──
// Saga workflows with AP2 / x402 / MPP / Stripe SPT / Visa TAP /
// Mastercard Agent Pay mandate binding.
export * from './workflow/index.ts';

// ── EVM primitive ports + adapters ──
// Pectra Type-4 delegation (EIP-7702), Permit2 SignatureTransfer,
// Secure-Mint registry (1:1 reserve invariant for tokenized RWAs).
export * from './eip7702/index.ts';
export * from './permit2/index.ts';
export * from './secure-mint/index.ts';

// ── Extended cross-chain reach ports + adapters ──
// Hyperlane V3 (sovereign Tenzro-ISM), Axelar GMP (Cosmos / Move /
// Stellar / XRPL reach), ERC-7683 intent-based cross-chain orders.
export * from './hyperlane/index.ts';
export * from './axelar/index.ts';
export * from './erc7683/index.ts';

// ── Chain-agnostic discovery ports + adapter ──
// CAIP-2 / CAIP-10 / CAIP-19 per the submitted `tenzro` CASA namespace
// (ChainAgnostic/namespaces#184).
export * from './caip/index.ts';

// ── Babylon Bitcoin staking ports + adapter ──
// Read-side surface for staking dashboards; write paths exposed for
// validator-operator hosts that use the wallet kernel as the signing
// surface.
export * from './babylon/index.ts';

// ── Tenzro Train protocol ports + adapter ──
// Read + write surface for Tenzro Train Phase 4 (Confidential-tier
// sealed-shard pipelines). Constructed with `(read)` for monitoring
// agents, or `(read, write)` for full custodial enrollment +
// gradient submission flows.
export * from './training/index.ts';
