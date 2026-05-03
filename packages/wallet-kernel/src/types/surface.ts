/**
 * Surface enumeration and per-surface scoping.
 *
 * "Surface" = where a transaction executes. Tenzro Ledger hosts four surfaces in
 * one runtime (native, EVM, SVM, Canton-internal). Canton MainNet is a separate
 * external ledger reached via the Splice Wallet SDK.
 */

export type SurfaceName =
  | 'tenzro-native'
  | 'evm-on-tenzro'
  | 'svm-on-tenzro'
  | 'canton-internal'
  | 'canton-external';

/**
 * Whether this surface lives inside the Tenzro multi-VM runtime (so cross-VM
 * moves between it and other on-Tenzro surfaces are pointer ops via precompile
 * 0x1003), or is an external ledger requiring real bridge transfers.
 */
export const SURFACE_IS_ON_TENZRO: Record<SurfaceName, boolean> = {
  'tenzro-native': true,
  'evm-on-tenzro': true,
  'svm-on-tenzro': true,
  'canton-internal': true,
  'canton-external': false,
};

/** Default decimal precision per surface for native TNZO display. */
export const SURFACE_NATIVE_DECIMALS: Record<SurfaceName, number> = {
  'tenzro-native': 18,
  'evm-on-tenzro': 18,
  'svm-on-tenzro': 9,
  'canton-internal': 10,
  'canton-external': 10,
};
