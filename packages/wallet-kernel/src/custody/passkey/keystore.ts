/**
 * The account's keystore, held in consensus state.
 *
 * A wallet is the person's devices plus this record on the ledger: the
 * passkeys that may act for the account (each with the wallet provider's
 * relying party it is registered on), its policy, its recovery signers and
 * any recovery in progress. Every node answers from the same record, so any
 * linked device works through any node, and the wallet does not depend on
 * this site or on any node.
 *
 * A change is a `KeystoreUpdate` transaction. Its approvals sign
 * {@link keystoreDigest}, which names the account, the commitment of the
 * keystore being changed and the change, so an approval applies once. A
 * transaction the account sends itself, signed by one of its passkeys,
 * counts as that passkey's approval. The digest is computed here, never
 * taken from a node.
 */

import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, fromHex, normalizeHex, toHex, utf8 } from './bytes.ts';
import {
  type CompositeSignatureJson,
  SignatureContext,
  compositeSignatureJson,
  signingDigest,
} from './composite.ts';
import type { JsonRpcTransport } from './rpc.ts';
import type {
  CredentialRef,
  PasskeyAuthenticator,
  PasskeyHint,
  PasskeySignature,
} from './webauthn.ts';

/** One passkey a keystore links. Byte fields are hex. */
export interface KeystoreCredential {
  /** The wallet provider's relying party the passkey is registered on. */
  readonly rp_id: string;
  readonly credential_id: string;
  /** P-256 key, `x || y`. */
  readonly public_key: string;
  readonly aaguid: string;
  readonly backup_eligible: boolean;
  readonly backup_state: boolean;
  /** Block time (ms) from which it counts as a root; set by the network. */
  readonly counts_as_root_from_ms: number;
  /** Block time (ms) it joined the keystore on chain; set by the network, zero until then. */
  readonly added_at_ms?: number;
  readonly label: string;
}

export type SecondFactorPolicy = 'single_credential' | 'two_credentials';
export type RecoveryRole = 'recovery_key' | 'email_verifier' | 'device';

/** A key that may approve the account's recovery. */
export interface RecoverySigner {
  /** A passkey's relying party; empty for a TPM or Secure Enclave key. */
  readonly rp_id: string;
  readonly public_key: string;
  readonly aaguid: string;
  readonly backup_eligible: boolean;
  readonly backup_state: boolean;
  readonly role: RecoveryRole;
  readonly label: string;
}

export interface PendingRecovery {
  readonly credential: KeystoreCredential;
  readonly approvers: readonly number[];
  readonly started_at_ms: number;
  readonly ready_at_ms: number;
}

export interface KeystoreRecord {
  readonly account: string;
  readonly owner_did: string;
  readonly salt: number;
  readonly version: number;
  readonly credentials: readonly KeystoreCredential[];
  readonly policy: SecondFactorPolicy;
  readonly recovery_signers: readonly RecoverySigner[];
  readonly recovery_threshold: number;
  readonly pending_recovery: PendingRecovery | null;
}

/** The account's first passkey, which derives its address. Public data only. */
export interface KeystoreAnchor {
  readonly rp_id: string;
  readonly credential_id: string;
  readonly public_key: string;
  readonly aaguid: string;
  readonly backup_eligible: boolean;
  readonly backup_state: boolean;
  readonly salt: number;
}

export type KeystoreOp =
  | { readonly add_credential: { readonly credential: KeystoreCredential } }
  | { readonly remove_credential: { readonly credential_id: string } }
  | { readonly set_policy: { readonly policy: SecondFactorPolicy } }
  | {
      readonly set_recovery: {
        readonly signers: readonly RecoverySigner[];
        readonly threshold: number;
      };
    }
  | { readonly start_recovery: { readonly credential: KeystoreCredential } }
  | 'cancel_recovery'
  | 'finish_recovery';

export interface KeystoreApproval {
  readonly public_key: string;
  readonly signature: CompositeSignatureJson;
}

export interface KeystoreUpdate {
  readonly account: string;
  readonly anchor: KeystoreAnchor | null;
  readonly previous_commitment: string;
  readonly op: KeystoreOp;
  readonly approvals: readonly KeystoreApproval[];
  readonly possession: CompositeSignatureJson | null;
}

/** `tenzro_getKeystore`. */
export interface KeystoreView {
  readonly account: string;
  readonly on_chain: boolean;
  readonly keystore: KeystoreRecord | null;
  readonly commitment?: string;
  readonly independent_roots?: number;
  readonly may_spend?: boolean;
}

const UPDATE_DOMAIN = 'tenzro/keystore-update/v1';
const ROLE: Record<RecoveryRole, number> = { recovery_key: 1, email_verifier: 2, device: 3 };
const POLICY: Record<SecondFactorPolicy, number> = { single_credential: 1, two_credentials: 2 };

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

const field = (b: Uint8Array): Uint8Array => concatBytes(u32be(b.length), b);

function credentialBytes(c: KeystoreCredential): Uint8Array {
  return concatBytes(
    field(utf8(c.rp_id)),
    field(fromHex(c.credential_id)),
    field(fromHex(c.public_key)),
    field(fromHex(c.aaguid)),
    new Uint8Array([c.backup_eligible ? 1 : 0, c.backup_state ? 1 : 0]),
    field(utf8(c.label)),
  );
}

/** The canonical bytes of `op` an approval covers. */
export function encodeKeystoreOp(op: KeystoreOp): Uint8Array {
  if (op === 'cancel_recovery') return new Uint8Array([5]);
  if (op === 'finish_recovery') return new Uint8Array([6]);
  if ('add_credential' in op)
    return concatBytes(new Uint8Array([1]), credentialBytes(op.add_credential.credential));
  if ('remove_credential' in op) {
    return concatBytes(new Uint8Array([2]), field(fromHex(op.remove_credential.credential_id)));
  }
  if ('set_recovery' in op) {
    const { signers, threshold } = op.set_recovery;
    return concatBytes(
      new Uint8Array([3]),
      u32be(threshold),
      u32be(signers.length),
      ...signers.map((s) =>
        concatBytes(
          field(utf8(s.rp_id)),
          field(fromHex(s.public_key)),
          field(fromHex(s.aaguid)),
          new Uint8Array([s.backup_eligible ? 1 : 0, s.backup_state ? 1 : 0, ROLE[s.role]]),
          field(utf8(s.label)),
        ),
      ),
    );
  }
  if ('start_recovery' in op) {
    return concatBytes(new Uint8Array([4]), credentialBytes(op.start_recovery.credential));
  }
  return new Uint8Array([7, POLICY[op.set_policy.policy]]);
}

/**
 * What every approval of `op` on `account` signs, given the commitment of the
 * keystore it changes: `SHA-256(domain || account || commitment || op)`.
 */
export function keystoreDigest(
  account: string,
  previousCommitment: string,
  op: KeystoreOp,
): Uint8Array {
  return sha256(
    concatBytes(
      utf8(UPDATE_DOMAIN),
      field(fromHex(account)),
      field(fromHex(previousCommitment)),
      encodeKeystoreOp(op),
    ),
  );
}

/** The digest of `update`. */
export const updateDigest = (
  u: Pick<KeystoreUpdate, 'account' | 'previous_commitment' | 'op'>,
): Uint8Array => keystoreDigest(u.account, u.previous_commitment, u.op);

/** The keystore of `account`; with `anchor`, the genesis record of an account with none on chain. */
export function getKeystore(
  rpc: JsonRpcTransport,
  account: string,
  anchor?: KeystoreAnchor,
): Promise<KeystoreView> {
  return rpc.call('tenzro_getKeystore', anchor ? { account, anchor } : { account });
}

/** The accounts whose keystore links the passkey `credentialId` registered on `rpId`. */
export async function resolveCredential(
  rpc: JsonRpcTransport,
  credentialId: string,
  rpId: string,
): Promise<string[]> {
  const r = await rpc.call<{ accounts: string[] }>('tenzro_resolveCredential', {
    credential_id: normalizeHex(credentialId),
    rp_id: rpId,
  });
  return r.accounts;
}

/** An unapproved change naming the keystore's current commitment. */
export async function prepareUpdate(
  rpc: JsonRpcTransport,
  account: string,
  op: KeystoreOp,
  anchor?: KeystoreAnchor,
): Promise<KeystoreUpdate> {
  const view = await getKeystore(rpc, account, anchor);
  if (!view.keystore || !view.commitment) {
    throw new Error(`account ${account} has no keystore on chain and no anchor was given`);
  }
  return {
    account: view.account,
    anchor: view.on_chain ? null : (anchor ?? null),
    previous_commitment: view.commitment,
    op,
    approvals: [],
    possession: null,
  };
}

/** A passkey's signature over the keystore digest, as an approval or a proof of possession. */
export async function signKeystoreDigest(
  authenticator: PasskeyAuthenticator,
  update: KeystoreUpdate,
  allow: readonly CredentialRef[],
  opts: { readonly hybrid?: boolean; readonly hints?: readonly PasskeyHint[] } = {},
): Promise<PasskeySignature> {
  return authenticator.get({
    challenge: signingDigest(SignatureContext.AccountOwner, updateDigest(update)),
    allow,
    ...(opts.hybrid ? { hybrid: true } : {}),
    ...(opts.hints ? { hints: opts.hints } : {}),
  });
}

/** `update` with `signed` added as the approval of the passkey `publicKey`. */
export function withApproval(
  update: KeystoreUpdate,
  publicKey: Uint8Array,
  signed: PasskeySignature,
): KeystoreUpdate {
  return {
    ...update,
    approvals: [
      ...update.approvals,
      { public_key: toHex(publicKey), signature: compositeSignatureJson(signed) },
    ],
  };
}

/** `update` with `signed` as the proof of possession of the passkey it adds. */
export function withPossession(update: KeystoreUpdate, signed: PasskeySignature): KeystoreUpdate {
  return { ...update, possession: compositeSignatureJson(signed) };
}

/** The passkey of `record` with credential id `credentialId`. */
export function credentialOf(
  record: KeystoreRecord | null,
  credentialId: string,
): KeystoreCredential | undefined {
  const want = normalizeHex(credentialId);
  return record?.credentials.find((c) => normalizeHex(c.credential_id) === want);
}
