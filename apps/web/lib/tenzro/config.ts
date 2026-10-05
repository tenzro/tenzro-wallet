/**
 * Tenzro Network 1 settings. Every value can be set per deployment.
 *
 * The wallet depends on no single endpoint: it starts from the bootstrap
 * hints, reads the network's staked RPC operators from consensus state, and
 * uses only endpoints that answer for `TENZRO_CHAIN_ID` and agree on its
 * history, failing over between them.
 */

import { BOOTSTRAP_RPC_URLS, NETWORK_1_CHAIN_ID } from 'tenzro-wallet/custody';

/** Endpoints to start from, comma-separated. Hints only. */
export const TENZRO_BOOTSTRAP_RPC_URLS: readonly string[] = process.env.NEXT_PUBLIC_TENZRO_RPC_URL
  ? process.env.NEXT_PUBLIC_TENZRO_RPC_URL.split(',')
      .map((u) => u.trim())
      .filter(Boolean)
  : BOOTSTRAP_RPC_URLS;
/** The chain every endpoint must answer for. */
export const TENZRO_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_TENZRO_CHAIN_ID || NETWORK_1_CHAIN_ID,
);
export const TENZRO_NETWORK_NAME = 'Tenzro Network 1';

/** WebAuthn relying party id: this wallet provider's domain. */
export const TENZRO_RP_ID = process.env.NEXT_PUBLIC_TENZRO_RP_ID || 'tenzro.com';
