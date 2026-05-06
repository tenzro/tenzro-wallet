/**
 * EIP-6963 announcement payload builder.
 *
 * EIP-6963 specifies how a wallet announces itself to dApps in the
 * browser-extension form factor: the wallet dispatches an
 * `eip6963:announceProvider` event carrying a `{ info, provider }` detail,
 * and listens for `eip6963:requestProvider` to re-announce on demand.
 *
 * Per DESIGN.md §11.6 (resolved), Tenzro Wallet uses EIP-6963 in-page
 * conventions until a Canton CIP for multi-provider discovery lands. The
 * actual `window.dispatchEvent` lives in the browser-extension package
 * (`@tenzro/wallet-extension`, M6) — this module only builds the
 * payload so the announcement can be unit-tested without a DOM and
 * re-used across form factors.
 *
 * The default `rdns` is sourced from `tenzro-sdk`'s `TENZRO_PROVIDER_RDNS`
 * constant — the SDK's `discoverEip6963Provider()` filters on that exact
 * value, so importing it here keeps the announce side and the consume side
 * aligned by construction. If the SDK ever moves the RDNS, the kernel
 * announcement moves with it without a code change here.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-6963
 */

import { TENZRO_PROVIDER_RDNS } from 'tenzro-sdk';

/**
 * The `info` half of an EIP-6963 announcement. The `provider` half is the
 * EIP-1193 object the extension injects; the kernel doesn't construct
 * that — the extension does.
 */
export interface Eip6963ProviderInfo {
  /**
   * UUIDv4 stable across announcements within a page. Per spec, dApps
   * may treat this as a session-scoped wallet identity.
   */
  readonly uuid: string;
  /** Human-readable wallet name displayed in selector UIs. */
  readonly name: string;
  /** Reverse-DNS namespace owned by the wallet vendor. */
  readonly rdns: string;
  /** `data:image/svg+xml;base64,...` (or PNG) wallet icon. */
  readonly icon: string;
}

export interface Eip6963AnnouncementInput {
  readonly uuid: string;
  /** Defaults to "Tenzro Wallet". */
  readonly name?: string;
  /**
   * Defaults to the SDK's `TENZRO_PROVIDER_RDNS` constant
   * (`network.tenzro.wallet`) — the same value `discoverEip6963Provider()`
   * filters on. Override only for staging / preview builds.
   */
  readonly rdns?: string;
  /** Required — no built-in default; the extension supplies the asset. */
  readonly icon: string;
}

/** Tenzro defaults — kernel-default name + rdns matching the docs site. */
const DEFAULT_NAME = 'Tenzro Wallet';
const DEFAULT_RDNS = TENZRO_PROVIDER_RDNS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Build the `info` payload for an `eip6963:announceProvider` event. Pure —
 * no DOM access, no side effects. The browser-extension package consumes
 * this and pairs it with the EIP-1193 provider object before dispatch.
 */
export function buildEip6963Announcement(input: Eip6963AnnouncementInput): Eip6963ProviderInfo {
  if (!UUID_RE.test(input.uuid)) {
    throw new Error(`buildEip6963Announcement: invalid uuid "${input.uuid}" — must be UUIDv1–v5`);
  }
  if (!input.icon || !/^data:image\/(svg\+xml|png|jpeg|webp)/i.test(input.icon)) {
    throw new Error('buildEip6963Announcement: icon must be a data: URL with an image MIME type');
  }
  const rdns = input.rdns ?? DEFAULT_RDNS;
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(rdns)) {
    throw new Error(`buildEip6963Announcement: invalid rdns "${rdns}" — expected reverse-DNS form`);
  }
  return {
    uuid: input.uuid,
    name: input.name ?? DEFAULT_NAME,
    rdns,
    icon: input.icon,
  };
}

/** EIP-6963 event names — exported as constants so consumers don't typo. */
export const EIP6963_ANNOUNCE_EVENT = 'eip6963:announceProvider';
export const EIP6963_REQUEST_EVENT = 'eip6963:requestProvider';
