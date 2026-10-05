export type {
  TenzroRpcPort,
  TenzroTxStatus,
  UserOperationReceipt,
} from './tenzro-rpc.ts';
export { TenzroJsonRpcAdapter } from './adapters/tenzro-jsonrpc-adapter.ts';
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
export { verifyPreparedContent, CantonContentMismatchError } from './canton/verify-content.ts';
export type { CantonTransferIntent } from './canton/verify-content.ts';
export { resolveCantonAdapterConfig } from './canton/canton-provider.ts';
export type { CantonProviderConfig } from './canton/canton-provider.ts';

// ── Agent ports + adapters ──
export * from './agent/index.ts';

// ── Secure-Mint registry (1:1 reserve invariant for tokenized RWAs) ──
export * from './secure-mint/index.ts';

// ── Babylon Bitcoin staking ports + adapter ──
// Read-side surface for staking dashboards; write paths exposed for
// validator-operator hosts that use the wallet kernel as the signing
// surface.
export * from './babylon/index.ts';
