/**
 * Changes to the account's keystore, built, approved and sent with the SDK.
 *
 * Every change names the keystore's current commitment, so an approval
 * applies once. A change that needs more than this device (a second passkey,
 * a guardian, a recovery key, or another account to send it) travels as a
 * request code the other side pastes in; nothing secret is in it.
 */

import {
  type HybridSigner,
  type KeystoreAnchor,
  KeystoreClient,
  type KeystoreCredential,
  type KeystoreOp,
  type KeystoreUpdate,
  type KeystoreView,
  type RecoverySigner,
  type RpcClient,
  keystoreDigest,
} from 'tenzro-sdk';

import { type Wallet, sameAccount } from './account';
import { fromBase64Url, toBase64Url, toHex } from './bytes';
import { SPONSOR_URL } from './config';

// ── Reading ────────────────────────────────────────────────────────────

export function readKeystore(rpc: RpcClient, wallet: Wallet): Promise<KeystoreView> {
  return new KeystoreClient(rpc).getKeystore(wallet.account, wallet.anchor ?? undefined);
}

/** A passkey still in its waiting period: it signs, but is not yet a root. */
export function isWaiting(credential: KeystoreCredential, nowMs: number): boolean {
  return credential.counts_as_root_from_ms > nowMs;
}

export interface Roots {
  readonly independent: number;
  readonly maySpend: boolean;
  /** Fewer than two independent roots: the wallet asks for a second one. */
  readonly needsSecond: boolean;
}

export function roots(view: KeystoreView): Roots {
  const independent = view.independent_roots ?? 1;
  return { independent, maySpend: view.may_spend ?? false, needsSecond: independent < 2 };
}

// ── High-risk changes ──────────────────────────────────────────────────

function opName(op: KeystoreOp): string {
  return typeof op === 'string' ? op : (Object.keys(op)[0] as string);
}

/**
 * Changes that weaken or reshape who controls the account. Once the account
 * has two independent roots, the wallet asks a second passkey to approve
 * them as well. Unlinking a passkey still in its waiting period is not one:
 * any one other passkey may cancel it.
 */
export function isHighRisk(op: KeystoreOp, view: KeystoreView, nowMs: number): boolean {
  const name = opName(op);
  if (name === 'remove_credential') {
    const id = (op as { remove_credential: { credential_id: string } }).remove_credential
      .credential_id;
    const target = view.keystore?.credentials.find((c) => sameId(c.credential_id, id));
    return !(target && isWaiting(target, nowMs));
  }
  return name === 'set_policy' || name === 'set_recovery' || name === 'set_recovery_code';
}

/** How many distinct passkeys must approve `op` before the wallet sends it. */
export function approvalsNeeded(op: KeystoreOp, view: KeystoreView, nowMs: number): number {
  const twoRoots = roots(view).independent >= 2;
  if (view.keystore?.policy === 'two_credentials' && opName(op) !== 'cancel_recovery') return 2;
  return twoRoots && isHighRisk(op, view, nowMs) ? 2 : 1;
}

function sameId(a: string, b: string): boolean {
  return a.replace(/^0x/, '').toLowerCase() === b.replace(/^0x/, '').toLowerCase();
}

// ── Describing ─────────────────────────────────────────────────────────

/** What a change does, in words, from the change itself. */
export function describe(op: KeystoreOp): string {
  if (op === 'cancel_recovery') return 'Cancel the recovery in progress.';
  if (op === 'finish_recovery') return 'Complete the recovery whose wait has passed.';
  if ('add_credential' in op) {
    const c = op.add_credential.credential;
    return `Link the passkey "${c.label}" (${c.rp_id}) to this account.`;
  }
  if ('remove_credential' in op) return 'Unlink a passkey from this account.';
  if ('set_policy' in op) {
    return op.set_policy.policy === 'two_credentials'
      ? 'Require two passkeys for every change and for spending.'
      : 'Let any one passkey act for the account.';
  }
  if ('set_recovery' in op) {
    const n = op.set_recovery.signers.length;
    return n === 0
      ? 'Remove every guardian and recovery key.'
      : `Set ${n} recovery signer${n === 1 ? '' : 's'}, ${op.set_recovery.threshold} needed to recover.`;
  }
  if ('start_recovery' in op) {
    const c = op.start_recovery.credential;
    return `Start a recovery that adds the passkey "${c.label}" (${c.rp_id}).`;
  }
  if ('set_recovery_code' in op) {
    return op.set_recovery_code.commitment
      ? 'Turn on a one-time recovery code.'
      : 'Turn off the recovery code.';
  }
  if ('claim_recovery_code' in op) return 'Claim the recovery code for a new passkey.';
  if ('recover_with_code' in op) {
    const c = op.recover_with_code.credential;
    return `Recover with the code, adding the passkey "${c.label}" (${c.rp_id}).`;
  }
  return 'An unknown change.';
}

// ── Request codes ──────────────────────────────────────────────────────

export type RequestKind = 'approve' | 'recovery' | 'send';

/**
 * A change on its way between devices or people. `approve`: passkeys of the
 * account approve it. `recovery`: recovery signers approve it. `send`: it is
 * complete and any account may send it.
 */
export interface ChangeRequest {
  readonly kind: RequestKind;
  readonly update: KeystoreUpdate;
}

const PREFIX = 'tzk1.';

export function encodeRequest(req: ChangeRequest): string {
  return PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(req)));
}

export function decodeRequest(code: string): ChangeRequest {
  const text = code.trim();
  if (!text.startsWith(PREFIX)) throw new Error('This is not a request code.');
  let req: ChangeRequest;
  try {
    req = JSON.parse(new TextDecoder().decode(fromBase64Url(text.slice(PREFIX.length))));
  } catch {
    throw new Error('The request code is damaged.');
  }
  const u = req?.update;
  if (
    !['approve', 'recovery', 'send'].includes(req?.kind) ||
    !u ||
    typeof u.account !== 'string' ||
    typeof u.previous_commitment !== 'string' ||
    !Array.isArray(u.approvals) ||
    u.op === undefined
  ) {
    throw new Error('The request code is damaged.');
  }
  return req;
}

/** Whether `publicKey` has already approved `update`. */
export function hasApproved(update: KeystoreUpdate, publicKey: string): boolean {
  return update.approvals.some((a) => sameId(a.public_key, publicKey));
}

/** The digest every approval of `update` signs; shown so two screens can be compared. */
export async function fingerprint(update: KeystoreUpdate): Promise<string> {
  const d = await keystoreDigest(update.account, update.previous_commitment, update.op);
  return toHex(d).slice(0, 16);
}

// ── Sending ────────────────────────────────────────────────────────────

/** How a complete change reaches the chain. */
export interface Sender {
  /** Sent from the account by this device's passkey, which counts as its approval. */
  fromAccount(update: KeystoreUpdate, signer: HybridSigner, account: string): Promise<string>;
  /** Paid by this provider's sponsor, for an account that holds nothing yet. */
  sponsored(update: KeystoreUpdate): Promise<string>;
}

function txHash(result: unknown): string {
  if (typeof result === 'string') return result;
  const r = result as { tx_hash?: string; hash?: string } | null;
  return r?.tx_hash ?? r?.hash ?? '';
}

export function networkSender(rpc: RpcClient, sponsorUrl = SPONSOR_URL): Sender {
  const client = new KeystoreClient(rpc);
  return {
    async fromAccount(update, signer, account) {
      return txHash(await client.send(signer, update, account));
    },
    async sponsored(update) {
      if (!sponsorUrl) {
        throw new Error(
          'This account holds nothing yet and this wallet has no sponsor. Fund the account, or share the request code with someone who will send it.',
        );
      }
      const res = await fetch(sponsorUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update }),
      });
      if (!res.ok) throw new Error(`The sponsor refused the change (${res.status}).`);
      return txHash(await res.json());
    },
  };
}

/**
 * Sends a change this device approves. From the account when it holds a
 * balance (this passkey's signature is its approval); otherwise this
 * passkey approves explicitly and the sponsor pays.
 */
export async function sendChange(
  rpc: RpcClient,
  sender: Sender,
  wallet: Wallet,
  signer: HybridSigner,
  update: KeystoreUpdate,
  balance: bigint,
): Promise<string> {
  if (balance > 0n) return sender.fromAccount(update, signer, wallet.account);
  const approved = hasApproved(update, toHex(signer.p256PublicKey()))
    ? update
    : await new KeystoreClient(rpc).approve(update, signer);
  return sender.sponsored(approved);
}

export type ChangeOutcome =
  | { readonly sent: string }
  | { readonly request: string; readonly waitingFor: 'passkey' };

/**
 * Approves `op` with this device and sends it, or, when the account needs a
 * second passkey for it, returns the request code for the other device.
 */
export async function change(
  rpc: RpcClient,
  sender: Sender,
  wallet: Wallet,
  signer: HybridSigner,
  op: KeystoreOp,
  balance: bigint,
  nowMs: number = Date.now(),
): Promise<ChangeOutcome> {
  const client = new KeystoreClient(rpc);
  const view = await client.getKeystore(wallet.account, wallet.anchor ?? undefined);
  const update = await client.prepare(wallet.account, op, wallet.anchor ?? undefined);
  if (approvalsNeeded(op, view, nowMs) > 1) {
    const approved = await client.approve(update, signer);
    return { request: encodeRequest({ kind: 'approve', update: approved }), waitingFor: 'passkey' };
  }
  return { sent: await sendChange(rpc, sender, wallet, signer, update, balance) };
}

/**
 * Another passkey of the account approves a change a device started. When
 * that completes the approvals it sends the change; otherwise it returns the
 * request code with this approval added, for the next passkey.
 */
export async function coApprove(
  rpc: RpcClient,
  sender: Sender,
  wallet: Wallet,
  signer: HybridSigner,
  req: ChangeRequest,
  balance: bigint,
  nowMs: number = Date.now(),
): Promise<ChangeOutcome> {
  if (req.kind !== 'approve') throw new Error('This request is not for a passkey of the account.');
  if (!sameAccount(req.update.account, wallet.account)) {
    throw new Error('This request is for another account.');
  }
  if (hasApproved(req.update, toHex(signer.p256PublicKey()))) {
    throw new Error('This passkey has already approved it. Open the request on another device.');
  }
  const client = new KeystoreClient(rpc);
  const view = await client.getKeystore(wallet.account, wallet.anchor ?? undefined);
  if (view.commitment && view.commitment !== req.update.previous_commitment) {
    throw new Error('The account changed since this request was made. Start it again.');
  }
  const needed = approvalsNeeded(req.update.op, view, nowMs);
  if (req.update.approvals.length + 1 < needed) {
    const approved = await client.approve(req.update, signer);
    return { request: encodeRequest({ kind: 'approve', update: approved }), waitingFor: 'passkey' };
  }
  return { sent: await sendChange(rpc, sender, wallet, signer, req.update, balance) };
}

// ── Devices ────────────────────────────────────────────────────────────

/** What an existing device hands a new one: the account, and its anchor while not on chain. */
export interface Invite {
  readonly account: string;
  readonly anchor: KeystoreAnchor | null;
}

export function encodeInvite(invite: Invite): string {
  return `tzi1.${toBase64Url(new TextEncoder().encode(JSON.stringify(invite)))}`;
}

export function decodeInvite(text: string): Invite {
  const t = text.trim();
  if (!t.startsWith('tzi1.')) throw new Error('This is not a device invite.');
  try {
    const i = JSON.parse(new TextDecoder().decode(fromBase64Url(t.slice(5)))) as Invite;
    if (typeof i.account === 'string') return { account: i.account, anchor: i.anchor ?? null };
  } catch {
    // fall through
  }
  throw new Error('The device invite is damaged.');
}

/**
 * On the new device: the change that links its passkey, with the passkey's
 * proof of possession. An existing device of the account approves it.
 */
export async function linkRequest(
  rpc: RpcClient,
  invite: Invite,
  credential: KeystoreCredential,
  newPasskey: HybridSigner,
): Promise<string> {
  const client = new KeystoreClient(rpc);
  const update = await client.prepare(
    invite.account,
    { add_credential: { credential } },
    invite.anchor ?? undefined,
  );
  const proved = await client.prove(update, newPasskey);
  return encodeRequest({ kind: 'approve', update: proved });
}

// ── Recovery signers ───────────────────────────────────────────────────

/** A guardian's or recovery key's public card, shared as text. */
export function encodeSigner(signer: RecoverySigner): string {
  return `tzg1.${toBase64Url(new TextEncoder().encode(JSON.stringify(signer)))}`;
}

export function decodeSigner(text: string): RecoverySigner {
  const t = text.trim();
  if (!t.startsWith('tzg1.')) throw new Error('This is not a guardian card.');
  let s: RecoverySigner;
  try {
    s = JSON.parse(new TextDecoder().decode(fromBase64Url(t.slice(5))));
  } catch {
    throw new Error('The guardian card is damaged.');
  }
  if (
    typeof s?.public_key !== 'string' ||
    !/^(0x)?[0-9a-fA-F]{128}$/.test(s.public_key) ||
    !['recovery_key', 'email_verifier', 'device'].includes(s.role)
  ) {
    throw new Error('The guardian card is damaged.');
  }
  return s;
}

/**
 * The recovery signers op. A threshold is at least one and at most the
 * number of signers; with none, recovery by signers is off.
 */
export function setRecoveryOp(signers: RecoverySigner[], threshold: number): KeystoreOp {
  if (signers.length === 0) return { set_recovery: { signers: [], threshold: 0 } };
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > signers.length) {
    throw new Error(`Choose between 1 and ${signers.length} approvals.`);
  }
  const keys = new Set(signers.map((s) => s.public_key.replace(/^0x/, '').toLowerCase()));
  if (keys.size !== signers.length) throw new Error('The same key is listed twice.');
  return { set_recovery: { signers, threshold } };
}

// ── Recovery ───────────────────────────────────────────────────────────

/** On the locked-out device: the recovery that adds its new passkey, with proof of possession. */
export async function recoveryRequest(
  rpc: RpcClient,
  account: string,
  credential: KeystoreCredential,
  newPasskey: HybridSigner,
): Promise<ChangeRequest> {
  const client = new KeystoreClient(rpc);
  const update = await client.prepare(account, { start_recovery: { credential } });
  return { kind: 'recovery', update: await client.prove(update, newPasskey) };
}

/**
 * A guardian or recovery key approves a recovery. Once enough have, the
 * change is complete and goes on as a `send` request.
 */
export async function approveRecovery(
  rpc: RpcClient,
  req: ChangeRequest,
  signer: HybridSigner,
): Promise<ChangeRequest> {
  if (req.kind !== 'recovery') throw new Error('This request is not a recovery.');
  const client = new KeystoreClient(rpc);
  const view = await client.getKeystore(req.update.account);
  const record = view.keystore;
  const key = toHex(signer.p256PublicKey());
  if (!record?.recovery_signers.some((s) => sameId(s.public_key, key))) {
    throw new Error('This passkey is not a recovery signer of that account.');
  }
  if (hasApproved(req.update, key)) throw new Error('This key has already approved it.');
  const update = await client.approveRecovery(req.update, signer);
  const complete = update.approvals.length >= record.recovery_threshold;
  return { kind: complete ? 'send' : 'recovery', update };
}

/** The pending recovery's remaining wait, in ms (zero once it may complete). */
export function recoveryWait(view: KeystoreView, nowMs: number): number | null {
  const p = view.keystore?.pending_recovery;
  return p ? Math.max(0, p.ready_at_ms - nowMs) : null;
}

/** A change any account may send: a claim, a revealed code, or a finish. */
export async function openChange(
  rpc: RpcClient,
  account: string,
  op: KeystoreOp,
  newPasskey?: HybridSigner,
): Promise<ChangeRequest> {
  const client = new KeystoreClient(rpc);
  const update = await client.prepare(account, op);
  return { kind: 'send', update: newPasskey ? await client.prove(update, newPasskey) : update };
}

/**
 * Sends a complete change from this wallet's own account, which pays the
 * fee and authorizes nothing: for someone else's recovery or claim.
 */
export async function relay(
  sender: Sender,
  req: ChangeRequest,
  signer: HybridSigner,
  ownAccount: string,
): Promise<string> {
  if (req.kind !== 'send') throw new Error('This change still needs approvals.');
  if (sameAccount(req.update.account, ownAccount)) {
    throw new Error('A locked account cannot send its own recovery; ask another account.');
  }
  return sender.fromAccount(req.update, signer, ownAccount);
}
