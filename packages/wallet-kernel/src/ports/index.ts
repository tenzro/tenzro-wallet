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
