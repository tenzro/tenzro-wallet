/**
 * The web wallet's passkey account.
 *
 * Non-custodial: the passkey lives in the user's authenticator and signs
 * every approval; no other key exists. The only thing
 * stored on this device is public: the DID, the account address and which
 * passkey this device uses.
 */

import {
  BrowserPasskeyAuthenticator,
  DEFAULT_USER_OP_GAS,
  type OwnershipProof,
  type PasskeyAccount,
  PasskeyCustody,
  type PasskeyEntryOptions,
  encodeExecuteCall,
  hexToBytes,
  parseQuantity,
  passkeySigningDriver,
  userOperationHash,
  userOperationToJson,
} from 'tenzro-wallet/custody';

import { TENZRO_RP_ID } from './config';
import { transport } from './rpc';

const STORAGE_KEY = 'tenzro.wallet.v2';

export type StoredWallet = PasskeyAccount & {
  /** Signed in with a passkey on another device (a phone over QR); this device holds none yet. */
  readonly onAnotherDevice?: boolean;
};

/** A wallet just created or signed in to, with the ownership proof a site asked for. */
export type EnteredWallet = StoredWallet & { readonly proof?: OwnershipProof };

let custodySingleton: PasskeyCustody | null = null;

export function custody(): PasskeyCustody {
  custodySingleton ??= new PasskeyCustody({
    rpc: transport,
    authenticator: new BrowserPasskeyAuthenticator({ rpId: TENZRO_RP_ID }),
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
 * Sends TNZO from the passkey account: an ERC-4337 UserOperation calling
 * `execute(to, value)`, signed on this device by the passkey, submitted with `eth_sendUserOperation`.
 */
export async function sendTnzo(
  wallet: StoredWallet,
  to: string,
  valueWei: bigint,
): Promise<{ userOpHash: string }> {
  const [chainIdHex, entryPoints, gasPriceHex, account] = await Promise.all([
    transport.call<string>('eth_chainId', []),
    transport.call<string[]>('eth_supportedEntryPoints', []),
    transport.call<string>('eth_gasPrice', []),
    transport.call<{ nonce: number }>('tenzro_getSmartAccount', {
      account_address: wallet.account,
    }),
  ]);
  const entryPoint = entryPoints[0];
  if (!entryPoint) throw new Error('This node serves no EntryPoint.');
  const gasPrice = parseQuantity(gasPriceHex);
  const op = {
    sender: wallet.account,
    nonce: parseQuantity(account.nonce),
    callData: encodeExecuteCall(to, valueWei),
    ...DEFAULT_USER_OP_GAS,
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: gasPrice,
  };
  const hash = userOperationHash(op, parseQuantity(chainIdHex), entryPoint);
  const driver = passkeySigningDriver({
    authenticator: custody().authenticator,
    credentials: () => [{ id: wallet.credentialId, transports: wallet.transports }],
  });
  const { signatures } = await driver.sign({
    did: wallet.did as never,
    surfaceKey: {
      surface: 'tenzro-native',
      scheme: 'webauthn-p256',
      address: wallet.account,
      credentialIds: [wallet.credentialId],
    },
    scheme: 'webauthn-p256',
    preimage: hash,
  });
  const signature = signatures[0];
  if (!signature) throw new Error('The passkey did not sign.');
  const userOpHash = await transport.call<string>('eth_sendUserOperation', [
    userOperationToJson({ ...op, signature }),
    entryPoint,
  ]);
  return { userOpHash };
}

export { hexToBytes };
