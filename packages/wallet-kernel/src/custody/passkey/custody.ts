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
 * no secret: the passkey lives in the authenticator, and the ML-DSA-65 key is
 * re-derived from the passkey's PRF output whenever it is needed.
 *
 * Request shapes mirror `crates/tenzro-node/src/passkey_rpc.rs` field for field.
 */

import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, fromHex, normalizeHex, randomBytes, toHex } from './bytes.ts';
import { deriveCustodyKey, humanDidFromPasskey, recoverAssertionPublicKeys } from './derive.ts';
import {
  type CustodyAuthorization,
  type CustodyOperation,
  authorizeChallenge,
  requestCustodyChallenge,
} from './gate.ts';
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
  readonly ml_dsa_public_key_hex?: string;
  readonly label?: string | null;
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

export interface GuardianInput {
  /** Composite key of the guardian identity. */
  readonly ed25519PublicKeyHex: string;
  readonly mlDsaPublicKeyHex: string;
  readonly label?: string;
  readonly threshold?: number;
}

export interface RecoveryStarted {
  readonly recovery_id: string;
  readonly account_address: string;
  readonly recovery_op_hash_hex: string;
  readonly expires_at_ms: number;
  readonly guardians_required: number;
  readonly guardians_total: number;
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
   * First device: create a passkey, derive the DID from it and the ML-DSA-65
   * key from its PRF output, prove possession of both, and enrol. The node
   * creates the smart account and the human identity.
   *
   * Two approvals when the authenticator returns the PRF output at creation,
   * three when it does not. With `challenge`, the PRF read signs it and doubles
   * as the ownership proof; only an authenticator that returned the PRF at
   * creation needs one more approval for the proof.
   */
  async createWallet(
    opts: { readonly displayName: string } & PasskeyEntryOptions,
  ): Promise<PasskeyAccount & { readonly proof?: OwnershipProof }> {
    checkProofChallenge(opts.challenge);
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
    let proofSignature: PasskeySignature | undefined;
    let prf = created.prf;
    if (!prf) {
      const read = await this.#readPrf(credential, opts.challenge, hints);
      prf = read.prf;
      if (opts.challenge) proofSignature = read.signed;
    }
    const { publicKey: mlDsaPublicKey, secretKey } = deriveCustodyKey(prf);
    secretKey.fill(0);

    // Enrolment challenge: the "account" is the P-256 key being enrolled and
    // the target binds the credential id and the ML-DSA key.
    const xyHex = toHex(created.publicKey, true);
    const challenge = await requestCustodyChallenge(
      this.rpc,
      xyHex,
      'enroll_passkey',
      concatBytes(created.credentialId, mlDsaPublicKey),
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
      ml_dsa_public_key_hex: toHex(mlDsaPublicKey, true),
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
    if (opts.challenge && !proofSignature) {
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
    const labels = new Map(
      (record?.credentials ?? []).map((c) => [stripped(c.credential_id_hex), c.label ?? undefined]),
    );
    return ids.map((id) => {
      const label = labels.get(id);
      const thisDevice = id === stripped(account.credentialId);
      return {
        credentialIdHex: `0x${id}`,
        ...(label ? { label } : {}),
        ...(thisDevice && account.tier ? { tier: account.tier } : {}),
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
  }): Promise<{ account_address: string; credential_id_hex: string; credentials_total: number }> {
    const existing = await this.listCredentialIds(opts.account);
    if (existing.length === 0) {
      throw new PasskeyError('This account has no enrolled passkey.', 'not-found');
    }
    const accountBytes = fromHex(opts.account);
    const created = await this.authenticator.create({
      userId: accountBytes.slice(-20),
      userName: opts.label,
      exclude: existing.map((id) => ({ id })),
      ...(opts.crossPlatform ? { crossPlatform: true } : {}),
      ...(opts.hints ? { hints: opts.hints } : {}),
    });
    // The new device's post-quantum leg, derived from its own PRF. The node
    // records it with the credential and never mints it.
    const newCredential: CredentialRef = {
      id: toHex(created.credentialId),
      transports: created.transports,
    };
    const newPrf = created.prf ?? (await this.#readPrf(newCredential, undefined, opts.hints)).prf;
    const { publicKey: newMlDsaPublicKey, secretKey: newSecret } = deriveCustodyKey(newPrf);
    newSecret.fill(0);

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

    return this.rpc.call('tenzro_addPasskey', {
      account_address: opts.account,
      new_passkey_public_key_hex: toHex(created.publicKey, true),
      new_credential_id_hex: toHex(created.credentialId, true),
      new_pq_verifying_key_hex: toHex(newMlDsaPublicKey, true),
      label: opts.label,
      authorization,
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
    const prf = await this.#prfFor(credential);
    const { publicKey: mlDsaPublicKey, secretKey } = deriveCustodyKey(prf);
    secretKey.fill(0);

    const xyHex = `0x${stripped(root.p256_public_key_hex)}`;
    const credentialId = fromHex(root.credential_id_hex);
    const challenge = await requestCustodyChallenge(
      this.rpc,
      xyHex,
      'enroll_passkey',
      concatBytes(credentialId, mlDsaPublicKey),
    );
    const { authorization } = await authorizeChallenge(this.authenticator, challenge, [credential]);
    const enrolled = await this.rpc.call<EnrollPasskeyResult>('tenzro_enrollPasskey', {
      passkey_public_key_hex: xyHex,
      credential_id_hex: toHex(credentialId, true),
      ml_dsa_public_key_hex: toHex(mlDsaPublicKey, true),
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

  /** Registers a guardian (another identity's composite Ed25519 + ML-DSA-65 key). */
  async addGuardian(opts: {
    readonly account: string;
    readonly guardian: GuardianInput;
    readonly approver: CredentialRef;
  }): Promise<{ guardian_count: number; threshold: number }> {
    const authorization = await this.#authorize(
      opts.account,
      'add_guardian',
      new Uint8Array(0),
      opts.approver,
    );
    const g = opts.guardian;
    return this.rpc.call('tenzro_addGuardian', {
      account_address: opts.account,
      guardian_ed25519_pubkey_hex: g.ed25519PublicKeyHex,
      guardian_ml_dsa_pubkey_hex: g.mlDsaPublicKeyHex,
      ...(g.label ? { label: g.label } : {}),
      ...(g.threshold !== undefined ? { threshold: g.threshold } : {}),
      authorization,
    });
  }

  /**
   * Starts recovery from a new device after losing the others: creates a
   * passkey here, derives its ML-DSA-65 key, and asks the account's guardians
   * to approve. The guardians sign the returned hash with their own keys.
   */
  async startRecovery(opts: {
    readonly account: string;
    readonly label: string;
    readonly ttlSecs?: number;
  }): Promise<RecoveryStarted & { readonly credentialId: string }> {
    const created = await this.authenticator.create({
      userId: fromHex(opts.account).slice(-20),
      userName: opts.label,
    });
    const credential: CredentialRef = {
      id: toHex(created.credentialId),
      transports: created.transports,
    };
    const prf = created.prf ?? (await this.#prfFor(credential));
    const { publicKey, secretKey } = deriveCustodyKey(prf);
    secretKey.fill(0);
    const started = await this.rpc.call<RecoveryStarted>('tenzro_initiateRecovery', {
      account_address: opts.account,
      new_passkey_public_key_hex: toHex(created.publicKey, true),
      new_credential_id_hex: toHex(created.credentialId, true),
      new_ml_dsa_public_key_hex: toHex(publicKey, true),
      ...(opts.ttlSecs !== undefined ? { ttl_secs: opts.ttlSecs } : {}),
    });
    return { ...started, credentialId: credential.id };
  }

  /**
   * Submits one guardian's approval of a recovery: `signature` is the composite
   * signature over the recovery's `recovery_op_hash_hex` (see `RecoveryKey`).
   */
  async submitRecoverySignature(opts: {
    readonly recoveryId: string;
    readonly guardianIndex: number;
    readonly signatureHex: string;
  }): Promise<{
    guardian_signatures_collected: number;
    guardians_required: number;
    quorum_reached: boolean;
  }> {
    return this.rpc.call('tenzro_submitRecoverySignature', {
      recovery_id: opts.recoveryId,
      guardian_index: opts.guardianIndex,
      composite_signature_hex: opts.signatureHex,
    });
  }

  async finalizeRecovery(recoveryId: string): Promise<{
    account_address: string;
    new_credential_id_hex: string;
  }> {
    return this.rpc.call('tenzro_finalizeRecovery', { recovery_id: recoveryId });
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

  /** One extra assertion to read the PRF when the authenticator did not return it at creation. */
  async #prfFor(credential: CredentialRef): Promise<Uint8Array> {
    return (await this.#readPrf(credential)).prf;
  }

  /** Reads the PRF with an assertion over `challenge` (random when omitted), and returns both. */
  async #readPrf(
    credential: CredentialRef,
    challenge?: Uint8Array,
    hints?: readonly PasskeyHint[],
  ): Promise<{ prf: Uint8Array; signed: PasskeySignature }> {
    const signed = await this.authenticator.get({
      challenge: challenge ?? randomBytes(32),
      allow: [credential],
      ...(hints ? { hints } : {}),
    });
    if (!signed.prf) {
      throw new PasskeyError(
        'This passkey provider cannot derive keys (PRF). Try a phone, a security key, or a different browser.',
        'no-prf',
      );
    }
    return { prf: signed.prf, signed };
  }
}
