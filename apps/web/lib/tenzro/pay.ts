/**
 * Paying with the wallet: an x402 paid resource, or a payment challenge a
 * node issued (x402 or MPP). The wallet's account pays, and this device's
 * passkey signs the payment authorization; the network accepts it because
 * the account's keystore links the passkey. Nothing is signed for an amount
 * above the ceiling the person sets.
 */

import { type HybridSigner, type PaymentChallenge, web } from 'tenzro-sdk';

import { sdkRpc } from './rpc';
import { type StoredWallet, custody } from './wallet';

async function signer(wallet: StoredWallet): Promise<HybridSigner> {
  return (await custody().transactionSigner(wallet)) as unknown as HybridSigner;
}

/** Fetches `url`, paying an x402 `tenzro-hybrid` requirement of at most `maxAmount` (smallest unit). */
export async function payX402Resource(
  wallet: StoredWallet,
  url: string,
  maxAmount: bigint,
): Promise<{ status: number; body: string }> {
  const payer = new web.HybridPayer(await signer(wallet), wallet.did, wallet.account);
  const res = await web.payingFetch(payer, { maxAmount })(url);
  const body = await res.text();
  return { status: res.status, body: body.slice(0, 2000) };
}

/** Pays a challenge a node issued (`tenzro_createPaymentChallenge`) and returns the receipt. */
export async function payChallenge(
  wallet: StoredWallet,
  challenge: PaymentChallenge,
): Promise<unknown> {
  const credential = await web.signChallengeCredential(
    challenge,
    await signer(wallet),
    wallet.did,
    undefined,
    wallet.account,
  );
  const [method, params] = web.payRequest(credential);
  return sdkRpc().call(method, params as unknown as Record<string, unknown>);
}
