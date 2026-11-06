/**
 * An account signs nothing on chain until its ML-DSA-65 key is enrolled in
 * chain state, and the chain verifies a passkey's signatures with that
 * enrolled key. The enrolment is a transaction of the passkey's own account:
 * the account its P-256 key names, which is not the smart account the person
 * sees and which starts with no balance. It pays the fee, so it must be
 * funded once. The key itself is derived from the passkey (see pq.ts), so
 * nothing is stored.
 */

import { AccountKeysClient, type HybridSigner, type RpcClient, accountAddress } from 'tenzro-sdk';

import { toHex } from './bytes';
import type { Passkey } from './passkey';

/** The passkey's own account, `0x` 32-byte slot: where the enrolment fee is paid from. */
export async function feeAccount(passkey: Passkey): Promise<string> {
  const bytes = passkey.publicKey.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? [];
  return `0x${toHex(await accountAddress(Uint8Array.from(bytes)))}`;
}

/** The passkey's account cannot pay the enrolment fee yet. */
export class NeedsFunds extends Error {
  constructor(readonly address: string) {
    super('The account that enrols this passkey’s key holds nothing yet to pay the fee.');
  }
}

/** Enrols the signer's ML-DSA-65 key in chain state; throws {@link NeedsFunds} when the fee cannot be paid. */
export async function enrollOnChain(
  rpc: RpcClient,
  signer: HybridSigner,
  passkey: Passkey,
): Promise<void> {
  try {
    await new AccountKeysClient(rpc).enrollPqKey(signer);
  } catch (e) {
    if (/insufficient balance/i.test(e instanceof Error ? e.message : String(e))) {
      throw new NeedsFunds(await feeAccount(passkey));
    }
    throw e;
  }
}
