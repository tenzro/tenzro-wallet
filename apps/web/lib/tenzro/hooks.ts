/**
 * React hooks over the Tenzro Network 1 integration. `useWallet()` is the
 * bottom of the stack: the account comes from a passkey (create or sign in)
 * and is remembered on this device as public data only.
 */

'use client';

import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import type { PasskeyEntryOptions } from 'tenzro-wallet/custody';
import {
  type TokenBalances,
  getBalance,
  getBlockNumber,
  getChainId,
  getTokenBalance,
  getTransactionHistory,
  listDelegatedAgents,
} from './methods';

import {
  type EnteredWallet,
  type StoredWallet,
  clearStoredWallet,
  createWallet,
  custody,
  getStoredWallet,
  saveWallet,
  sendTnzo,
  signIn,
} from './wallet';

interface UseWalletResult {
  readonly wallet: StoredWallet | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly create: (displayName: string, opts?: PasskeyEntryOptions) => Promise<EnteredWallet>;
  readonly signIn: (opts?: PasskeyEntryOptions) => Promise<EnteredWallet>;
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

  const wrap = React.useCallback(async (fn: () => Promise<EnteredWallet>) => {
    setLoading(true);
    setError(null);
    try {
      const w = await fn();
      const { proof: _proof, ...stored } = w;
      setWallet(stored);
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
    (displayName: string, opts?: PasskeyEntryOptions) =>
      wrap(() => createWallet(displayName, opts)),
    [wrap],
  );
  const doSignIn = React.useCallback(
    (opts?: PasskeyEntryOptions) => wrap(() => signIn(opts)),
    [wrap],
  );

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

/** Which device a link adds: a phone over QR, a security key, or the device in use. */
export type DeviceToLink = 'phone' | 'security-key' | 'this-device';

/**
 * Whether this device can hold a passkey itself (a platform authenticator with
 * user verification). `null` until known. Without one, passkeys come from a
 * phone over a QR code or a security key.
 */
export function usePlatformPasskey(): boolean | null {
  const [available, setAvailable] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const pkc = (globalThis as { PublicKeyCredential?: typeof PublicKeyCredential })
      .PublicKeyCredential;
    if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) {
      setAvailable(false);
      return;
    }
    pkc
      .isUserVerifyingPlatformAuthenticatorAvailable()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);
  return available;
}

export function useDeviceActions(wallet: StoredWallet | null) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['tenzro', 'devices', wallet?.account] });
  const approver = wallet ? { id: wallet.credentialId, transports: wallet.transports } : undefined;
  const link = useMutation({
    mutationFn: async (input: { label: string; via: DeviceToLink }) => {
      if (!wallet || !approver) throw new Error('Wallet not initialized');
      const base = { account: wallet.account, label: input.label };
      switch (input.via) {
        // The phone makes its passkey over a QR code; this device approves.
        case 'phone':
          return custody().linkDevice({
            ...base,
            crossPlatform: true,
            hints: ['hybrid'],
            approver,
          });
        case 'security-key':
          return custody().linkDevice({
            ...base,
            crossPlatform: true,
            hints: ['security-key'],
            approver,
          });
        // This device makes its passkey; the device that holds one approves over a QR code.
        case 'this-device': {
          const added = await custody().linkDevice({ ...base, hints: ['client-device'] });
          // From now on this device approves with its own passkey.
          saveWallet({
            did: wallet.did,
            account: wallet.account,
            credentialId: added.credential_id_hex.replace(/^0x/, ''),
            transports: ['internal'],
          });
          return added;
        }
      }
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

/** Agents this identity controls, with their daily limits. */
export function useDelegatedAgents(did: string | undefined) {
  return useQuery({
    queryKey: ['tenzro', 'delegated-agents', did],
    queryFn: () => listDelegatedAgents(did as string),
    enabled: !!did,
    refetchInterval: 30_000,
  });
}
