/**
 * PasskeyCustody: the non-custodial wallet lifecycle for a person.
 *
 *   createWallet   passkey -> DID -> smart account (tenzro_enrollPasskey)
 *   signIn         find the account behind a passkey on any device
 *   listDevices    the passkeys enrolled on the account
 *   linkDevice     add a passkey on another device or a security key
 *   removeDevice   revoke a passkey (never the last one)
 *   setSecondFactor / setSpendingLimit / grantSessionKey / revokeSessionKey
 *   addGuardian / startRecovery / finalizeRecovery
 *
 * Every change goes through the custody gate (`gate.ts`). The wallet stores
 * no secret and derives no key: the passkey lives in the authenticator and
 * its assertions are the only signatures.
 *
 * Request shapes mirror `crates/tenzro-node/src/passkey_rpc.rs` field for field.
 */

import { sha256 } from '@noble/hashes/sha2.js';

import { fromHex, normalizeHex, randomBytes, toHex } from './bytes.ts';
import { type CompositeSignatureJson, SignatureContext, compositeSignatureJson, signingDigest } from './composite.ts';
import { humanDidFromPasskey, recoverAssertionPublicKeys } from './derive.ts';
import {
  type CustodyAuthorization,
  type CustodyOperation,
  authorizeChallenge,
  requestCustodyChallenge,
} from './gate.ts';
import {
  type GuardianCard,
  type GuardianSource,
  MAX_GUARDIAN_LABEL_BYTES,
  guardianRole,
  guardianTarget,
  recoveryApprovalChallenge,
  recoveryOpHash,
} from './guardian.ts';
import { type DeviceSummary, type WalletReadiness, assessReadiness } from './readiness.ts';
import type { JsonRpcTransport } from './rpc.ts';
import {
  type CredentialRef,
  type PasskeyAuthenticator,
  PasskeyError,
  type PasskeyHint,
  type PasskeySignature,
  type PasskeyTier,
} from './webauthn.ts';

/** What the wallet remembers about an account on one device. Public data only. */
export interface PasskeyAccount {
  readonly did: string;
  /** Smart-account address, `0x`-prefixed hex, as the node returned it. */
  readonly account: string;
  /** The passkey this device signs with, hex without `0x`. */
  readonly credentialId: string;
  readonly transports: readonly string[];
  readonly tier?: PasskeyTier;
  readonly displayName?: string;
}

export interface EnrollPasskeyResult {
  readonly did: string;
  readonly smart_account_address: string;
  readonly credential_id_hex: string;
  readonly webauthn_validator_address: string;
  readonly installed_validators: readonly string[];
}

export interface AccountRecordCredential {
  readonly credential_id_hex: string;
  readonly p256_public_key_hex?: string;
  readonly label?: string | null;
  /** The passkey's provider, from its registration (16 bytes hex). */
  readonly aaguid?: string | null;
  /** Whether the passkey can sync (WebAuthn BE flag at registration). */
  readonly backup_eligible?: boolean | null;
  readonly backup_state?: boolean | null;
}

export interface AccountRecord {
  readonly account_address: string;
  readonly owner_did?: string;
  readonly version?: number;
  readonly credentials?: readonly AccountRecordCredential[];
}

export type SecondFactorPolicy = 'single_credential' | 'two_credentials';

/**
 * A passkey's signature over a relying party's one-time code, proving this
 * device holds a passkey on `account`. The relying party verifies it with the
 * credential's P-256 key from the account record on the node (not a key taken
 * from this object), and checks the origin and RP ID in the signed data.
 */
export interface OwnershipProof {
  readonly account: string;
  readonly did: string;
  readonly credentialIdHex: string;
  readonly authenticatorDataHex: string;
  readonly clientDataJsonHex: string;
  readonly signatureHex: string;
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

function ownershipProof(account: string, did: string, signed: PasskeySignature): OwnershipProof {
  return {
    account,
    did,
    credentialIdHex: toHex(signed.credentialId),
    authenticatorDataHex: toHex(new Uint8Array(signed.assertion.authenticator_data)),
    clientDataJsonHex: toHex(new Uint8Array(signed.assertion.client_data_json)),
    signatureHex: toHex(new Uint8Array(signed.assertion.signature)),
  };
}

export interface SessionKeyGrant {
  /** 32-byte Ed25519 public key of the session key, held by the agent's device. */
  readonly sessionPublicKeyHex: string;
  /** 4-byte function selectors, hex. */
  readonly allowedSelectors: readonly string[];
  /** 20-byte targets. Empty means any target. */
  readonly allowedTargets?: readonly string[];
  /** Wei, decimal string. `"0"` forbids value transfer. Omit for no cap. */
  readonly maxValuePerCallWei?: string;
  readonly maxTotalValueWei?: string;
  readonly validAfterUnix: number;
  readonly validUntilUnix: number;
  readonly label?: string;
}

/** A recovery waiting on the account, as the node lists it. */
export interface PendingRecovery {
  readonly recovery_id: string;
  /** The passkey the recovery would add. */
  readonly new_credential_id_hex: string;
  readonly created_at_ms: number;
  readonly expires_at_ms: number;
  /** When it could complete, given its approvals so far; `null` before any. */
  readonly ready_at_ms: number | null;
  readonly guardian_signatures_collected: number;
  readonly finalized: boolean;
  readonly cancelled: boolean;
}

/** One guardian of an account, as the node lists it. */
export interface GuardianMember {
  readonly index: number;
  readonly p256_pubkey_hex: string;
  readonly role: string;
  readonly label?: string;
  readonly aaguid: string;
  readonly backup_eligible: boolean;
  readonly backup_state: boolean;
}

/** An account's recovery quorum, as the node lists it. */
export interface GuardianSet {
  readonly threshold: number;
  readonly independent_roots: number;
  readonly members: readonly GuardianMember[];
}

export interface RecoveryStarted {
  readonly recovery_id: string;
  readonly account_address: string;
  readonly recovery_op_hash_hex: string;
  readonly expires_at_ms: number;
  readonly guardians_required: number;
  readonly guardians_total: number;
}

/** What a recovering device hands its guardians. Public data only. */
export interface RecoveryRequest {
  readonly account: string;
  readonly recoveryId: string;
  readonly newPasskeyPublicKeyHex: string;
  readonly newCredentialIdHex: string;
  readonly expiresAtMs: number;
  readonly guardiansTotal: number;
}

const REQUEST_FORMAT = 'tenzro-recovery-request';

/** A recovery request as text a guardian can open (link fragment or paste). */
export function encodeRecoveryRequest(r: RecoveryRequest): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ format: REQUEST_FORMAT, ...r }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRecoveryRequest(text: string): RecoveryRequest {
  let r: RecoveryRequest & { format?: string };
  try {
    const b64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    r = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    throw new PasskeyError('This is not a recovery request.', 'invalid');
  }
  if (
    r?.format !== REQUEST_FORMAT ||
    typeof r.recoveryId !== 'string' ||
    fromHex(r.account).length === 0 ||
    fromHex(r.newPasskeyPublicKeyHex).length !== 64 ||
    fromHex(r.newCredentialIdHex).length === 0 ||
    !Number.isSafeInteger(r.expiresAtMs) ||
    !Number.isSafeInteger(r.guardiansTotal)
  ) {
    throw new PasskeyError('This is not a recovery request.', 'invalid');
  }
  return {
    account: r.account,
    recoveryId: r.recoveryId,
    newPasskeyPublicKeyHex: r.newPasskeyPublicKeyHex,
    newCredentialIdHex: r.newCredentialIdHex,
    expiresAtMs: r.expiresAtMs,
    guardiansTotal: r.guardiansTotal,
  };
}

export interface PasskeyCustodyOptions {
  readonly rpc: JsonRpcTransport;
  readonly authenticator: PasskeyAuthenticator;
}

const stripped = (hex: string) => normalizeHex(hex);

export class PasskeyCustody {
  readonly rpc: JsonRpcTransport;
  readonly authenticator: PasskeyAuthenticator;

  constructor(opts: PasskeyCustodyOptions) {
    this.rpc = opts.rpc;
    this.authenticator = opts.authenticator;
  }

  // ── Create ────────────────────────────────────────────────────────────

  /**
   * First device: create a passkey, derive the DID from its public key, prove
   * possession of it, and enrol. The node creates the smart account and the
   * human identity.
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
    // already on it opens its wallet instead of a new one being made. With
    // nothing on the device the request is refused at once, with no dialog.
    if (await this.authenticator.supportsImmediateGet?.()) {
      try {
        const found = await this.signIn({ ...opts, immediate: true });
        if (found.account) return { ...found, existing: true };
      } catch (err) {
        if (!(err instanceof PasskeyError) || (err.kind !== 'cancelled' && err.kind !== 'not-found')) throw err;
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
      salt: 0,
      authorization,
    });

    const expectedDid = humanDidFromPasskey(created.publicKey);
    if (enrolled.did !== expectedDid) {
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
      account: enrolled.smart_account_address,
      credentialId: credential.id,
      transports: created.transports,
      tier: created.tier,
      displayName: opts.displayName,
      ...(proofSignature
        ? { proof: ownershipProof(enrolled.smart_account_address, enrolled.did, proofSignature) }
        : {}),
    };
  }

  // ── Sign in ───────────────────────────────────────────────────────────

  /**
   * Discoverable sign-in on any device. Linked devices carry the 20-byte
   * account address as their user handle; the first passkey of an account is
   * found by recovering its public key from the assertion and resolving the
   * DID derived from it. With `challenge`, that one approval is also the
   * ownership proof.
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
      opts.challenge ? { ...a, proof: ownershipProof(a.account, a.did, signed) } : a;

    if (signed.userHandle && signed.userHandle.length === 20) {
      const account = toHex(signed.userHandle, true);
      const ids = await this.listCredentialIds(account).catch(() => [] as string[]);
      if (ids.includes(credentialId)) {
        const record = await this.getAccountRecord(account).catch(() => null);
        return withProof({
          did: record?.owner_did ?? '',
          account,
          credentialId,
          transports: [],
        });
      }
    }

    const candidates = recoverAssertionPublicKeys(
      new Uint8Array(signed.assertion.authenticator_data),
      new Uint8Array(signed.assertion.client_data_json),
      new Uint8Array(signed.assertion.signature),
    );
    for (const xy of candidates) {
      const did = humanDidFromPasskey(xy);
      const identity = await this.rpc
        .call<{ did: string; display_name?: string; metadata?: Record<string, string> }>(
          'tenzro_resolveIdentity',
          { did },
        )
        .catch(() => null);
      const account = identity?.metadata?.smart_account_address;
      if (identity && account) {
        return withProof({
          did,
          account,
          credentialId,
          transports: [],
          ...(identity.display_name ? { displayName: identity.display_name } : {}),
        });
      }
    }
    throw new PasskeyError(
      'No Tenzro account was found for this passkey on this node. Create a wallet first.',
      'not-found',
    );
  }

  // ── Devices ───────────────────────────────────────────────────────────

  /** Credential ids enrolled on the account (hex, no `0x`). */
  async listCredentialIds(account: string): Promise<string[]> {
    const res = await this.rpc.call<{ credential_ids: string[] }>('tenzro_listPasskeys', {
      account_address: account,
    });
    return res.credential_ids.map(stripped);
  }

  async getAccountRecord(account: string): Promise<AccountRecord | null> {
    const res = await this.rpc.call<{ record?: AccountRecord } | null>('tenzro_getAccountRecord', {
      account_address: account,
    });
    return res?.record ?? null;
  }

  /** The enrolled passkeys, with labels from the published account record. */
  async listDevices(account: PasskeyAccount): Promise<DeviceSummary[]> {
    const [ids, record] = await Promise.all([
      this.listCredentialIds(account.account),
      this.getAccountRecord(account.account).catch(() => null),
    ]);
    const recorded = new Map((record?.credentials ?? []).map((c) => [stripped(c.credential_id_hex), c]));
    return ids.map((id) => {
      const r = recorded.get(id);
      const thisDevice = id === stripped(account.credentialId);
      // The network's record of the passkey's sync state wins; this device's
      // own knowledge fills in where the record has none.
      const tier: PasskeyTier | undefined =
        typeof r?.backup_eligible === 'boolean'
          ? r.backup_eligible
            ? 'synced'
            : 'device-bound'
          : thisDevice
            ? account.tier
            : undefined;
      return {
        credentialIdHex: `0x${id}`,
        ...(r?.label ? { label: r.label } : {}),
        ...(tier ? { tier } : {}),
        ...(r?.aaguid ? { aaguid: stripped(r.aaguid) } : {}),
        thisDevice,
      };
    });
  }

  async readiness(account: PasskeyAccount): Promise<WalletReadiness> {
    return assessReadiness(await this.listDevices(account));
  }

  /**
   * Adds a passkey to the account: on this device (the usual case, approved
   * by a passkey on another device over hybrid/QR), or a roaming
   * authenticator such as a security key (`crossPlatform`, approved by this
   * device's passkey).
   *
   * Order follows the node: the new credential is created first, because the
   * `add_passkey` challenge names the new P-256 key as its target.
   *
   * The new credential is created with `user.id` = the 20-byte account
   * address, so signing in with it on a fresh device finds the account.
   */
  async linkDevice(opts: {
    readonly account: string;
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
    const existing = await this.listCredentialIds(opts.account);
    if (existing.length === 0) {
      throw new PasskeyError('This account has no enrolled passkey.', 'not-found');
    }
    const accountBytes = fromHex(opts.account);
    let created: Awaited<ReturnType<PasskeyAuthenticator['create']>>;
    try {
      created = await this.authenticator.create({
        userId: accountBytes.slice(-20),
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
        throw new PasskeyError('That device answered with a passkey from another account.', 'invalid');
      }
      return {
        account_address: opts.account,
        credential_id_hex: `0x${held}`,
        credentials_total: existing.length,
        already_linked: true,
      };
    }
    const newCredential: CredentialRef = {
      id: toHex(created.credentialId),
      transports: created.transports,
    };
    const challenge = await requestCustodyChallenge(
      this.rpc,
      opts.account,
      'add_passkey',
      created.publicKey,
    );
    const approvers = opts.approver ? [opts.approver] : existing.map((id) => ({ id }));
    const { authorization } = await authorizeChallenge(this.authenticator, challenge, approvers, {
      hybrid: !opts.approver,
    });
    if (stripped(authorization.credential_id_hex) === toHex(created.credentialId)) {
      throw new PasskeyError('The new passkey cannot approve its own addition.', 'invalid');
    }
    // The new passkey signs the same challenge: its signed flags prove what
    // its registration claims about syncing.
    const own = await this.authenticator.get({
      challenge: signingDigest(SignatureContext.AccountOwner, fromHex(challenge.challenge_hex)),
      allow: [newCredential],
      ...(opts.hints ? { hints: opts.hints } : {}),
    });

    return this.rpc.call('tenzro_addPasskey', {
      account_address: opts.account,
      new_passkey_public_key_hex: toHex(created.publicKey, true),
      new_credential_id_hex: toHex(created.credentialId, true),
      new_registration_authenticator_data_hex: toHex(created.registrationAuthenticatorData, true),
      label: opts.label,
      authorization,
      new_credential_proof: { assertion: own.assertion },
    });
  }

  /** Revokes a passkey. Refuses to remove the last one: the account would be unrecoverable. */
  async removeDevice(opts: {
    readonly account: string;
    readonly credentialIdHex: string;
    readonly approver: CredentialRef;
  }): Promise<{ removed: boolean; credentials_remaining: number }> {
    const ids = await this.listCredentialIds(opts.account);
    const target = stripped(opts.credentialIdHex);
    if (!ids.includes(target)) {
      throw new PasskeyError('That passkey is not enrolled on this account.', 'not-found');
    }
    if (ids.length <= 1) {
      throw new PasskeyError(
        'This is the only passkey on the account. Link another device before removing it.',
        'last-device',
      );
    }
    const authorization = await this.#authorize(
      opts.account,
      'remove_passkey',
      fromHex(target),
      opts.approver,
    );
    return this.rpc.call('tenzro_removePasskey', {
      account_address: opts.account,
      credential_id_hex: `0x${target}`,
      authorization,
    });
  }

  /** Signs a relying party's one-time `challenge` with this device's passkey on `account`. */
  async proveOwnership(account: PasskeyAccount, challenge: Uint8Array): Promise<OwnershipProof> {
    checkProofChallenge(challenge);
    const signed = await this.authenticator.get({
      challenge,
      allow: [{ id: account.credentialId, transports: account.transports }],
    });
    return ownershipProof(account.account, account.did, signed);
  }

  /**
   * Another wallet under the same identity: the identity's first passkey is
   * enrolled again with `salt`, which the node turns into a new account. It has
   * to run where that passkey is available (a synced passkey counts): a linked
   * device's passkey opens the same account but would derive another identity.
   */
  async addWallet(
    account: PasskeyAccount,
    opts: { readonly salt: number },
  ): Promise<PasskeyAccount & { readonly salt: number }> {
    if (!Number.isInteger(opts.salt) || opts.salt < 1) {
      throw new PasskeyError('A further wallet needs a salt of 1 or more.', 'invalid');
    }
    const record = await this.getAccountRecord(account.account);
    const root = record?.credentials?.find(
      (c) =>
        c.p256_public_key_hex &&
        humanDidFromPasskey(fromHex(c.p256_public_key_hex)) === account.did,
    );
    if (!root?.p256_public_key_hex) {
      throw new PasskeyError(
        "The network does not list this identity's first passkey on the account.",
        'not-found',
      );
    }
    const credential: CredentialRef = { id: stripped(root.credential_id_hex) };
    const xyHex = `0x${stripped(root.p256_public_key_hex)}`;
    const credentialId = fromHex(root.credential_id_hex);
    const challenge = await requestCustodyChallenge(this.rpc, xyHex, 'enroll_passkey', credentialId);
    const { authorization } = await authorizeChallenge(this.authenticator, challenge, [credential]);
    const enrolled = await this.rpc.call<EnrollPasskeyResult>('tenzro_enrollPasskey', {
      passkey_public_key_hex: xyHex,
      credential_id_hex: toHex(credentialId, true),
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
      credentialId: credential.id,
      salt: opts.salt,
    };
  }

  // ── Policy and limits ─────────────────────────────────────────────────

  async getSecondFactor(account: string): Promise<{
    second_factor: SecondFactorPolicy;
    required_signatures: number;
    credentials_enrolled: number;
  }> {
    return this.rpc.call('tenzro_getPasskeyPolicy', { account_address: account });
  }

  /** `two_credentials`: every transaction needs two different passkeys. */
  async setSecondFactor(opts: {
    readonly account: string;
    readonly policy: SecondFactorPolicy;
    readonly approver: CredentialRef;
  }): Promise<unknown> {
    if (opts.policy === 'two_credentials') {
      const ids = await this.listCredentialIds(opts.account);
      if (ids.length < 2) {
        throw new PasskeyError('Two-device approval needs at least two passkeys.', 'invalid');
      }
    }
    const authorization = await this.#authorize(
      opts.account,
      'set_passkey_policy',
      new Uint8Array(0),
      opts.approver,
    );
    return this.rpc.call('tenzro_setPasskeyPolicy', {
      account_address: opts.account,
      second_factor: opts.policy,
      authorization,
    });
  }

  /**
   * Account-wide spending caps, in wei (decimal strings, `"0"` = no cap).
   * `authenticator_pubkey_hex` identifies the approving passkey: SHA-256 of
   * its credential id (the node requires 32 bytes).
   */
  async setSpendingLimit(opts: {
    readonly account: string;
    readonly perTxCapWei: string;
    readonly dailyCapWei: string;
    readonly approver: CredentialRef;
  }): Promise<unknown> {
    const authorization = await this.#authorize(
      opts.account,
      'set_spending_limit',
      new Uint8Array(0),
      opts.approver,
    );
    return this.rpc.call('tenzro_setSpendingLimit', {
      account_address: opts.account,
      per_tx_cap_wei: opts.perTxCapWei,
      daily_cap_wei: opts.dailyCapWei,
      authenticator_pubkey_hex: toHex(sha256(fromHex(opts.approver.id)), true),
      authorization,
    });
  }

  /**
   * Lets an agent spend from this account within limits: installs a scoped
   * session key held by the agent's own device. The challenge target is the
   * session public key.
   */
  async grantSessionKey(opts: {
    readonly account: string;
    readonly grant: SessionKeyGrant;
    readonly approver: CredentialRef;
  }): Promise<unknown> {
    const key = fromHex(opts.grant.sessionPublicKeyHex);
    if (key.length !== 32)
      throw new PasskeyError('A session key must be 32 bytes (Ed25519).', 'invalid');
    const authorization = await this.#authorize(
      opts.account,
      'grant_session_key',
      key,
      opts.approver,
    );
    const g = opts.grant;
    return this.rpc.call('tenzro_grantSessionKey', {
      account_address: opts.account,
      session_pubkey_hex: toHex(key),
      allowed_selectors_hex: g.allowedSelectors.map(stripped),
      allowed_targets: g.allowedTargets ?? [],
      ...(g.maxValuePerCallWei !== undefined
        ? { max_value_per_call_wei: g.maxValuePerCallWei }
        : {}),
      ...(g.maxTotalValueWei !== undefined ? { max_total_value_wei: g.maxTotalValueWei } : {}),
      valid_after_unix: g.validAfterUnix,
      valid_until_unix: g.validUntilUnix,
      ...(g.label ? { label: g.label } : {}),
      authorization,
    });
  }

  async revokeSessionKey(opts: {
    readonly account: string;
    readonly approver: CredentialRef;
  }): Promise<unknown> {
    const authorization = await this.#authorize(
      opts.account,
      'revoke_session_key',
      new Uint8Array(0),
      opts.approver,
    );
    return this.rpc.call('tenzro_revokeSessionKey', {
      account_address: opts.account,
      authorization,
    });
  }

  // ── Recovery ──────────────────────────────────────────────────────────

  /** The account's guardians and threshold. Public. */
  async listGuardians(account: string): Promise<GuardianSet> {
    const r = await this.rpc.call<GuardianSet>('tenzro_listGuardians', { account_address: account });
    return { threshold: r.threshold, independent_roots: r.independent_roots, members: r.members ?? [] };
  }

  /**
   * Adds a guardian from its card. The approval names the guardian's key,
   * provider, backup flags, role and label, so it cannot be spent on a
   * different guardian. `threshold` sets the quorum; the network refuses one
   * above the guardians' independent roots.
   */
  async addGuardian(opts: {
    readonly account: string;
    readonly card: GuardianCard;
    readonly threshold?: number;
    readonly approver: CredentialRef;
  }): Promise<{ guardian_count: number; threshold: number }> {
    const card = opts.card;
    const authorization = await this.#authorize(
      opts.account,
      'add_guardian',
      guardianTarget(card),
      opts.approver,
    );
    const label = card.label.trim();
    return this.rpc.call('tenzro_addGuardian', {
      account_address: opts.account,
      guardian_p256_pubkey_hex: card.p256,
      guardian_registration_authenticator_data_hex: card.registrationAuthenticatorData,
      guardian_credential_id_hex: card.credentialId,
      role: card.role,
      ...(label ? { label } : {}),
      ...(opts.threshold !== undefined ? { threshold: opts.threshold } : {}),
      authorization,
    });
  }

  /**
   * Starts recovery from a new device after losing the others: creates a
   * passkey here and asks the account's guardians to approve adding it.
   */
  async startRecovery(opts: {
    readonly account: string;
    readonly label: string;
    readonly ttlSecs?: number;
    readonly hints?: readonly PasskeyHint[];
  }): Promise<RecoveryStarted & { readonly credentialId: string; readonly request: RecoveryRequest }> {
    const created = await this.authenticator.create({
      userId: fromHex(opts.account).slice(-20),
      userName: opts.label,
      ...(opts.hints ? { hints: opts.hints } : {}),
    });
    const started = await this.rpc.call<RecoveryStarted>('tenzro_initiateRecovery', {
      account_address: opts.account,
      new_passkey_public_key_hex: toHex(created.publicKey, true),
      new_credential_id_hex: toHex(created.credentialId, true),
      new_registration_authenticator_data_hex: toHex(created.registrationAuthenticatorData, true),
      ...(opts.ttlSecs !== undefined ? { ttl_secs: opts.ttlSecs } : {}),
    });
    const request: RecoveryRequest = {
      account: opts.account,
      recoveryId: started.recovery_id,
      newPasskeyPublicKeyHex: toHex(created.publicKey, true),
      newCredentialIdHex: toHex(created.credentialId, true),
      expiresAtMs: started.expires_at_ms,
      guardiansTotal: started.guardians_total,
    };
    const expected = recoveryOpHash({
      account: opts.account,
      newPasskeyPublicKey: created.publicKey,
      newCredentialId: created.credentialId,
      recoveryId: started.recovery_id,
      expiresAtMs: started.expires_at_ms,
    });
    if (stripped(started.recovery_op_hash_hex) !== toHex(expected)) {
      throw new PasskeyError('The network started a recovery for a different passkey.', 'invalid');
    }
    return { ...started, credentialId: toHex(created.credentialId), request };
  }

  /** Submits one guardian's approval of a recovery. */
  async submitRecoverySignature(opts: {
    readonly recoveryId: string;
    readonly guardianIndex: number;
    readonly signature: CompositeSignatureJson;
  }): Promise<{
    guardian_signatures_collected: number;
    guardians_required: number;
    quorum_reached: boolean;
    /** When the recovery can complete; until then any passkey on the account can cancel it. */
    ready_at_ms: number | null;
  }> {
    return this.rpc.call('tenzro_submitRecoverySignature', {
      recovery_id: opts.recoveryId,
      guardian_index: opts.guardianIndex,
      signature: opts.signature,
    });
  }

  /** Completes a recovery once its wait is over. The new passkey joins the existing ones. */
  async finalizeRecovery(recoveryId: string): Promise<{
    account_address: string;
    new_credential_id_hex: string;
  }> {
    return this.rpc.call('tenzro_finalizeRecovery', { recovery_id: recoveryId });
  }

  /** Recoveries started on the account, so its owner can see and cancel them. */
  async listPendingRecoveries(account: string): Promise<PendingRecovery[]> {
    const r = await this.rpc.call<{ pending_recoveries: PendingRecovery[] }>(
      'tenzro_listPendingRecoveries',
      { account_address: account },
    );
    return r.pending_recoveries ?? [];
  }

  /**
   * Cancels a recovery during its wait, approved by a passkey on the account.
   * This is how an owner who still has a device stops a recovery they did not
   * start.
   */
  async cancelRecovery(opts: {
    readonly account: string;
    readonly recoveryId: string;
    readonly approver: CredentialRef;
  }): Promise<{ recovery_id: string; cancelled: boolean }> {
    const authorization = await this.#authorize(
      opts.account,
      'cancel_recovery',
      new TextEncoder().encode(opts.recoveryId),
      opts.approver,
    );
    return this.rpc.call('tenzro_cancelRecovery', {
      recovery_id: opts.recoveryId,
      authorization,
    });
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
      throw new PasskeyError(`A guardian label is at most ${MAX_GUARDIAN_LABEL_BYTES} bytes.`, 'invalid');
    }
    const created = await this.authenticator.create({
      userId: randomBytes(16),
      userName: `Tenzro guardian: ${label}`,
      ...(opts.hints ? { hints: opts.hints, crossPlatform: opts.hints.includes('security-key') } : {}),
    });
    return {
      format: 'tenzro-guardian',
      version: 2,
      label,
      role: guardianRole(opts.source),
      p256: toHex(created.publicKey, true),
      credentialId: toHex(created.credentialId, true),
      registrationAuthenticatorData: toHex(created.registrationAuthenticatorData, true),
    };
  }

  /**
   * Guardian side: approves a recovery with the guardian passkey on this
   * device. The approval is computed here from the request and checked against
   * the recovery the node lists for the account, so a guardian never signs a
   * hash it was merely handed. The guardian's index is found by matching the
   * key that signed against the account's listed guardians.
   */
  async approveRecovery(request: RecoveryRequest): Promise<{
    guardian_signatures_collected: number;
    guardians_required: number;
    quorum_reached: boolean;
    ready_at_ms: number | null;
  }> {
    const pending = (await this.listPendingRecoveries(request.account)).find(
      (r) => r.recovery_id === request.recoveryId,
    );
    if (!pending || pending.finalized || pending.cancelled) {
      throw new PasskeyError('The network has no open recovery matching this request.', 'invalid');
    }
    if (
      stripped(pending.new_credential_id_hex) !== stripped(request.newCredentialIdHex) ||
      pending.expires_at_ms !== request.expiresAtMs
    ) {
      throw new PasskeyError('This request does not match the recovery the network holds.', 'invalid');
    }
    const { members } = await this.listGuardians(request.account);
    if (members.length === 0) {
      throw new PasskeyError('This account has no guardians.', 'not-found');
    }
    const opHash = recoveryOpHash({
      account: request.account,
      newPasskeyPublicKey: fromHex(request.newPasskeyPublicKeyHex),
      newCredentialId: fromHex(request.newCredentialIdHex),
      recoveryId: request.recoveryId,
      expiresAtMs: request.expiresAtMs,
    });
    const signed = await this.authenticator.get({ challenge: recoveryApprovalChallenge(opHash), allow: [] });
    const a = signed.assertion;
    const candidates = recoverAssertionPublicKeys(
      new Uint8Array(a.authenticator_data),
      new Uint8Array(a.client_data_json),
      new Uint8Array(a.signature),
    ).map((k) => toHex(k));
    const member = members.find((m) => candidates.includes(stripped(m.p256_pubkey_hex)));
    if (!member) {
      throw new PasskeyError('This passkey is not a guardian of the account.', 'invalid');
    }
    return this.submitRecoverySignature({
      recoveryId: request.recoveryId,
      guardianIndex: member.index,
      signature: compositeSignatureJson(signed),
    });
  }

  // ── internals ─────────────────────────────────────────────────────────

  async #authorize(
    account: string,
    operation: CustodyOperation,
    target: Uint8Array,
    approver: CredentialRef,
  ): Promise<CustodyAuthorization> {
    const challenge = await requestCustodyChallenge(this.rpc, account, operation, target);
    const { authorization } = await authorizeChallenge(this.authenticator, challenge, [approver]);
    return authorization;
  }
}
