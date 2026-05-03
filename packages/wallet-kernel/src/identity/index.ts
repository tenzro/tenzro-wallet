export { asTdipDid, formatTdipDid, parseTdipDid } from './did.ts';
export { provisionIdentity } from './provision.ts';
export type { ProvisionOptions } from './provision.ts';
export {
  DELEGATE_SET_DEFAULT_K,
  DELEGATE_SET_DEFAULT_N,
  DELEGATE_SET_MAX_N,
  DELEGATE_SET_OPTIONS,
  defaultDelegateSet,
  validateDelegateSet,
} from './delegate-set.ts';
export type {
  DelegateSetConfig,
  DelegateSetSizeOption,
} from './delegate-set.ts';
export { walletNew } from './wallet-new.ts';
export type {
  DeviceShareStore,
  PasskeyEnroller,
  PasskeyEnrolment,
  ProvisioningPort,
  WalletNewOptions,
  WalletNewResult,
  WalletThresholdRecord,
  WrappedDeviceShare,
} from './wallet-new.ts';
export { walletRecover } from './wallet-recover.ts';
export type {
  RecoveryPort,
  RecoveryProof,
  WalletRecoverOptions,
  WalletRecoverResult,
} from './wallet-recover.ts';
