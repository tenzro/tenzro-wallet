/**
 * React hooks that wrap the Tenzro testnet integration.
 *
 * `useWallet()` is the bottom of the stack — every other hook waits
 * for it before issuing RPC. Onboarding is lazy: the first caller
 * triggers `tenzro_onboardHuman`, subsequent calls hydrate from
 * localStorage.
 */

'use client';

import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { requestFaucet } from './faucet';
import {
  type BridgeTokensArgs,
  type CrossVmTransferArgs,
  type TenzroVm,
  type TokenBalances,
  type WrapTnzoArgs,
  bridgeTokens,
  crossVmTransfer,
  getBalance,
  getBlockNumber,
  getTokenBalance,
  getTransactionHistory,
  signAndSendTransaction,
  wrapTnzo,
} from './methods';
import { type StoredWallet, clearStoredWallet, createWallet, getStoredWallet } from './wallet';

interface UseWalletResult {
  readonly wallet: StoredWallet | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly create: (displayName?: string) => Promise<StoredWallet>;
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

  const create = React.useCallback(async (displayName?: string) => {
    setLoading(true);
    setError(null);
    try {
      const w = await createWallet(displayName);
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

  const reset = React.useCallback(() => {
    clearStoredWallet();
    setWallet(null);
    qc.clear();
  }, [qc]);

  return { wallet, loading, error, create, reset };
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

/**
 * Per-VM projections of the wallet's TNZO balance — native ledger,
 * EVM wTNZO, SVM wTNZO, Canton CIP-56 holding. Same address, four
 * views via the pointer-token model.
 */
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
        qc.invalidateQueries({ queryKey: ['tenzro', 'txhistory', address] });
      }
    },
  });
}

export interface SendInput {
  readonly to: string;
  readonly amount: string;
  readonly asset?: string;
}

export interface CrossVmInput {
  readonly amount: string;
  readonly fromVm: TenzroVm;
  readonly toVm: TenzroVm;
  /** Defaults to the wallet's own address (same-wallet projection move). */
  readonly toAddress?: string;
}

/**
 * Move TNZO between two VM projections of the same wallet (or between
 * two Tenzro wallets, by setting `toAddress`). Internal pointer-token
 * transfer — never leaves Tenzro.
 */
export function useCrossVmTransfer(wallet: StoredWallet | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CrossVmInput) => {
      if (!wallet) throw new Error('Wallet not initialized');
      const args: CrossVmTransferArgs = {
        from_address: wallet.address,
        to_address: input.toAddress ?? wallet.address,
        amount: input.amount,
        from_vm: input.fromVm,
        to_vm: input.toVm,
      };
      return crossVmTransfer(args, wallet.accessToken);
    },
    onSuccess: () => {
      if (!wallet) return;
      qc.invalidateQueries({ queryKey: ['tenzro', 'tokenBalance', wallet.address] });
      qc.invalidateQueries({ queryKey: ['tenzro', 'balance', wallet.address] });
    },
  });
}

export interface WrapInput {
  readonly amount: string;
  readonly toVm: Exclude<TenzroVm, 'native'>;
}

/** Wrap native TNZO into a VM-specific representation. */
export function useWrapTnzo(wallet: StoredWallet | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WrapInput) => {
      if (!wallet) throw new Error('Wallet not initialized');
      const args: WrapTnzoArgs = {
        address: wallet.address,
        amount: input.amount,
        to_vm: input.toVm,
      };
      return wrapTnzo(args, wallet.accessToken);
    },
    onSuccess: () => {
      if (!wallet) return;
      qc.invalidateQueries({ queryKey: ['tenzro', 'tokenBalance', wallet.address] });
    },
  });
}

/**
 * One-shot send: takes a plain `(recipient, amount)` and routes to the
 * right RPC based on address shape. UI doesn't need to know about
 * cross-VM, wrap, or bridge — those are picked here.
 *
 * EVM destinations are ambiguous (the same 20-byte address could be
 * Ethereum, Base, Polygon, …) so the caller must pass `destChain` for
 * those. SVM and Tenzro are unambiguous from the address alone.
 */
export interface SmartSendInput {
  readonly recipient: string;
  readonly amount: string;
  /** Required when the recipient is an EVM address; ignored otherwise. */
  readonly destChain?: string | undefined;
}

export type SmartSendResult =
  | { route: 'tenzro'; tx_hash: string }
  | { route: 'bridge'; status: string; tx_hash?: string | undefined; error?: string | undefined };

export function useSmartSend(wallet: StoredWallet | null) {
  const qc = useQueryClient();
  return useMutation<SmartSendResult, Error, SmartSendInput>({
    mutationFn: async (input) => {
      if (!wallet) throw new Error('Wallet not initialized');
      const { detectAddress } = await import('./address');
      const detected = detectAddress(input.recipient);
      if (detected.kind === 'unknown') throw new Error(detected.reason);

      if (detected.kind === 'tenzro') {
        if (detected.address.toLowerCase() === wallet.address.toLowerCase()) {
          throw new Error('Cannot send to your own address');
        }
        const r = await signAndSendTransaction(
          { from: wallet.address, to: detected.address, amount: input.amount, asset: 'TNZO' },
          wallet.accessToken,
        );
        return { route: 'tenzro', tx_hash: r.tx_hash };
      }

      // EVM/SVM → bridge
      const destChain = detected.kind === 'svm' ? 'solana' : input.destChain;
      if (!destChain) {
        throw new Error('Pick a destination chain for this EVM address');
      }
      const r = await bridgeTokens(
        {
          source_chain: 'tenzro',
          dest_chain: destChain,
          sender: wallet.address,
          recipient: detected.address,
          amount: input.amount,
          asset: 'TNZO',
        },
        wallet.accessToken,
      );
      return { route: 'bridge', status: r.status, tx_hash: r.tx_hash, error: r.error };
    },
    onSuccess: () => {
      if (!wallet) return;
      qc.invalidateQueries({ queryKey: ['tenzro', 'tokenBalance', wallet.address] });
      qc.invalidateQueries({ queryKey: ['tenzro', 'balance', wallet.address] });
      qc.invalidateQueries({ queryKey: ['tenzro', 'txhistory', wallet.address] });
    },
  });
}

export interface BridgeInput {
  readonly destChain: string;
  readonly recipient: string;
  readonly amount: string;
  readonly asset?: string;
}

/**
 * Send to a real external chain via LayerZero V2. Today the testnet's
 * `tenzro_listChains` is empty, so most destinations will surface
 * "No route available" — that's a server-side config gap, not a
 * client bug.
 */
export function useBridgeOut(wallet: StoredWallet | null) {
  return useMutation({
    mutationFn: async (input: BridgeInput) => {
      if (!wallet) throw new Error('Wallet not initialized');
      const args: BridgeTokensArgs = {
        source_chain: 'tenzro',
        dest_chain: input.destChain,
        sender: wallet.address,
        recipient: input.recipient,
        amount: input.amount,
        asset: input.asset ?? 'TNZO',
      };
      return bridgeTokens(args, wallet.accessToken);
    },
  });
}

export function useSend(wallet: StoredWallet | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendInput) => {
      if (!wallet) throw new Error('Wallet not initialized');
      // Server rejects self-sends with "cannot transfer to self" —
      // pre-empt with a clearer client-side message.
      if (input.to.toLowerCase() === wallet.address.toLowerCase()) {
        throw new Error('Cannot send to your own address');
      }
      return signAndSendTransaction(
        {
          from: wallet.address,
          to: input.to,
          amount: input.amount,
          asset: input.asset ?? 'TNZO',
        },
        wallet.accessToken,
      );
    },
    onSuccess: () => {
      if (!wallet) return;
      qc.invalidateQueries({ queryKey: ['tenzro', 'balance', wallet.address] });
      qc.invalidateQueries({ queryKey: ['tenzro', 'txhistory', wallet.address] });
    },
  });
}
