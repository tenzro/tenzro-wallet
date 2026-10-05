/**
 * Native Tenzro transactions from the wallet's account. The account is the
 * one every linked device acts for: each transaction is sent from it and
 * signed by this device's passkey (a WebAuthn assertion over the
 * transaction's composite digest), which the network accepts because the
 * account's keystore links the passkey. Nothing else holds a key.
 */

import {
  type HybridSigner,
  type SignedTransactionJson,
  type SplitRule,
  type TypedTransaction,
  TypedTxClient,
  validateSplitRule,
} from 'tenzro-sdk';

import { sdkRpc } from './rpc';
import { type StoredWallet, custody } from './wallet';

const rpc = sdkRpc;

async function signer(wallet: StoredWallet): Promise<HybridSigner> {
  return (await custody().transactionSigner(wallet)) as unknown as HybridSigner;
}

/** The wallet's account in its 32-byte ledger slot, `0x` hex: where payments to it land. */
export async function nativeAccount(wallet: StoredWallet): Promise<string> {
  const hex = wallet.account.replace(/^0x/, '');
  return `0x${hex.length === 40 ? `${hex}${'00'.repeat(12)}` : hex}`;
}

/** An amount in wei as the network's JSON carries it: a number while exact, else a string. */
export function weiJson(wei: bigint): number | string {
  return wei <= BigInt(Number.MAX_SAFE_INTEGER) || Number(wei).toString() === wei.toString()
    ? Number(wei)
    : wei.toString();
}

/** Sends `tx` from the wallet's account, signed by this device's passkey. */
export async function sendFromAccount(
  wallet: StoredWallet,
  tx: TypedTransaction,
): Promise<unknown> {
  return new TypedTxClient(rpc()).send(await signer(wallet), { ...tx, from: wallet.account });
}

/** Sets (or, with `null`, clears) the standing split every payment to this account is divided by. */
export async function setPayeeSplit(
  wallet: StoredWallet,
  rule: SplitRule | null,
): Promise<unknown> {
  if (rule) validateSplitRule(rule);
  return sendFromAccount(wallet, { kind: 'Payment', fields: { op: { set_split: { rule } } } });
}

/** Signs `tx` from the wallet's account without submitting it, for the party that asked to submit it. */
export async function signTransaction(
  wallet: StoredWallet,
  tx: TypedTransaction,
): Promise<SignedTransactionJson> {
  return new TypedTxClient(rpc()).sign(await signer(wallet), { ...tx, from: wallet.account });
}

/**
 * The bond an agent's Terms need: a share of its spend ceiling (its daily
 * ceiling, else its per-transaction one), 10% unless governance set another.
 * The network checks it when the Terms are recorded and on every action.
 */
export function requiredAgentBondWei(spendCeilingWei: bigint, bps = 1_000n): bigint {
  return (spendCeilingWei / 10_000n) * bps + ((spendCeilingWei % 10_000n) * bps) / 10_000n;
}

/** Posts a bond for an agent this identity roots, from the wallet's account. */
export async function postAgentBond(
  wallet: StoredWallet,
  agentDid: string,
  amountWei: bigint,
): Promise<unknown> {
  return sendFromAccount(wallet, {
    kind: 'PostAgentBond',
    fields: { agent_did: agentDid, controller_did: wallet.did, amount: weiJson(amountWei) },
  });
}

/** Tops up an agent's bond, from the wallet's account. */
export async function increaseAgentBond(
  wallet: StoredWallet,
  agentDid: string,
  amountWei: bigint,
): Promise<unknown> {
  return sendFromAccount(wallet, {
    kind: 'IncreaseAgentBond',
    fields: { agent_did: agentDid, amount: weiJson(amountWei) },
  });
}

/** Starts withdrawing an agent's bond, or returns it once the cooldown has passed. */
export async function withdrawAgentBond(wallet: StoredWallet, agentDid: string): Promise<unknown> {
  return sendFromAccount(wallet, { kind: 'WithdrawAgentBond', fields: { agent_did: agentDid } });
}
