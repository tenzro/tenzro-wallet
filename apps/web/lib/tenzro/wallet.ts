/**
 * Per-user wallet store backed by localStorage.
 *
 * The wallet record holds the DID, address, and DPoP-bound JWT minted
 * by `tenzro_onboardHuman`. The accompanying private key for DPoP
 * signing lives in IndexedDB (see `./dpop`) — together they identify
 * the user to the testnet.
 *
 * `getOrCreateWallet()` is the only entry point most callers should
 * touch: it reads from storage if present, otherwise calls onboarding
 * end-to-end (DPoP key → onboarding RPC with proof → persist).
 */

import { TENZRO_DPOP_HTU } from './config';
import { getOrCreateDpopKey, mintDpopProof } from './dpop';
import { rpcCallWithProof } from './rpc';

const STORAGE_KEY = 'tenzro.wallet.v1';

export interface StoredWallet {
  readonly did: string;
  readonly address: string;
  readonly publicKey: string;
  readonly accessToken: string;
  readonly displayName: string;
  readonly createdAt: number;
}

interface OnboardHumanResult {
  identity: {
    did: string;
    identity_type: string;
    display_name: string;
    status: string;
  };
  wallet: {
    wallet_id: string;
    address: string;
    public_key: string;
  };
  access_token: string;
}

export function getStoredWallet(): StoredWallet | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredWallet;
  } catch {
    return null;
  }
}

function saveWallet(w: StoredWallet): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
}

export function clearStoredWallet(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Create a fresh wallet via `tenzro_onboardHuman`.
 *
 * Token binding: the server pins `cnf.jkt` from the `dpop_jwk` *param*
 * — not from the proof header — so we must pass the public JWK in the
 * params. We still send a DPoP proof on the request so the same key is
 * exercised end-to-end (and to keep our request shape uniform with
 * authed calls). htu must be the server's internal bind URL.
 */
export async function createWallet(displayName?: string): Promise<StoredWallet> {
  const { publicJwk } = await getOrCreateDpopKey();
  const proof = await mintDpopProof(TENZRO_DPOP_HTU, 'POST');
  const params: Record<string, unknown> = { dpop_jwk: publicJwk };
  if (displayName) params.display_name = displayName;
  const result = await rpcCallWithProof<OnboardHumanResult>('tenzro_onboardHuman', params, proof);
  const wallet: StoredWallet = {
    did: result.identity.did,
    address: result.wallet.address,
    publicKey: result.wallet.public_key,
    accessToken: result.access_token,
    displayName: result.identity.display_name,
    createdAt: Date.now(),
  };
  saveWallet(wallet);
  return wallet;
}

export async function getOrCreateWallet(displayName?: string): Promise<StoredWallet> {
  const existing = getStoredWallet();
  if (existing) return existing;
  return createWallet(displayName);
}
