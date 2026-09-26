/**
 * React hooks over the Tenzro Network 1 integration. `useWallet()` is the
 * bottom of the stack: the account comes from a passkey (create or sign in)
 * and is remembered on this device as public data only.
 */

'use client';

import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { requestFaucet } from './faucet';
import {
  type TokenBalances,
  getBalance,
  getBlockNumber,
  getChainId,
  getTokenBalance,
  getTransactionHistory,
} from './methods';
import {
  type StoredWallet,
  clearStoredWallet,
  createWallet,
  custody,
  getStoredWallet,
  sendTnzo,
  signIn,
} from './wallet';

interface UseWalletResult {
  readonly wallet: StoredWallet | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly create: (displayName: string) => Promise<StoredWallet>;
  readonly signIn: () => Promise<StoredWallet>;
  readonly reset: () => void;
}

export function useWallet(): UseWalletResult {
  const [wallet, setWallet] = React.useState<StoredWallet | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const qc = useQueryClient();

  React.useEffect(() => {
    setWallet(getStoredWallet());
    setLoading(false);
  }, []);

  const wrap = React.useCallback(async (fn: () => Promise<StoredWallet>) => {
    setLoading(true);
    setError(null);
    try {
      const w = await fn();
      setWallet(w);
      return w;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const create = React.useCallback(
    (displayName: string) => wrap(() => createWallet(displayName)),
    [wrap],
  );
  const doSignIn = React.useCallback(() => wrap(signIn), [wrap]);

  const reset = React.useCallback(() => {
    clearStoredWallet();
    setWallet(null);
    qc.clear();
  }, [qc]);

  return { wallet, loading, error, create, signIn: doSignIn, reset };
}

export function useBalance(address: string | undefined): UseQueryResult<string> {
  return useQuery({
    queryKey: ['tenzro', 'balance', address],
    queryFn: () => getBalance(address as string),
    enabled: !!address,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** Views of the account's TNZO balance on each VM (one balance, several views). */
export function useTokenBalances(address: string | undefined): UseQueryResult<TokenBalances> {
  return useQuery({
    queryKey: ['tenzro', 'tokenBalance', address],
    queryFn: () => getTokenBalance(address as string),
    enabled: !!address,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

export function useTransactionHistory(address: string | undefined) {
  return useQuery({
    queryKey: ['tenzro', 'txhistory', address],
    queryFn: () => getTransactionHistory(address as string),
    enabled: !!address,
    refetchInterval: 30_000,
  });
}

/** Chain id as the node reports it (decimal string). */
export function useChainId() {
  return useQuery({
    queryKey: ['tenzro', 'chainId'],
    queryFn: async () => BigInt(await getChainId()).toString(10),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useBlockNumber() {
  return useQuery({
    queryKey: ['tenzro', 'blockNumber'],
    queryFn: getBlockNumber,
    refetchInterval: 15_000,
  });
}

export function useFaucet(address: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('No wallet address');
      return requestFaucet(address);
    },
    onSuccess: (result) => {
      if (result.success) {
        qc.invalidateQueries({ queryKey: ['tenzro', 'balance', address] });
        qc.invalidateQueries({ queryKey: ['tenzro', 'tokenBalance', address] });
      }
    },
  });
}

export interface SendInput {
  readonly to: string;
  /** Wei, decimal string. */
  readonly amount: string;
}

/** Send TNZO from the passkey account. The passkey prompt is the approval. */
export function useSend(wallet: StoredWallet | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendInput) => {
      if (!wallet) throw new Error('Wallet not initialized');
      if (input.to.toLowerCase() === wallet.account.toLowerCase()) {
        throw new Error('Cannot send to your own address');
      }
      return sendTnzo(wallet, input.to, BigInt(input.amount));
    },
    onSuccess: () => {
      if (!wallet) return;
      qc.invalidateQueries({ queryKey: ['tenzro', 'balance', wallet.account] });
      qc.invalidateQueries({ queryKey: ['tenzro', 'tokenBalance', wallet.account] });
      qc.invalidateQueries({ queryKey: ['tenzro', 'txhistory', wallet.account] });
    },
  });
}

/** Passkeys enrolled on the account and whether it can send yet. */
export function useDevices(wallet: StoredWallet | null) {
  const devices = useQuery({
    queryKey: ['tenzro', 'devices', wallet?.account],
    queryFn: () => custody().listDevices(wallet as StoredWallet),
    enabled: !!wallet,
  });
  return devices;
}

export function useDeviceActions(wallet: StoredWallet | null) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['tenzro', 'devices', wallet?.account] });
  const approver = wallet ? { id: wallet.credentialId, transports: wallet.transports } : undefined;
  const link = useMutation({
    mutationFn: async (input: { label: string; securityKey?: boolean }) => {
      if (!wallet || !approver) throw new Error('Wallet not initialized');
      return custody().linkDevice({
        account: wallet.account,
        label: input.label,
        // A security key is added from this device and approved here; a new
        // device approves from this one over a QR code.
        ...(input.securityKey ? { crossPlatform: true, approver } : {}),
      });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (credentialIdHex: string) => {
      if (!wallet || !approver) throw new Error('Wallet not initialized');
      return custody().removeDevice({ account: wallet.account, credentialIdHex, approver });
    },
    onSuccess: refresh,
  });
  return { link, remove };
}
