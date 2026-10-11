'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { KeystoreView } from 'tenzro-sdk';

import { type Wallet, forgetWallet, loadWallet, saveWallet } from '@/lib/account';
import { readKeystore } from '@/lib/keystore';
import { type Network, network } from '@/lib/network';
import { balanceOf } from '@/lib/send';

interface WalletState {
  readonly ready: boolean;
  readonly wallet: Wallet | null;
  readonly net: Network | null;
  readonly netError: string | null;
  readonly view: KeystoreView | null;
  readonly balance: bigint | null;
  readonly now: number;
  setWallet(wallet: Wallet | null): void;
  refresh(): Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

/** How often every open device re-reads the keystore, so a recovery shows everywhere. */
const POLL_MS = 15_000;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [wallet, setWalletState] = useState<Wallet | null>(null);
  const [net, setNet] = useState<Network | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [view, setView] = useState<KeystoreView | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setWalletState(loadWallet());
    setReady(true);
    network()
      .then(setNet)
      .catch((e: unknown) => setNetError(e instanceof Error ? e.message : String(e)));
  }, []);

  const setWallet = useCallback((w: Wallet | null) => {
    if (w) saveWallet(w);
    else forgetWallet();
    setWalletState(w);
    setView(null);
    setBalance(null);
  }, []);

  const refresh = useCallback(async () => {
    setNow(Date.now());
    if (!net || !wallet) return;
    const [v, b] = await Promise.all([
      readKeystore(net.rpc, wallet),
      balanceOf(net.rpc, wallet.account).catch(() => null),
    ]);
    setView(v);
    setBalance(b);
    if (v.on_chain && wallet.anchor) {
      // The first change is on chain; the anchor is no longer needed.
      const settled = { ...wallet, anchor: null };
      saveWallet(settled);
      setWalletState(settled);
    }
  }, [net, wallet]);

  useEffect(() => {
    refresh().catch(() => undefined);
    const t = setInterval(() => refresh().catch(() => undefined), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const value = useMemo(
    () => ({ ready, wallet, net, netError, view, balance, now, setWallet, refresh }),
    [ready, wallet, net, netError, view, balance, now, setWallet, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}
