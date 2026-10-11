/**
 * Deployment settings. Every value comes from the environment at build time,
 * so any wallet provider deploys this wallet on its own domain without
 * changing code. Nothing here is secret.
 */

import { NETWORK_CHAIN_ID, NETWORK_SEEDS } from 'tenzro-sdk';

const env = {
  rpId: process.env.NEXT_PUBLIC_WALLET_RP_ID,
  name: process.env.NEXT_PUBLIC_WALLET_NAME,
  seeds: process.env.NEXT_PUBLIC_WALLET_SEEDS,
  second: process.env.NEXT_PUBLIC_WALLET_SECOND_RPC,
  chainId: process.env.NEXT_PUBLIC_WALLET_CHAIN_ID,
  sponsor: process.env.NEXT_PUBLIC_WALLET_SPONSOR_URL,
};

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** The name the wallet shows for itself. */
export const WALLET_NAME = env.name || 'Tenzro Wallet';

/**
 * The WebAuthn relying party passkeys are created on: this provider's
 * domain. Each passkey records it on chain, so no other provider is
 * involved. Defaults to the host the wallet is served from.
 */
export function rpId(): string {
  if (env.rpId) return env.rpId;
  if (typeof window !== 'undefined') return window.location.hostname;
  throw new Error('NEXT_PUBLIC_WALLET_RP_ID is not set');
}

/**
 * Nodes to start from. Hints only: the wallet reads the network's RPC
 * operators from consensus state and uses those that answer for the chain.
 */
export const SEEDS: readonly string[] = list(env.seeds).length ? list(env.seeds) : NETWORK_SEEDS;

/**
 * A node run by another operator that re-derives every approval's effects.
 * When unset, the wallet picks an endpoint of a different operator from the
 * network's list.
 */
export const SECOND_RPC: string | undefined = env.second || undefined;

/** The chain every endpoint must answer for. */
export const CHAIN_ID: number = env.chainId ? Number(env.chainId) : NETWORK_CHAIN_ID;

/**
 * This provider's sponsor, if it runs one: it pays the fee of a keystore
 * change for an account that holds nothing yet (POST `{ update }`, answering
 * `{ tx_hash }`). The approvals in the change are the authority; a sponsor
 * pays and can change nothing.
 */
export const SPONSOR_URL: string | undefined = env.sponsor || undefined;
