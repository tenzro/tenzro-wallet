/**
 * PasskeyCustody: the non-custodial wallet lifecycle for a person.
 *
 *   createWallet   passkey -> DID -> account (tenzro_enrollPasskey stores nothing)
 *   signIn         find the account behind a passkey on any device, through any node
 *   listDevices    the passkeys the account's keystore links
 *   linkDevice     link a passkey on another device or a security key
 *   removeDevice   unlink a passkey (never the last one)
 *   setSecondFactor / addGuardian / startRecovery / finishRecovery / cancelRecovery
 *
 * A wallet is the person's devices plus its keystore on the ledger. Every
 * change to which passkeys act for the account, its policy or its recovery
 * is a `KeystoreUpdate` transaction (see `keystore.ts`) sent from the
 * account itself and signed by one of its passkeys, so any linked device
 * acts alone, through any node, and nothing depends on this site. The wallet
 * stores no secret and derives no key: the passkey lives in the
 * authenticator and its assertions are the only signatures.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import {
  type HybridSigner,
  type RpcClient,
  type TypedTransaction,
  TypedTxClient,
} from 'tenzro-sdk';

import { type AgentTermsWire, agentTermsTarget } from '../../ports/agent/agent-terms.ts';
import { fromHex, normalizeHex, randomBytes, toHex } from './bytes.ts';
import {
  type CompositeSignatureJson,
  SignatureContext,
  compositeSignatureJson,
  signingDigest,
} from './composite.ts';
import { humanDidFromPasskey, recoverAssertionPublicKeys, smartAccountAddress } from './derive.ts';
import {
  type CustodyAuthorization,
  type CustodyChallenge,
  type CustodyOperation,
  authorizeChallenge,
  custodyChallengeDigest,
  requestCustodyChallenge,
} from './gate.ts';
import {
  type GuardianCard,
  type GuardianSource,
  MAX_GUARDIAN_LABEL_BYTES,
  guardianRole,
  registrationProvenance,
} from './guardian.ts';
import {
  type KeystoreAnchor,
  type KeystoreCredential,
  type KeystoreRecord,
  type KeystoreUpdate,
  type KeystoreView,
  type PendingRecovery,
  type RecoverySigner,
  type SecondFactorPolicy,
  credentialOf,
  getKeystore,
  prepareUpdate,
  resolveCredential,
  signKeystoreDigest,
  updateDigest,
  withApproval,
  withPossession,
} from './keystore.ts';
import { getAgentTerms } from './machines.ts';
import { type DeviceSummary, type WalletReadiness, assessReadiness } from './readiness.ts';
import type { JsonRpcTransport } from './rpc.ts';
import { type AgentStepUp, type StepUpRequest, checkStepUp } from './step-up.ts';
import {
  type CredentialRef,
  type PasskeyAuthenticator,
  PasskeyError,
  type PasskeyHint,
  type PasskeySignature,
  type PasskeyTier,
  parseAuthenticatorFlags,
} from './webauthn.ts';

/** What the wallet remembers about an account on one device. Public data only. */
export interface PasskeyAccount {
  readonly did: string;
  /** The account address, 20 bytes, `0x` hex. */
  readonly account: string;
  /** The passkey this device uses, hex. */
  readonly credentialId: string;
  readonly transports: readonly string[];
  readonly tier?: PasskeyTier;
  readonly displayName?: string;
  /** This wallet session approves with a passkey held on another device (hybrid). */
  readonly onAnotherDevice?: boolean;
  /**
   * The account's first passkey, which derives its address. Needed for its
   * first keystore change, before the keystore is on chain.
   */
  readonly anchor?: KeystoreAnchor;
}

export interface EnrollPasskeyResult {
  readonly did: string;
  readonly smart_account_address: string;
  readonly credential_id_hex: string;
  readonly keystore: KeystoreRecord;
  readonly keystore_commitment: string;
  readonly anchor: KeystoreAnchor | null;
}

/** A passkey as a native-transaction signer, in the shape the SDK's `HybridSigner` takes. */
export interface PasskeyTransactionSigner {
  p256PublicKey(): Uint8Array;
  mlDsaPublicKey(): Uint8Array | null;
  signComposite(
    mPrime: Uint8Array,
  ): Promise<
    [
      { authenticatorData: Uint8Array; clientDataJson: Uint8Array; signature: Uint8Array },
      Uint8Array | null,
    ]
  >;
}

/**
 * A passkey's signature over a relying party's one-time code, proving this
 * device holds a passkey on `account`. The relying party verifies it with the
 * credential's P-256 key from the account's keystore on the network (not a
 * key taken from this object), and checks the origin and RP ID in the signed
 * data.
 */
export interface OwnershipProof {
  readonly account: string;
  readonly did: string;
  readonly credentialIdHex: string;
  readonly authenticatorDataHex: string;
  readonly clientDataJsonHex: string;
  readonly signatureHex: string;
  /**
   * The account's first passkey, while the account has no keystore on
   * chain: with it a relying party reads the account's genesis keystore
   * (`tenzro_getKeystore`) to check the proof. Public data only.
   */
  readonly anchor?: KeystoreAnchor;
}

/** Options of `createWallet` and `signIn`. */
export interface PasskeyEntryOptions {
  /**
   * A relying party's one-time challenge (16 bytes or more). When given, the
   * result carries an `OwnershipProof` over it, taken from an approval the flow
   * asks for anyway where it can, so connecting a site costs no extra prompt.
   */
  readonly challenge?: Uint8Array;
  /** Which authenticator to offer first; `['hybrid']` shows a QR code to use a phone. */
  readonly hints?: readonly PasskeyHint[];
  /** Ask only this device, silently when it holds no passkey (see GetPasskeyOptions.immediate). */
  readonly immediate?: boolean;
}

function checkProofChallenge(challenge: Uint8Array | undefined): void {
  if (challenge && challenge.length < 16) {
    throw new PasskeyError('An ownership proof needs a challenge of at least 16 bytes.', 'invalid');
  }
}

function ownershipProof(
  account: string,
  did: string,
  signed: PasskeySignature,
  anchor?: KeystoreAnchor,
): OwnershipProof {
  return {
    account,
    did,
    ...(anchor ? { anchor } : {}),
    credentialIdHex: toHex(signed.credentialId),
    authenticatorDataHex: toHex(new Uint8Array(signed.assertion.authenticator_data)),
    clientDataJsonHex: toHex(new Uint8Array(signed.assertion.client_data_json)),
    signatureHex: toHex(new Uint8Array(signed.assertion.signature)),
  };
}

/** One recovery signer, at the index a recovery's approvals name. */
export interface GuardianMember {
  readonly index: number;
  readonly p256_pubkey_hex: string;
  readonly role: string;
  readonly label?: string;
  readonly aaguid: string;
  readonly backup_eligible: boolean;
  readonly backup_state: boolean;
}

export interface GuardianSet {
  readonly threshold: number;
  readonly independent_roots: number;
  readonly members: readonly GuardianMember[];
}

/**
 * What a recovering device hands its guardians: the recovery change itself,
 * with the commitment it names. Public data only. A guardian recomputes the
 * digest from it, checks it against the account's keystore on the network,
 * and signs.
 */
export interface RecoveryRequest {
  readonly update: KeystoreUpdate;
  readonly guardiansTotal: number;
  readonly threshold: number;
}

/** A guardian's approval, handed back to the recovering device. */
export interface RecoveryApproval {
  readonly account: string;
  readonly public_key: string;
  readonly signature: CompositeSignatureJson;
}

const REQUEST_FORMAT = 'tenzro-recovery-request/2';
const APPROVAL_FORMAT = 'tenzro-recovery-approval/1';

function encodeText(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeText(text: string): Record<string, unknown> | null {
  try {
    const b64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** A recovery request as text a guardian can open (link fragment or paste). */
export function encodeRecoveryRequest(r: RecoveryRequest): string {
  return encodeText({ format: REQUEST_FORMAT, ...r });
}

export function decodeRecoveryRequest(text: string): RecoveryRequest {
  const r = decodeText(text) as (RecoveryRequest & { format?: string }) | null;
  const u = r?.update;
  if (
    r?.format !== REQUEST_FORMAT ||
    !u ||
    typeof u !== 'object' ||
    fromHex(u.account ?? '').length !== 20 ||
    fromHex(u.previous_commitment ?? '').length !== 32 ||
    typeof u.op !== 'object' ||
    !('start_recovery' in u.op) ||
    !Number.isSafeInteger(r.guardiansTotal) ||
    !Number.isSafeInteger(r.threshold)
  ) {
    throw new PasskeyError('This is not a recovery request.', 'invalid');
  }
  return { update: u, guardiansTotal: r.guardiansTotal, threshold: r.threshold };
}

/** A guardian's approval as text the recovering device pastes. */
export function encodeRecoveryApproval(a: RecoveryApproval): string {
  return encodeText({ format: APPROVAL_FORMAT, ...a });
}

export function decodeRecoveryApproval(text: string): RecoveryApproval {
  const a = decodeText(text) as (RecoveryApproval & { format?: string }) | null;
  if (
    a?.format !== APPROVAL_FORMAT ||
    fromHex(a.account ?? '').length !== 20 ||
    fromHex(a.public_key ?? '').length !== 64 ||
    typeof a.signature !== 'object'
  ) {
    throw new PasskeyError('This is not a guardian approval.', 'invalid');
  }
  return { account: a.account, public_key: a.public_key, signature: a.signature };
}

/** Sends a signed typed transaction; the SDK's `TypedTxClient` by default. */
export interface TransactionSender {
  send(signer: HybridSigner, tx: TypedTransaction): Promise<unknown>;
}

export interface PasskeyCustodyOptions {
  readonly rpc: JsonRpcTransport;
  readonly authenticator: PasskeyAuthenticator;
  /** Sends keystore changes; defaults to the SDK's typed transaction client over `rpc`. */
  readonly sender?: TransactionSender;
  /**
   * Pays the fee of a keystore change for an account with no balance yet:
   * a wallet provider, a sponsor or a friend. It sends the change from its
   * own account and pays for it; the account's passkey still authorizes the
   * change through the approval it carries. Without one, an account with no
   * balance cannot change its keystore until it is funded.
   */
  readonly sponsor?: KeystoreSponsor;
}

/** Sends an approved keystore change from its own account and pays its fee. */
export interface KeystoreSponsor {
  submit(update: KeystoreUpdate): Promise<unknown>;
}

const stripped = (hex: string) => normalizeHex(hex);
const ZERO_AAGUID = '00'.repeat(16);

/** The passkey, and its key, that signs for an account on this device. */
interface Signing {
  readonly credential: CredentialRef;
  readonly publicKey: Uint8Array;
  readonly hybrid: boolean;
}

export class PasskeyCustody {
  readonly rpc: JsonRpcTransport;
  readonly authenticator: PasskeyAuthenticator;
  readonly #sender: TransactionSender;
  readonly #sponsor: KeystoreSponsor | undefined;

  constructor(opts: PasskeyCustodyOptions) {
    this.rpc = opts.rpc;
    this.authenticator = opts.authenticator;
    this.#sender = opts.sender ?? new TypedTxClient(opts.rpc as unknown as RpcClient);
    this.#sponsor = opts.sponsor;
  }

  // ── Create ────────────────────────────────────────────────────────────

  /**
   * First device: create a passkey, derive the DID and the account from it,
   * and prove possession of it. The node stores nothing: until the account's
   * first keystore change its keystore is this passkey alone, and the anchor
   * the node returns is what that first change carries.
   *
   * Two approvals: creating the passkey and signing the enrolment challenge.
   * With `challenge`, one more signs the relying party's ownership proof.
   */
  async createWallet(
    opts: { readonly displayName: string } & PasskeyEntryOptions,
  ): Promise<PasskeyAccount & { readonly proof?: OwnershipProof; readonly existing?: boolean }> {
    checkProofChallenge(opts.challenge);
    // One person, one Tenzro identity: the same passkey always opens the same
    // wallet. Where the browser can ask this device silently, a Tenzro passkey
    // already on it opens its wallet instead of a new one being made.
    if (await this.authenticator.supportsImmediateGet?.()) {
      try {
        const found = await this.signIn({ ...opts, immediate: true });
        if (found.account) return { ...found, existing: true };
      } catch (err) {
        if (
          !(err instanceof PasskeyError) ||
          (err.kind !== 'cancelled' && err.kind !== 'not-found')
        )
          throw err;
      }
    }
    const hints = opts.hints;
    const created = await this.authenticator.create({
      userId: randomBytes(16),
      userName: opts.displayName,
      ...(hints ? { hints, crossPlatform: hints.includes('hybrid') } : {}),
    });
    const credential: CredentialRef = {
      id: toHex(created.credentialId),
      transports: created.transports,
    };
    // Enrolment challenge: the "account" is the P-256 key being enrolled and
    // the target its credential id.
    const xyHex = toHex(created.publicKey, true);
    const challenge = await requestCustodyChallenge(
      this.rpc,
      xyHex,
      'enroll_passkey',
      created.credentialId,
    );
    const { authorization } = await authorizeChallenge(
      this.authenticator,
      challenge,
      [credential],
      hints ? { hints } : {},
    );
    const enrolled = await this.rpc.call<EnrollPasskeyResult>('tenzro_enrollPasskey', {
      display_name: opts.displayName,
      passkey_public_key_hex: xyHex,
      credential_id_hex: toHex(created.credentialId, true),
      registration_authenticator_data_hex: toHex(created.registrationAuthenticatorData, true),
      rp_id: this.authenticator.rpId,
      salt: 0,
      authorization,
    });
    const expectedDid = humanDidFromPasskey(created.publicKey);
    const expectedAccount = toHex(smartAccountAddress(created.publicKey, created.credentialId, 0));
    if (
      enrolled.did !== expectedDid ||
      stripped(enrolled.smart_account_address) !== expectedAccount
    ) {
      throw new PasskeyError(
        'The node returned an identity that does not match this passkey.',
        'invalid',
      );
    }
    let proofSignature: PasskeySignature | undefined;
    if (opts.challenge) {
      proofSignature = await this.authenticator.get({
        challenge: opts.challenge,
        allow: [credential],
        ...(hints ? { hints } : {}),
      });
    }
    return {
      did: enrolled.did,
      account: `0x${expectedAccount}`,
      credentialId: credential.id,
      transports: created.transports,
      tier: created.tier,
      displayName: opts.displayName,
      ...(enrolled.anchor ? { anchor: enrolled.anchor } : {}),
      ...(proofSignature
        ? {
            proof: ownershipProof(
              `0x${expectedAccount}`,
              enrolled.did,
              proofSignature,
              enrolled.anchor ?? undefined,
            ),
          }
        : {}),
    };
  }

  // ── Sign in ───────────────────────────────────────────────────────────

  /**
   * Discoverable sign-in on any device, through any node. A passkey a
   * keystore on chain links is found from its credential id. The first
   * passkey of an account with no keystore on chain yet is found from its own
   * key: the account is derived from it, which takes one more approval on a
   * device that has no record of it (two signatures pin the key). With
   * `challenge`, the first approval is also the ownership proof.
   */
  async signIn(
    opts: PasskeyEntryOptions = {},
  ): Promise<PasskeyAccount & { readonly proof?: OwnershipProof }> {
    checkProofChallenge(opts.challenge);
    const signed = await this.authenticator.get({
      challenge: opts.challenge ?? randomBytes(32),
      ...(opts.hints ? { hints: opts.hints } : {}),
      ...(opts.immediate ? { immediate: true } : {}),
    });
    const credentialId = toHex(signed.credentialId);
    const withProof = (a: PasskeyAccount) =>
      opts.challenge ? { ...a, proof: ownershipProof(a.account, a.did, signed, a.anchor) } : a;

    const linked = await resolveCredential(this.rpc, credentialId, this.authenticator.rpId).catch(
      () => [] as string[],
    );
    if (linked.length > 0) {
      const handle = signed.userHandle?.length === 20 ? toHex(signed.userHandle) : '';
      const account = linked.find((a) => stripped(a) === handle) ?? linked[0];
      if (account) {
        const view = await getKeystore(this.rpc, `0x${stripped(account)}`);
        return withProof({
          did: view.keystore?.owner_did ?? '',
          account: `0x${stripped(account)}`,
          credentialId,
          transports: [],
        });
      }
    }

    // The account's first passkey, before the account has a keystore on
    // chain: a second signature leaves one key both could have come from.
    const first = this.#candidateKeys(signed);
    const again = await this.authenticator.get({
      challenge: randomBytes(32),
      allow: [{ id: credentialId }],
      ...(opts.hints ? { hints: opts.hints } : {}),
    });
    const second = new Set(this.#candidateKeys(again).map((k) => toHex(k)));
    const key = first.find((k) => second.has(toHex(k)));
    if (!key) {
      throw new PasskeyError(
        'No Tenzro account was found for this passkey. Create a wallet first.',
        'not-found',
      );
    }
    const flags = parseAuthenticatorFlags(new Uint8Array(signed.assertion.authenticator_data));
    const anchor: KeystoreAnchor = {
      rp_id: this.authenticator.rpId,
      credential_id: credentialId,
      public_key: toHex(key),
      aaguid: ZERO_AAGUID,
      backup_eligible: flags.backupEligible,
      backup_state: flags.backedUp,
      salt: 0,
    };
    const account = `0x${toHex(smartAccountAddress(key, signed.credentialId, 0))}`;
    const view = await getKeystore(this.rpc, account, anchor);
    if (view.on_chain && !credentialOf(view.keystore, credentialId)) {
      throw new PasskeyError('This passkey is no longer linked to its account.', 'not-found');
    }
    return withProof({
      did: humanDidFromPasskey(key),
      account,
      credentialId,
      transports: [],
      ...(view.on_chain ? {} : { anchor }),
    });
  }

  // ── Devices ───────────────────────────────────────────────────────────

  /** The account's keystore as the network holds it (its genesis record before its first change). */
  async keystore(account: PasskeyAccount | string): Promise<KeystoreView> {
    if (typeof account === 'string') return getKeystore(this.rpc, account);
    return getKeystore(this.rpc, account.account, account.anchor);
  }

  /** Credential ids the account's keystore links (hex, no `0x`). */
  async listCredentialIds(account: PasskeyAccount | string): Promise<string[]> {
    const view = await this.keystore(account);
    return (view.keystore?.credentials ?? []).map((c) => stripped(c.credential_id));
  }

  /** The linked passkeys, with their labels and providers. */
  /**
   * The account's passkeys as the network holds them, with where each
   * stands: on the wallet, waiting to count, or joining by recovery.
   */
  async listDevices(account: PasskeyAccount, nowMs: number = Date.now()): Promise<DeviceSummary[]> {
    const view = await this.keystore(account);
    const summary = (c: KeystoreCredential): DeviceSummary => ({
      credentialIdHex: `0x${stripped(c.credential_id)}`,
      ...(c.label ? { label: c.label } : {}),
      tier: c.backup_eligible ? 'synced' : 'device-bound',
      ...(c.aaguid && stripped(c.aaguid) !== ZERO_AAGUID ? { aaguid: stripped(c.aaguid) } : {}),
      thisDevice: stripped(c.credential_id) === stripped(account.credentialId),
      rpId: c.rp_id,
      ...(c.added_at_ms ? { addedAtMs: c.added_at_ms } : {}),
    });
    const linked = (view.keystore?.credentials ?? []).map((c): DeviceSummary => {
      const waiting = c.counts_as_root_from_ms > nowMs;
      return {
        ...summary(c),
        status: waiting ? 'waiting' : 'on-wallet',
        ...(waiting ? { countsFromMs: c.counts_as_root_from_ms } : {}),
      };
    });
    const pending = view.keystore?.pending_recovery;
    return pending
      ? [
          ...linked,
          {
            ...summary(pending.credential),
            status: 'recovering',
            countsFromMs: pending.ready_at_ms,
          },
        ]
      : linked;
  }

  async readiness(account: PasskeyAccount): Promise<WalletReadiness> {
    return assessReadiness(await this.listDevices(account));
  }

  /**
   * Links a passkey to the account: on another device over hybrid (a QR
   * code), on this device, or a security key. The new passkey is created
   * with `user.id` = the account address, so signing in with it anywhere
   * finds the account, and it records this wallet's relying party. It proves
   * possession by signing the change; the change is then sent from the
   * account itself, signed by a passkey already linked (`approver`, or any of
   * them over hybrid), whose signature is its approval. The fee comes from
   * the account.
   */
  async linkDevice(opts: {
    readonly account: PasskeyAccount;
    readonly label: string;
    readonly crossPlatform?: boolean;
    /**
     * Where the new passkey is made: `['hybrid']` shows a QR code so a phone
     * creates it, `['security-key']` asks for a key, `['client-device']` this device.
     */
    readonly hints?: readonly PasskeyHint[];
    /** Passkey that approves. Omit to approve from another device (hybrid). */
    readonly approver?: CredentialRef;
  }): Promise<{
    account_address: string;
    credential_id_hex: string;
    credentials_total: number;
    /** The device already held one of the account's passkeys (synced, for example): nothing was added. */
    already_linked?: boolean;
  }> {
    const view = await this.keystore(opts.account);
    const existing = (view.keystore?.credentials ?? []).map((c) => stripped(c.credential_id));
    if (existing.length === 0) {
      throw new PasskeyError('This account has no passkey on the network.', 'not-found');
    }
    let created: Awaited<ReturnType<PasskeyAuthenticator['create']>>;
    try {
      created = await this.authenticator.create({
        userId: fromHex(opts.account.account).slice(-20),
        userName: opts.label,
        exclude: existing.map((id) => ({ id })),
        ...(opts.crossPlatform ? { crossPlatform: true } : {}),
        ...(opts.hints ? { hints: opts.hints } : {}),
      });
    } catch (err) {
      // The device already holds one of this account's passkeys, typically
      // synced through its credential manager. It can already approve, so tie
      // to that passkey instead of failing: it signs, and nothing new is made.
      if (!(err instanceof PasskeyError) || err.kind !== 'already-enrolled') throw err;
      const signed = await this.authenticator.get({
        challenge: randomBytes(32),
        allow: existing.map((id) => ({ id })),
        ...(opts.hints ? { hints: opts.hints, hybrid: opts.hints.includes('hybrid') } : {}),
      });
      const held = toHex(signed.credentialId);
      if (!existing.includes(held)) {
        throw new PasskeyError(
          'That device answered with a passkey from another account.',
          'invalid',
        );
      }
      return {
        account_address: opts.account.account,
        credential_id_hex: `0x${held}`,
        credentials_total: existing.length,
        already_linked: true,
      };
    }
    const provenance = registrationProvenance(created.registrationAuthenticatorData);
    const joining: KeystoreCredential = {
      rp_id: this.authenticator.rpId,
      credential_id: toHex(created.credentialId),
      public_key: toHex(created.publicKey),
      aaguid: toHex(provenance.aaguid),
      backup_eligible: provenance.backupEligible,
      backup_state: provenance.backupState,
      counts_as_root_from_ms: 0,
      label: opts.label.slice(0, 64),
    };
    let update = await prepareUpdate(
      this.rpc,
      opts.account.account,
      { add_credential: { credential: joining } },
      opts.account.anchor,
    );
    // The new passkey signs the change: its signed flags prove what its
    // registration claims about syncing.
    update = withPossession(
      update,
      await signKeystoreDigest(
        this.authenticator,
        update,
        [{ id: joining.credential_id, transports: created.transports }],
        opts.hints ? { hints: opts.hints } : {},
      ),
    );
    const approvers = opts.approver ? [opts.approver] : existing.map((id) => ({ id }));
    await this.#send(opts.account, view, update, approvers, !opts.approver, joining.credential_id);
    return {
      account_address: opts.account.account,
      credential_id_hex: `0x${joining.credential_id}`,
      credentials_total: existing.length + 1,
    };
  }

  /**
   * Approves linking a passkey another wallet provider made for this account
   * on its own relying party. That provider builds the change and its new
   * passkey signs it (proof of possession); this device's passkey approves
   * and the change is sent from the account. Nothing else is signed: the
   * change must add exactly one credential to this account's keystore as it
   * stands now.
   */
  async approveLink(
    account: PasskeyAccount,
    update: KeystoreUpdate,
  ): Promise<{ credential: KeystoreCredential; credentials_total: number }> {
    if (stripped(update.account) !== stripped(account.account)) {
      throw new PasskeyError('This change is for another account.', 'invalid');
    }
    if (typeof update.op !== 'object' || !('add_credential' in update.op)) {
      throw new PasskeyError('Only linking a passkey can be approved here.', 'invalid');
    }
    if (!update.possession) {
      throw new PasskeyError('The new passkey has not signed the change.', 'invalid');
    }
    const joining = update.op.add_credential.credential;
    const view = await this.keystore(account);
    const current = view.keystore?.credentials ?? [];
    if (current.some((c) => stripped(c.credential_id) === stripped(joining.credential_id))) {
      throw new PasskeyError('That passkey is already linked to the account.', 'already-enrolled');
    }
    if (!view.commitment || stripped(view.commitment) !== stripped(update.previous_commitment)) {
      throw new PasskeyError(
        'The account changed since this link was prepared. Start the link again.',
        'invalid',
      );
    }
    await this.#sendAs(account.account, await this.#signing(account), {
      ...update,
      anchor: view.on_chain ? null : (update.anchor ?? account.anchor ?? null),
      approvals: [],
    });
    return { credential: joining, credentials_total: current.length + 1 };
  }

  /** Unlinks a passkey. Refuses to remove the last one: the account would be unrecoverable. */
  async removeDevice(opts: {
    readonly account: PasskeyAccount;
    readonly credentialIdHex: string;
    readonly approver: CredentialRef;
  }): Promise<{ removed: boolean; credentials_remaining: number }> {
    const view = await this.keystore(opts.account);
    const ids = (view.keystore?.credentials ?? []).map((c) => stripped(c.credential_id));
    const target = stripped(opts.credentialIdHex);
    if (!ids.includes(target)) {
      throw new PasskeyError('That passkey is not linked to this account.', 'not-found');
    }
    if (ids.length <= 1) {
      throw new PasskeyError(
        'This is the only passkey on the account. Link another device before removing it.',
        'last-device',
      );
    }
    const update = await prepareUpdate(
      this.rpc,
      opts.account.account,
      { remove_credential: { credential_id: target } },
      opts.account.anchor,
    );
    await this.#send(opts.account, view, update, [opts.approver], false);
    return { removed: true, credentials_remaining: ids.length - 1 };
  }

  /** Signs a relying party's one-time `challenge` with this device's passkey on `account`. */
  async proveOwnership(account: PasskeyAccount, challenge: Uint8Array): Promise<OwnershipProof> {
    checkProofChallenge(challenge);
    const signed = await this.authenticator.get({
      challenge,
      allow: [{ id: account.credentialId, transports: account.transports }],
    });
    return ownershipProof(account.account, account.did, signed, account.anchor);
  }

  /**
   * Another wallet under the same identity: the identity's first passkey is
   * enrolled again with `salt`, which derives another account. It has to run
   * where that passkey is available (a synced passkey counts).
   */
  async addWallet(
    account: PasskeyAccount,
    opts: { readonly salt: number },
  ): Promise<PasskeyAccount & { readonly salt: number }> {
    if (!Number.isInteger(opts.salt) || opts.salt < 1) {
      throw new PasskeyError('A further wallet needs a salt of 1 or more.', 'invalid');
    }
    const root = await this.#firstPasskey(account);
    const credentialId = fromHex(root.credential_id);
    const xyHex = `0x${stripped(root.public_key)}`;
    const challenge = await requestCustodyChallenge(
      this.rpc,
      xyHex,
      'enroll_passkey',
      credentialId,
    );
    const { authorization } = await authorizeChallenge(this.authenticator, challenge, [
      { id: stripped(root.credential_id) },
    ]);
    const enrolled = await this.rpc.call<EnrollPasskeyResult>('tenzro_enrollPasskey', {
      passkey_public_key_hex: xyHex,
      credential_id_hex: toHex(credentialId, true),
      rp_id: root.rp_id,
      salt: opts.salt,
      authorization,
    });
    if (enrolled.did !== account.did) {
      throw new PasskeyError(
        'The node returned an identity that does not match this passkey.',
        'invalid',
      );
    }
    return {
      ...account,
      account: enrolled.smart_account_address,
      credentialId: stripped(root.credential_id),
      salt: opts.salt,
      ...(enrolled.anchor ? { anchor: enrolled.anchor } : {}),
    };
  }

  // ── Policy and limits ─────────────────────────────────────────────────

  async getSecondFactor(account: PasskeyAccount): Promise<{
    second_factor: SecondFactorPolicy;
    required_signatures: number;
    credentials_enrolled: number;
  }> {
    const view = await this.keystore(account);
    const policy = view.keystore?.policy ?? 'single_credential';
    return {
      second_factor: policy,
      required_signatures: policy === 'two_credentials' ? 2 : 1,
      credentials_enrolled: view.keystore?.credentials.length ?? 0,
    };
  }

  /**
   * `two_credentials`: changes to the keystore need two passkeys, and one
   * passkey alone can no longer send from the account. Moving to or from it
   * takes two passkeys: `approver` sends and `second` approves.
   */
  async setSecondFactor(opts: {
    readonly account: PasskeyAccount;
    readonly policy: SecondFactorPolicy;
    readonly approver: CredentialRef;
    readonly second?: CredentialRef;
  }): Promise<unknown> {
    const view = await this.keystore(opts.account);
    if (opts.policy === 'two_credentials' && (view.keystore?.credentials.length ?? 0) < 2) {
      throw new PasskeyError('Two-device approval needs at least two passkeys.', 'invalid');
    }
    let update = await prepareUpdate(
      this.rpc,
      opts.account.account,
      { set_policy: { policy: opts.policy } },
      opts.account.anchor,
    );
    if (opts.second) update = await this.#approve(view, update, opts.second, true);
    return this.#send(opts.account, view, update, [opts.approver], false);
  }

  // ── Agents ────────────────────────────────────────────────────────────

  /**
   * Revokes an agent or machine this identity roots. Any passkey the
   * account's keystore links approves revoking exactly `did`; the node
   * records the revocation in consensus.
   */
  async revokeDelegatedAgent(opts: {
    readonly account: PasskeyAccount;
    readonly agentDid: string;
  }): Promise<{
    tokens_revoked?: number;
    chain?: { submitted: boolean; tx_hash?: string; error?: string };
  }> {
    const challenge = await requestCustodyChallenge(
      this.rpc,
      opts.account.account,
      'revoke_delegated_agent',
      new TextEncoder().encode(opts.agentDid),
    );
    const { authorization } = await authorizeChallenge(
      this.authenticator,
      challenge,
      [this.#own(opts.account)],
      {
        ...(opts.account.onAnotherDevice ? { hybrid: true } : {}),
      },
    );
    return this.rpc.call('tenzro_revokeIdentity', { did: opts.agentDid, authorization });
  }

  /**
   * Approves Terms for an agent this identity roots: creating it
   * (`delegate_agent`) or replacing its Terms (`update_agent_terms`). Any
   * passkey the account's keystore links may approve. It signs only when the
   * completed Terms are the requested ones and the challenge binds exactly
   * them on this identity's account.
   */
  async approveAgentTerms(
    account: PasskeyAccount,
    req: {
      readonly operation: 'delegate_agent' | 'update_agent_terms';
      readonly terms: AgentTermsWire;
      readonly rotateTokens?: boolean;
      readonly challenge: CustodyChallenge & { readonly delegation?: AgentTermsWire };
    },
  ): Promise<CustodyAuthorization> {
    if (req.terms.controller_did !== account.did) {
      throw new PasskeyError('These Terms name another controller; nothing was signed.', 'invalid');
    }
    const completed = req.challenge.delegation;
    if (!completed)
      throw new PasskeyError(
        'The challenge carries no completed Terms; nothing was signed.',
        'invalid',
      );
    const rotate = req.operation === 'update_agent_terms' ? (req.rotateTokens ?? false) : undefined;
    const target = agentTermsTarget(completed, rotate);
    const expected = agentTermsTarget(
      { ...req.terms, serving_nodes: completed.serving_nodes },
      rotate,
    );
    const ids = (t: AgentTermsWire) =>
      t.serving_nodes.map((n) => `${n.machine_did}|${n.operator_did}`).join(',');
    if (toHex(target) !== toHex(expected) || ids(req.terms) !== ids(completed)) {
      throw new PasskeyError(
        'The node completed Terms that differ from the ones requested; nothing was signed.',
        'invalid',
      );
    }
    const nonce = fromHex(req.challenge.nonce_hex ?? '');
    const digest = custodyChallengeDigest(fromHex(account.account), req.operation, target, nonce);
    if (
      nonce.length !== 16 ||
      stripped(req.challenge.target_hex ?? '') !== toHex(target) ||
      stripped(req.challenge.challenge_hex) !== toHex(digest)
    ) {
      throw new PasskeyError(
        'The challenge is for different Terms or another account; nothing was signed.',
        'invalid',
      );
    }
    const { authorization } = await authorizeChallenge(
      this.authenticator,
      req.challenge,
      [this.#own(account)],
      {
        ...(account.onAnotherDevice ? { hybrid: true } : {}),
      },
    );
    return authorization;
  }

  /**
   * Approves one action an agent's Terms held for this identity (step-up),
   * with any passkey the account's keystore links. The challenge must be the
   * node's `agent_step_up` digest of exactly the action shown, and the agent
   * must be one this identity roots with a passkey. The agent sends the
   * action again with the result as `step_up`.
   */
  async approveAgentStepUp(account: PasskeyAccount, req: StepUpRequest): Promise<AgentStepUp> {
    const digest = checkStepUp(req);
    const terms = await getAgentTerms(this.rpc, req.action.agent_did);
    if (!terms)
      throw new PasskeyError(`${req.action.agent_did} has no Terms on chain.`, 'not-found');
    if (terms.root_kind !== 'passkey' || terms.terms.controller_did !== account.did) {
      throw new PasskeyError(
        'This agent is not rooted in this identity; nothing was signed.',
        'invalid',
      );
    }
    if (terms.status !== 'active') {
      throw new PasskeyError(`This agent is ${terms.status}; nothing was signed.`, 'invalid');
    }
    const signing = await this.#signing(account);
    const signer = await this.authenticator.get({
      challenge: signingDigest(SignatureContext.AccountOwner, digest),
      allow: [signing.credential],
      ...(signing.hybrid ? { hybrid: true } : {}),
    });
    return {
      account: stripped(req.step_up.account),
      nonce: stripped(req.step_up.nonce),
      root_public_key: toHex(signing.publicKey),
      signature: compositeSignatureJson(signer),
    };
  }

  /**
   * A signer for native transactions from the account, by this device's
   * passkey: it signs each one as a WebAuthn assertion over `SHA-256(M')`.
   * The transactions are sent from the account (`from`), which the network
   * accepts because the account's keystore links the passkey.
   */
  async transactionSigner(account: PasskeyAccount): Promise<PasskeyTransactionSigner> {
    const signing = await this.#signing(account);
    return this.#signer(signing);
  }

  // ── Recovery ──────────────────────────────────────────────────────────

  /** The account's recovery signers and threshold. Public. */
  async listGuardians(account: PasskeyAccount | string): Promise<GuardianSet> {
    const view = await this.keystore(account);
    const signers = view.keystore?.recovery_signers ?? [];
    const roots = new Set(
      signers.map((s) =>
        s.backup_eligible ? `p:${stripped(s.aaguid)}` : `d:${stripped(s.public_key)}`,
      ),
    );
    return {
      threshold: view.keystore?.recovery_threshold ?? 0,
      independent_roots: roots.size,
      members: signers.map((s, index) => ({
        index,
        p256_pubkey_hex: `0x${stripped(s.public_key)}`,
        role: s.role,
        ...(s.label ? { label: s.label } : {}),
        aaguid: stripped(s.aaguid),
        backup_eligible: s.backup_eligible,
        backup_state: s.backup_state,
      })),
    };
  }

  /**
   * Adds a recovery signer from its card, with `threshold` (by default the
   * current one, or 1 for the first signer). The network refuses a threshold
   * above the signers' independent roots.
   */
  async addGuardian(opts: {
    readonly account: PasskeyAccount;
    readonly card: GuardianCard;
    readonly threshold?: number;
    readonly approver: CredentialRef;
  }): Promise<{ guardian_count: number; threshold: number }> {
    const view = await this.keystore(opts.account);
    const current = view.keystore?.recovery_signers ?? [];
    const card = opts.card;
    const p = registrationProvenance(fromHex(card.registrationAuthenticatorData));
    const added: RecoverySigner = {
      rp_id: card.rpId ?? this.authenticator.rpId,
      public_key: stripped(card.p256),
      aaguid: toHex(p.aaguid),
      backup_eligible: p.backupEligible,
      backup_state: p.backupState,
      role: card.role,
      label: card.label.trim(),
    };
    if (current.some((s) => stripped(s.public_key) === added.public_key)) {
      throw new PasskeyError('That key is already a recovery signer of this account.', 'invalid');
    }
    const signers = [...current, added];
    const threshold = opts.threshold ?? Math.max(view.keystore?.recovery_threshold ?? 0, 1);
    const update = await prepareUpdate(
      this.rpc,
      opts.account.account,
      { set_recovery: { signers, threshold } },
      opts.account.anchor,
    );
    await this.#send(opts.account, view, update, [opts.approver], false);
    return { guardian_count: signers.length, threshold };
  }

  /**
   * Starts recovery from a new device after losing the others: creates a
   * passkey here and builds the recovery change, which the account's
   * recovery signers approve. Nothing is sent yet: the request goes to the
   * guardians, their approvals come back, and `submitRecovery` sends it.
   */
  async startRecovery(opts: {
    readonly account: string;
    readonly label: string;
    readonly hints?: readonly PasskeyHint[];
  }): Promise<{ readonly credentialId: string; readonly request: RecoveryRequest }> {
    const view = await getKeystore(this.rpc, opts.account);
    const signers = view.keystore?.recovery_signers ?? [];
    if (!view.on_chain || signers.length === 0) {
      throw new PasskeyError('This account has no recovery signers on the network.', 'not-found');
    }
    if (view.keystore?.pending_recovery) {
      throw new PasskeyError('A recovery is already waiting on this account.', 'invalid');
    }
    const created = await this.authenticator.create({
      userId: fromHex(opts.account).slice(-20),
      userName: opts.label,
      ...(opts.hints ? { hints: opts.hints } : {}),
    });
    const p = registrationProvenance(created.registrationAuthenticatorData);
    const joining: KeystoreCredential = {
      rp_id: this.authenticator.rpId,
      credential_id: toHex(created.credentialId),
      public_key: toHex(created.publicKey),
      aaguid: toHex(p.aaguid),
      backup_eligible: p.backupEligible,
      backup_state: p.backupState,
      counts_as_root_from_ms: 0,
      label: opts.label.slice(0, 64),
    };
    let update = await prepareUpdate(this.rpc, opts.account, {
      start_recovery: { credential: joining },
    });
    update = withPossession(
      update,
      await signKeystoreDigest(this.authenticator, update, [{ id: joining.credential_id }]),
    );
    return {
      credentialId: joining.credential_id,
      request: {
        update,
        guardiansTotal: signers.length,
        threshold: view.keystore?.recovery_threshold ?? 0,
      },
    };
  }

  /**
   * Guardian side: approves a recovery with the guardian passkey on this
   * device. The digest is computed here from the request, and the request's
   * commitment must be the account's keystore on the network now, so a
   * guardian never signs a hash it was merely handed or a stale change.
   */
  async approveRecovery(request: RecoveryRequest): Promise<RecoveryApproval> {
    const u = request.update;
    const view = await getKeystore(this.rpc, u.account);
    if (!view.on_chain || stripped(view.commitment ?? '') !== stripped(u.previous_commitment)) {
      throw new PasskeyError('This request does not match the account on the network.', 'invalid');
    }
    const signers = view.keystore?.recovery_signers ?? [];
    if (signers.length === 0) throw new PasskeyError('This account has no guardians.', 'not-found');
    const signed = await this.authenticator.get({
      challenge: signingDigest(SignatureContext.RecoveryApproval, updateDigest(u)),
      allow: [],
    });
    const keys = this.#candidateKeys(signed).map((k) => toHex(k));
    const member = signers.find((s) => keys.includes(stripped(s.public_key)));
    if (!member)
      throw new PasskeyError('This passkey is not a guardian of the account.', 'invalid');
    return {
      account: u.account,
      public_key: stripped(member.public_key),
      signature: compositeSignatureJson(signed),
    };
  }

  /**
   * Recovering side: sends the recovery with the guardians' approvals, from
   * the account itself, signed by the joining passkey; the fee comes from
   * the account. It then waits out its delay, during which any passkey still
   * on the account can cancel it.
   */
  async submitRecovery(opts: {
    readonly request: RecoveryRequest;
    readonly approvals: readonly RecoveryApproval[];
    readonly credentialId: string;
  }): Promise<unknown> {
    const u = opts.request.update;
    const joining =
      'start_recovery' in (u.op as object)
        ? (u.op as { start_recovery: { credential: KeystoreCredential } }).start_recovery.credential
        : null;
    if (!joining || stripped(joining.credential_id) !== stripped(opts.credentialId)) {
      throw new PasskeyError(
        'This recovery adds another passkey than the one on this device.',
        'invalid',
      );
    }
    const update: KeystoreUpdate = {
      ...u,
      approvals: opts.approvals
        .filter((a) => stripped(a.account) === stripped(u.account))
        .map((a) => ({ public_key: a.public_key, signature: a.signature })),
    };
    return this.#sendAs(
      u.account,
      {
        credential: { id: joining.credential_id },
        publicKey: fromHex(joining.public_key),
        hybrid: false,
      },
      update,
    );
  }

  /** Completes a recovery once its wait is over, signed by the passkey it adds. */
  async finishRecovery(opts: {
    readonly account: string;
    readonly credentialId: string;
  }): Promise<unknown> {
    const view = await getKeystore(this.rpc, opts.account);
    const pending = view.keystore?.pending_recovery;
    if (!pending || stripped(pending.credential.credential_id) !== stripped(opts.credentialId)) {
      throw new PasskeyError(
        'No recovery adding this passkey is waiting on the account.',
        'not-found',
      );
    }
    if (Date.now() < pending.ready_at_ms) {
      throw new PasskeyError(
        `The recovery completes from ${new Date(pending.ready_at_ms).toISOString()}.`,
        'invalid',
      );
    }
    const update = await prepareUpdate(this.rpc, opts.account, 'finish_recovery');
    return this.#sendAs(
      opts.account,
      {
        credential: { id: stripped(opts.credentialId) },
        publicKey: fromHex(pending.credential.public_key),
        hybrid: false,
      },
      update,
    );
  }

  /** The recovery waiting on the account, if any, so its owner can see and cancel it. */
  async pendingRecovery(account: PasskeyAccount | string): Promise<PendingRecovery | null> {
    return (await this.keystore(account)).keystore?.pending_recovery ?? null;
  }

  /**
   * Cancels the recovery during its wait, sent by a passkey on the account.
   * This is how an owner who still has a device stops a recovery they did
   * not start.
   */
  async cancelRecovery(opts: {
    readonly account: PasskeyAccount;
    readonly approver: CredentialRef;
  }): Promise<unknown> {
    const view = await this.keystore(opts.account);
    if (!view.keystore?.pending_recovery)
      throw new PasskeyError('No recovery is waiting on this account.', 'not-found');
    const update = await prepareUpdate(this.rpc, opts.account.account, 'cancel_recovery');
    return this.#send(opts.account, view, update, [opts.approver], false);
  }

  /**
   * Guardian side: creates the guardian passkey on this device and returns the
   * card to hand to the account holder. Only public data leaves the device.
   */
  async createGuardian(opts: {
    readonly label: string;
    readonly source: GuardianSource;
    readonly hints?: readonly PasskeyHint[];
  }): Promise<GuardianCard> {
    const label = opts.label.trim();
    if (new TextEncoder().encode(label).length > MAX_GUARDIAN_LABEL_BYTES) {
      throw new PasskeyError(
        `A guardian label is at most ${MAX_GUARDIAN_LABEL_BYTES} bytes.`,
        'invalid',
      );
    }
    const created = await this.authenticator.create({
      userId: randomBytes(16),
      userName: `Tenzro guardian: ${label}`,
      ...(opts.hints
        ? { hints: opts.hints, crossPlatform: opts.hints.includes('security-key') }
        : {}),
    });
    return {
      format: 'tenzro-guardian',
      version: 2,
      label,
      role: guardianRole(opts.source),
      rpId: this.authenticator.rpId,
      p256: toHex(created.publicKey, true),
      credentialId: toHex(created.credentialId, true),
      registrationAuthenticatorData: toHex(created.registrationAuthenticatorData, true),
    };
  }

  // ── internals ─────────────────────────────────────────────────────────

  #candidateKeys(signed: PasskeySignature): Uint8Array[] {
    const a = signed.assertion;
    return recoverAssertionPublicKeys(
      new Uint8Array(a.authenticator_data),
      new Uint8Array(a.client_data_json),
      new Uint8Array(a.signature),
    );
  }

  /** This device's passkey on the account. */
  #own(account: PasskeyAccount): CredentialRef {
    return { id: stripped(account.credentialId), transports: account.transports };
  }

  /** This device's passkey on the account and its key, from the keystore. */
  async #signing(account: PasskeyAccount): Promise<Signing> {
    const view = await this.keystore(account);
    const own = credentialOf(view.keystore, account.credentialId);
    if (!own)
      throw new PasskeyError("This device's passkey is not linked to the account.", 'not-found');
    return {
      credential: this.#own(account),
      publicKey: fromHex(own.public_key),
      hybrid: !!account.onAnotherDevice,
    };
  }

  /** The passkey the account's address derives from: the one that opens further wallets. */
  async #firstPasskey(account: PasskeyAccount): Promise<KeystoreCredential> {
    const view = await this.keystore(account);
    const first = view.keystore?.credentials.find(
      (c) => humanDidFromPasskey(fromHex(c.public_key)) === account.did,
    );
    if (!first) {
      throw new PasskeyError(
        "The network does not list this identity's first passkey on the account.",
        'not-found',
      );
    }
    return first;
  }

  #signer(s: Signing): PasskeyTransactionSigner {
    const authenticator = this.authenticator;
    return {
      p256PublicKey: () => s.publicKey,
      mlDsaPublicKey: () => null,
      async signComposite(mPrime: Uint8Array) {
        const a = await authenticator.get({
          challenge: sha256(mPrime),
          allow: [s.credential],
          ...(s.hybrid ? { hybrid: true } : {}),
        });
        return [
          {
            authenticatorData: Uint8Array.from(a.assertion.authenticator_data),
            clientDataJson: Uint8Array.from(a.assertion.client_data_json),
            signature: Uint8Array.from(a.assertion.signature),
          },
          null,
        ];
      },
    };
  }

  /** Adds the approval of the linked passkey `credential` (another device over hybrid). */
  async #approve(
    view: KeystoreView,
    update: KeystoreUpdate,
    credential: CredentialRef,
    hybrid: boolean,
  ): Promise<KeystoreUpdate> {
    const linked = credentialOf(view.keystore, credential.id);
    if (!linked) throw new PasskeyError('That passkey is not linked to the account.', 'not-found');
    const signed = await signKeystoreDigest(
      this.authenticator,
      update,
      [credential],
      hybrid ? { hybrid: true } : {},
    );
    return withApproval(update, fromHex(linked.public_key), signed);
  }

  /**
   * Sends `update` from the account, signed by one of `approvers` (whichever
   * the person uses; never `excluded`), whose signature is its approval.
   */
  async #send(
    account: PasskeyAccount,
    view: KeystoreView,
    update: KeystoreUpdate,
    approvers: readonly CredentialRef[],
    hybrid: boolean,
    excluded?: string,
  ): Promise<unknown> {
    const candidates = approvers.filter((c) => stripped(c.id) !== stripped(excluded ?? ''));
    const only = candidates.length === 1 ? candidates[0] : undefined;
    // With one approver its key is known; with several the person picks one
    // and the key comes from the keystore entry of the credential that signed.
    const keys = new Map(
      (view.keystore?.credentials ?? []).map((c) => [
        stripped(c.credential_id),
        fromHex(c.public_key),
      ]),
    );
    const authenticator = this.authenticator;
    let used: Uint8Array | undefined = only ? keys.get(stripped(only.id)) : undefined;
    if (only && !used)
      throw new PasskeyError('That passkey is not linked to the account.', 'not-found');
    if (!used) {
      // Which device approves is the person's choice: ask once to learn it.
      const probe = await authenticator.get({
        challenge: randomBytes(32),
        allow: candidates,
        hybrid: true,
      });
      used = keys.get(toHex(probe.credentialId));
      if (!used) throw new PasskeyError('That passkey is not linked to the account.', 'invalid');
      return this.#sendAs(
        account.account,
        { credential: { id: toHex(probe.credentialId) }, publicKey: used, hybrid: true },
        update,
      );
    }
    return this.#sendAs(
      account.account,
      { credential: only as CredentialRef, publicKey: used, hybrid },
      update,
    );
  }

  /** Sends `update` from `account`, signed by `signing`. */
  async #sendAs(account: string, signing: Signing, update: KeystoreUpdate): Promise<unknown> {
    if (this.#sponsor && (await this.#unfunded(account))) {
      // The sponsor sends and pays; the passkey's authority travels as an
      // explicit approval. A recovery's authority is its guardians'
      // approvals and the joining passkey's proof, already in the change.
      const recovery =
        update.op === 'finish_recovery' ||
        (typeof update.op === 'object' && 'start_recovery' in update.op);
      const approved = recovery
        ? update
        : withApproval(
            update,
            signing.publicKey,
            await signKeystoreDigest(
              this.authenticator,
              update,
              [signing.credential],
              signing.hybrid ? { hybrid: true } : {},
            ),
          );
      return this.#sponsor.submit(approved);
    }
    const tx: TypedTransaction = {
      kind: 'KeystoreUpdate',
      fields: { update } as unknown as Record<string, unknown>,
      from: account,
    };
    return this.#sender.send(this.#signer(signing) as unknown as HybridSigner, tx);
  }

  /** Whether `account` holds nothing to pay a fee with. */
  async #unfunded(account: string): Promise<boolean> {
    const balance = await this.rpc
      .call<string>('eth_getBalance', [account, 'latest'])
      .catch(() => null);
    return balance !== null && BigInt(balance) === 0n;
  }

  async #authorize(
    account: PasskeyAccount,
    operation: CustodyOperation,
    target: Uint8Array,
    approver: CredentialRef,
  ): Promise<CustodyAuthorization> {
    const challenge = await requestCustodyChallenge(this.rpc, account.account, operation, target);
    const { authorization } = await authorizeChallenge(this.authenticator, challenge, [approver]);
    return account.anchor ? { ...authorization, anchor: account.anchor } : authorization;
  }
}
