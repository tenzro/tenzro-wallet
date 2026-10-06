/**
 * The web wallet's passkey account.
 *
 * Non-custodial: the passkey lives in the user's authenticator and signs
 * every approval; no other key exists. The only thing
 * stored on this device is public: the DID, the account address and which
 * passkey this device uses.
 */

import { type HybridSigner, WalletClient } from 'tenzro-sdk';
import {
  BrowserPasskeyAuthenticator,
  type KeystoreSponsor,
  type OwnershipProof,
  type PasskeyAccount,
  PasskeyCustody,
  type PasskeyEntryOptions,
  hexToBytes,
} from 'tenzro-wallet/custody';

import { TENZRO_RP_ID, TENZRO_SPONSOR_URL } from './config';
import { sdkRpc, transport } from './rpc';

const STORAGE_KEY = 'tenzro.wallet.v2';

export type StoredWallet = PasskeyAccount;

/** A wallet just created or signed in to, with the ownership proof a site asked for. */
export type EnteredWallet = StoredWallet & { readonly proof?: OwnershipProof };

let custodySingleton: PasskeyCustody | null = null;

/** A sponsor endpoint that sends an approved keystore change and pays its fee. */
function sponsorAt(url: string): KeystoreSponsor {
  return {
    async submit(update) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update }),
      });
      const body = (await res.json().catch(() => null)) as {
        tx_hash?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.tx_hash)
        throw new Error(body?.error ?? `The sponsor answered HTTP ${res.status}.`);
      return body.tx_hash;
    },
  };
}

export function custody(): PasskeyCustody {
  custodySingleton ??= new PasskeyCustody({
    rpc: transport,
    authenticator: new BrowserPasskeyAuthenticator({ rpId: TENZRO_RP_ID }),
    ...(TENZRO_SPONSOR_URL ? { sponsor: sponsorAt(TENZRO_SPONSOR_URL) } : {}),
  });
  return custodySingleton;
}

export function getStoredWallet(): StoredWallet | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredWallet) : null;
  } catch {
    return null;
  }
}

export function saveWallet(w: StoredWallet): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  } catch {
    // Storage can be unavailable (private mode); the account then lasts for this page.
  }
}

export function clearStoredWallet(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function remember(
  entered: PasskeyAccount & { readonly proof?: OwnershipProof },
  opts: PasskeyEntryOptions,
): EnteredWallet {
  const { proof, ...account } = entered;
  const stored: StoredWallet = opts.hints?.includes('hybrid')
    ? { ...account, onAnotherDevice: true }
    : account;
  saveWallet(stored);
  return proof ? { ...stored, proof } : stored;
}

/**
 * Creates a wallet, or opens the one this device's Tenzro passkey already
 * holds (`existing`): the same passkey never gets a second identity.
 */
export async function createWallet(
  displayName: string,
  opts: PasskeyEntryOptions = {},
): Promise<EnteredWallet & { readonly existing?: boolean }> {
  const { existing, ...made } = await custody().createWallet({ displayName, ...opts });
  const w = remember(made, opts);
  return existing ? { ...w, existing: true } : w;
}

export async function signIn(opts: PasskeyEntryOptions = {}): Promise<EnteredWallet> {
  return remember(await custody().signIn(opts), opts);
}

/**
 * Sends TNZO from the passkey account: a native `Transfer` sent from the
 * account itself, signed on this device by its passkey. The network accepts
 * it from any passkey the account's keystore links, through any node.
 */
export async function sendTnzo(
  wallet: StoredWallet,
  to: string,
  valueWei: bigint,
): Promise<{ txHash: string }> {
  const signer = (await custody().transactionSigner(wallet)) as unknown as HybridSigner;
  const recipient = to.replace(/^0x/, '');
  const txHash = await new WalletClient(sdkRpc()).sendSelfCustody({
    signer,
    from: wallet.account,
    to: recipient.length === 40 ? `0x${recipient}${'00'.repeat(12)}` : `0x${recipient}`,
    value: valueWei,
  });
  return { txHash };
}

export { hexToBytes };
