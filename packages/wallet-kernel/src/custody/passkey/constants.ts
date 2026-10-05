/**
 * Canonical constants for Tenzro passkey custody. Shared with every Tenzro
 * app (web console, CLI, desktop, this wallet), so one passkey opens the same
 * identity everywhere and signs in to all of them.
 */

/** WebAuthn relying party id. Configurable per deployment; `tenzro.com` by default. */
export const DEFAULT_RP_ID = 'tenzro.com';
export const DEFAULT_RP_NAME = 'Tenzro';

/** Tenzro Network 1's chain id: every endpoint must answer `eth_chainId` with it. */
export const NETWORK_1_CHAIN_ID = 13380;
/**
 * Where a wallet starts looking for Tenzro Network 1. Hints only: the
 * endpoints in use are the network's staked RPC operators, read from
 * consensus state, and every endpoint is checked against the chain first.
 */
export const BOOTSTRAP_RPC_URLS: readonly string[] = ['https://rpc.tenzro.xyz'];

/** Domain tag of the human DID derivation (`did:tenzro:human:<uuid v8>`). */
export const HUMAN_DID_DOMAIN = 'tenzro/human-did';

/** ERC-7579 WebAuthn validator module installed on every passkey account. */
export const WEBAUTHN_VALIDATOR_ADDRESS = '0x0000000000000000000000000000000000001020';

export const P256_PUBLIC_KEY_BYTES = 64;

/** Node-issued custody challenges are single-use and expire after this many seconds. */
export const CUSTODY_CHALLENGE_TTL_SECS = 300;

/** COSE algorithm id for ES256 (P-256). The only algorithm the network accepts. */
export const COSE_ES256 = -7;
