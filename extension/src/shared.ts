/** Settings the build bakes in, and the public data the extension keeps. */
declare const __WALLET_ORIGIN__: string;
declare const __RPC__: string;
declare const __CHAIN_ID__: number;

export const WALLET_ORIGIN: string = __WALLET_ORIGIN__;
export const RPC_URL: string = __RPC__;
export const CHAIN_ID: number = __CHAIN_ID__;

/** What the extension remembers: public data only, in chrome.storage.local. */
export interface StoredWallet {
  readonly account: string;
  readonly did: string;
}

export async function loadStored(): Promise<StoredWallet | null> {
  const { wallet } = await chrome.storage.local.get('wallet');
  return (wallet as StoredWallet | undefined) ?? null;
}

export async function saveStored(wallet: StoredWallet | null): Promise<void> {
  if (wallet) await chrome.storage.local.set({ wallet });
  else await chrome.storage.local.remove('wallet');
}

export async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

/** Throws unless the node answers for the chain this build was made for. */
export async function checkChain(): Promise<void> {
  const id = Number.parseInt(await rpcCall<string>('eth_chainId'), 16);
  if (id !== CHAIN_ID) throw new Error(`The node answers for chain ${id}, not ${CHAIN_ID}.`);
}
