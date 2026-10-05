/**
 * Native Tenzro transactions from the account this device's passkey names.
 * The passkey signs each one (a WebAuthn assertion over the transaction's
 * composite digest); nothing else holds a key.
 */

import {
  type HybridSigner,
  RpcClient,
  SettlementClient,
  type SignedTransactionJson,
  type SplitRule,
  type TypedTransaction,
  TypedTxClient,
  accountAddress,
} from 'tenzro-sdk';
import { bytesToHex } from 'tenzro-wallet/custody';

import { TENZRO_RPC_URL } from './config';
import { type StoredWallet, custody } from './wallet';

const rpc = () => new RpcClient(TENZRO_RPC_URL);

async function signer(wallet: StoredWallet): Promise<HybridSigner> {
  return (await custody().transactionSigner(wallet)) as unknown as HybridSigner;
}

/** The 32-byte Tenzro account this device's passkey names, `0x` hex: where payments to it land. */
export async function nativeAccount(wallet: StoredWallet): Promise<string> {
  const s = await custody().transactionSigner(wallet);
  return bytesToHex(await accountAddress(s.p256PublicKey()), true);
}

/** Sets (or, with `null`, clears) the standing split every payment to this account is divided by. */
export async function setPayeeSplit(
  wallet: StoredWallet,
  rule: SplitRule | null,
): Promise<unknown> {
  return new SettlementClient(rpc()).setPayeeSplit(await signer(wallet), rule);
}

/** Signs `tx` with the passkey without submitting it, for the party that asked to submit it. */
export async function signTransaction(
  wallet: StoredWallet,
  tx: TypedTransaction,
): Promise<SignedTransactionJson> {
  return new TypedTxClient(rpc()).sign(await signer(wallet), tx);
}
