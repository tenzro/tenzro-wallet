/**
 * The optional one-time recovery code. Off until the person turns it on.
 * The code is generated in this browser; the account holds only its
 * commitment. It is no key: it signs nothing and can only start a recovery
 * that any linked passkey cancels during its wait. What the person downloads
 * is this code kit, never a key.
 */

import {
  type KeystoreCredential,
  type KeystoreOp,
  generateRecoveryCode,
  recoveryCodeClaim,
  recoveryCodeCommitment,
} from 'tenzro-sdk';

export interface RecoveryCodeSetup {
  readonly code: string;
  readonly op: KeystoreOp;
}

/** A fresh code and the change that puts its commitment on the account. */
export async function newRecoveryCode(account: string): Promise<RecoveryCodeSetup> {
  const code = generateRecoveryCode();
  const commitment = await recoveryCodeCommitment(account, code);
  return { code, op: { set_recovery_code: { commitment } } };
}

export const TURN_OFF_RECOVERY_CODE: KeystoreOp = { set_recovery_code: { commitment: null } };

/** Whether `code` is the one the account committed to. */
export async function matchesCommitment(
  account: string,
  code: string,
  commitment: string,
): Promise<boolean> {
  const c = await recoveryCodeCommitment(account, code);
  return c.replace(/^0x/, '').toLowerCase() === commitment.replace(/^0x/, '').toLowerCase();
}

/** Step one of recovering with the code: the claim binding it to the new passkey. */
export async function claimOp(
  account: string,
  code: string,
  credential: KeystoreCredential,
): Promise<KeystoreOp> {
  return { claim_recovery_code: { claim: await recoveryCodeClaim(account, code, credential) } };
}

/** Step two, once the claim has aged: the code revealed with the same passkey. */
export function revealOp(code: string, credential: KeystoreCredential): KeystoreOp {
  return { recover_with_code: { code, credential } };
}

/** The text file the person keeps. */
export function codeKit(opts: {
  walletName: string;
  origin: string;
  account: string;
  code: string;
  created: Date;
}): string {
  return [
    `${opts.walletName}: one-time recovery code`,
    '',
    `Account: ${opts.account}`,
    `Recovery code: ${opts.code}`,
    `Created: ${opts.created.toISOString().slice(0, 10)}`,
    '',
    'What this is',
    'A one-time code that can start a recovery of this account if you lose',
    'every passkey. It is not a key: it cannot sign or move anything. A',
    'recovery started with it waits before it completes, and any passkey still',
    'on the account can cancel it during that wait.',
    '',
    'How to use it',
    `Open ${opts.origin}/recover on a new device and choose "Recovery code".`,
    'Once used, the code is spent; set a new one afterwards.',
    '',
    'Keep it offline and private. Anyone holding it can start a recovery.',
    '',
  ].join('\n');
}

/** Reads the account and code back from a kit (or from the code alone). */
export function readKit(text: string): { account: string | null; code: string } {
  const account = text.match(/Account:\s*(0x[0-9a-fA-F]{40,64})/)?.[1] ?? null;
  const code =
    text.match(/Recovery code:\s*([0-9a-fA-F]{64})/)?.[1] ??
    text.trim().match(/^([0-9a-fA-F]{64})$/)?.[1];
  if (!code) throw new Error('No recovery code found.');
  return { account, code: code.toLowerCase() };
}
