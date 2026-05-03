/**
 * dApp-facing helpers — payload builders + event names + SDK browser-support
 * re-exports. The actual provider injection lives in
 * `@tenzro/wallet-extension` (M6); the kernel only ships the parts that are
 * pure / DOM-free / unit-testable plus a re-export of the SDK-supplied
 * consume-side helpers so dApp-host code in this repo can pull from one
 * place.
 *
 * Why the re-export lives here: the SDK provides
 * `discoverEip6963Provider` + `TenzroNotInstalledError` +
 * `TENZRO_PROVIDER_RDNS` as the consumer-side counterpart to the
 * announce-side builder in this folder. Co-locating them keeps "the kernel
 * is the only thing that touches `tenzro-sdk`" rule intact (any host that
 * just needs to *consume* an injected provider can depend on the kernel
 * instead of a second SDK install).
 */

export {
  buildEip6963Announcement,
  EIP6963_ANNOUNCE_EVENT,
  EIP6963_REQUEST_EVENT,
} from './eip6963.ts';
export type {
  Eip6963ProviderInfo,
  Eip6963AnnouncementInput,
} from './eip6963.ts';

// SDK-supplied consume-side helpers — see `tenzro-sdk/dist/eip6963.d.ts`
// and `tenzro-sdk/dist/rpc.d.ts`. The kernel re-exports rather than
// re-implements so the SDK stays the single source of truth for the
// `network.tenzro.wallet` RDNS, the discovery timeout semantics, and the
// `Eip1193Transport` wire shape.
export {
  TENZRO_PROVIDER_RDNS,
  discoverEip6963Provider,
  TenzroNotInstalledError,
  Eip1193Transport,
} from 'tenzro-sdk';
export type {
  EIP1193Provider,
  EIP6963ProviderInfo,
  EIP6963ProviderDetail,
  RpcTransport,
} from 'tenzro-sdk';
