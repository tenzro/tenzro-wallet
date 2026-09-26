/**
 * Tenzro Network 1 endpoints and WebAuthn settings. Every value can be set
 * per deployment; the chain id is never configured here: it is read from the
 * node (`eth_chainId`).
 */

export const TENZRO_RPC_URL = process.env.NEXT_PUBLIC_TENZRO_RPC_URL || 'https://rpc.tenzro.xyz';
export const TENZRO_API_URL = process.env.NEXT_PUBLIC_TENZRO_API_URL || 'https://api.tenzro.xyz';
export const TENZRO_NETWORK_NAME = 'Tenzro Network 1';

/** WebAuthn relying party id. Must match the node's configured RP id. */
export const TENZRO_RP_ID = process.env.NEXT_PUBLIC_TENZRO_RP_ID || 'tenzro.com';
