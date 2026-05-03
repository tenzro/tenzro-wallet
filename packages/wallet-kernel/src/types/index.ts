export type {
  AssetId,
  AssetScope,
  AssetView,
  UnifiedBalance,
} from './asset.ts';

export type { Consent, SpendingPolicy } from './consent.ts';

export type {
  DidMethod,
  SurfaceKey,
  TdipDid,
  TdipDidParts,
  TdipIdentity,
  TdipKind,
} from './identity.ts';

export type {
  FeeBreakdown,
  Intent,
  MemoSpec,
  PreparedTx,
  Recipient,
  Reversibility,
  Route,
  SendIntent,
  SignedTx,
  TxHandle,
  TxStatus,
  TxStatusPhase,
} from './intent.ts';
export { MEMO_SPEC_NONE } from './intent.ts';

export type { SigningDriver, SigningRequest, SigningResult, SigningScheme } from './signing-driver.ts';

export {
  SURFACE_IS_ON_TENZRO,
  SURFACE_NATIVE_DECIMALS,
} from './surface.ts';
export type { SurfaceName } from './surface.ts';

export type { SurfaceModule } from './surface-module.ts';
