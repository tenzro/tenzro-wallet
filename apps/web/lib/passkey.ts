/**
 * Passkeys through WebAuthn. The private key never leaves the authenticator:
 * the wallet holds only public data (credential id, public key, flags) and
 * asks the authenticator to sign each digest the SDK builds.
 */

import {
  ACCOUNT_OWNER_SIGNATURE_CONTEXT,
  COMPOSITE_LABEL_MLDSA65_P256,
  type HybridSigner,
  type KeystoreCredential,
  type WebAuthnAssertion,
  compositeMessageRepresentative,
  rawP256,
  registrationFacts,
  webauthnChallengeOf,
} from 'tenzro-sdk';

import { fromBase64Url, fromHex, toHex } from './bytes';
import { type PqKey, pqKeyFromPrf, pqSign, prfSalt } from './pq';

/** The part of `navigator.credentials` the wallet uses; tests pass their own. */
export interface CredentialsApi {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

export function browserCredentials(): CredentialsApi {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('This browser cannot use passkeys.');
  }
  return navigator.credentials;
}

/** A passkey's public facts: everything the keystore records about it. */
export interface Passkey {
  readonly rpId: string;
  /** Hex, no prefix. */
  readonly credentialId: string;
  /** P-256 `x || y`, hex, no prefix. */
  readonly publicKey: string;
  readonly aaguid: string;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly label: string;
  /** The ML-DSA-65 verifying key derived from this passkey's PRF, hex; public. */
  readonly pqPublicKey?: string;
}

/** A new passkey plus the registration's authenticator data, which the node checks once. */
export interface CreatedPasskey extends Passkey {
  readonly registrationAuthenticatorData: Uint8Array;
}

export interface CreateOptions {
  readonly rpId: string;
  readonly rpName: string;
  readonly userName: string;
  readonly label: string;
  /** A roaming security key rather than this device's platform authenticator. */
  readonly securityKey?: boolean;
}

export async function createPasskey(
  opts: CreateOptions,
  api: CredentialsApi = browserCredentials(),
): Promise<CreatedPasskey> {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const credential = (await api.create({
    publicKey: {
      rp: { id: opts.rpId, name: opts.rpName },
      user: { id: userId, name: opts.userName, displayName: opts.userName },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
        ...(opts.securityKey ? { authenticatorAttachment: 'cross-platform' as const } : {}),
      },
      attestation: 'none',
      extensions: { prf: { eval: { first: prfSalt() } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('No passkey was created.');
  const response = credential.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey?.();
  if (!spki) throw new Error('This browser does not expose the new passkey’s public key.');
  const authenticatorData = new Uint8Array(response.getAuthenticatorData());
  const facts = registrationFacts(authenticatorData);
  return {
    rpId: opts.rpId,
    credentialId: toHex(credential.rawId),
    publicKey: rawP256(new Uint8Array(spki)),
    aaguid: facts.aaguid,
    backupEligible: facts.backupEligible,
    backupState: facts.backupState,
    label: opts.label,
    registrationAuthenticatorData: authenticatorData,
  };
}

/** The keystore entry for `passkey`. The chain sets its timing fields. */
export function keystoreCredential(passkey: Passkey): KeystoreCredential {
  return {
    rp_id: passkey.rpId,
    credential_id: passkey.credentialId,
    public_key: passkey.publicKey,
    aaguid: passkey.aaguid,
    backup_eligible: passkey.backupEligible,
    backup_state: passkey.backupState,
    counts_as_root_from_ms: 0,
    label: passkey.label,
  };
}

/** A passkey as the keystore lists it, back in the wallet's form. */
export function passkeyOf(credential: KeystoreCredential): Passkey {
  return {
    rpId: credential.rp_id,
    credentialId: credential.credential_id.replace(/^0x/, ''),
    publicKey: credential.public_key.replace(/^0x/, ''),
    aaguid: credential.aaguid,
    backupEligible: credential.backup_eligible,
    backupState: credential.backup_state,
    label: credential.label,
  };
}

interface RawAssertion {
  readonly credentialId: string;
  readonly authenticatorData: Uint8Array;
  readonly clientDataJson: Uint8Array;
  readonly signature: Uint8Array;
  readonly userHandle: Uint8Array | null;
  /** The authenticator's PRF answer for the wallet's salt, when it gave one. */
  readonly prf: Uint8Array | null;
}

async function assert(
  api: CredentialsApi,
  rpId: string,
  challenge: Uint8Array,
  credentialId?: string,
): Promise<RawAssertion> {
  const credential = (await api.get({
    publicKey: {
      challenge,
      rpId,
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfSalt() } } } as AuthenticationExtensionsClientInputs,
      ...(credentialId
        ? { allowCredentials: [{ type: 'public-key' as const, id: fromHex(credentialId) }] }
        : {}),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('The passkey did not answer.');
  const response = credential.response as AuthenticatorAssertionResponse;
  const results = credential.getClientExtensionResults?.() as
    | { prf?: { results?: { first?: ArrayBuffer } } }
    | undefined;
  const first = results?.prf?.results?.first;
  return {
    prf: first ? new Uint8Array(first) : null,
    credentialId: toHex(credential.rawId),
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJson: new Uint8Array(response.clientDataJSON),
    signature: new Uint8Array(response.signature),
    userHandle: response.userHandle ? new Uint8Array(response.userHandle) : null,
  };
}

/**
 * A passkey as the SDK's signer: every approval, proof of possession and
 * transaction the SDK builds is signed by the authenticator over the
 * challenge the SDK derives from it.
 */
export class PasskeySigner implements HybridSigner {
  constructor(
    readonly passkey: Passkey,
    private readonly api: CredentialsApi = browserCredentials(),
    /**
     * Whether signatures carry the ML-DSA-65 leg. A passkey that is not yet
     * enrolled (one a device is about to link) signs with its P-256 leg only.
     */
    private readonly withPq = true,
  ) {}

  p256PublicKey(): Uint8Array {
    return fromHex(this.passkey.publicKey);
  }

  /** The ML-DSA-65 key derived from this passkey, known from its enrolment. */
  mlDsaPublicKey(): Uint8Array | null {
    return this.passkey.pqPublicKey ? fromHex(this.passkey.pqPublicKey) : null;
  }

  async signComposite(mPrime: Uint8Array): Promise<[WebAuthnAssertion, Uint8Array | null]> {
    const challenge = fromBase64Url(await webauthnChallengeOf(mPrime));
    const a = await assert(this.api, this.passkey.rpId, challenge, this.passkey.credentialId);
    const pq = await this.pqOf(a);
    return [
      {
        authenticatorData: a.authenticatorData,
        clientDataJson: a.clientDataJson,
        signature: a.signature,
      },
      pq ? pqSign(pq, mPrime, COMPOSITE_LABEL_MLDSA65_P256) : null,
    ];
  }

  /** The key the assertion's PRF answer derives; it must be the one the passkey enrolled. */
  private async pqOf(a: RawAssertion): Promise<PqKey | null> {
    if (!this.withPq) return null;
    if (!a.prf) {
      if (this.passkey.pqPublicKey) {
        throw new Error(
          'This passkey did not answer the key derivation the account needs. Use the device or security key that created it.',
        );
      }
      return null;
    }
    const key = await pqKeyFromPrf(a.prf);
    if (this.passkey.pqPublicKey && toHex(key.publicKey) !== this.passkey.pqPublicKey) {
      throw new Error(
        'This passkey derived a different post-quantum key than the account enrolled.',
      );
    }
    return key;
  }

  /** An assertion over a node-issued custody challenge (base64url), in the node's JSON form. */
  async assertChallenge(webauthnChallenge: string): Promise<Record<string, unknown>> {
    return (await this.authorizeChallenge(webauthnChallenge)).assertion;
  }

  /**
   * An assertion over a node-issued custody challenge plus the ML-DSA-65
   * leg over the same digest (`challengeHex`, the challenge's digest) and
   * the key that made it.
   */
  async authorizeChallenge(
    webauthnChallenge: string,
    challengeHex?: string,
  ): Promise<{
    assertion: Record<string, unknown>;
    pq: PqKey | null;
    mlDsaSignatureHex?: string | undefined;
  }> {
    const a = await assert(
      this.api,
      this.passkey.rpId,
      fromBase64Url(webauthnChallenge),
      this.passkey.credentialId,
    );
    const pq = await this.pqOf(a);
    let mlDsaSignatureHex: string | undefined;
    if (pq && challengeHex) {
      const rep = await compositeMessageRepresentative(
        ACCOUNT_OWNER_SIGNATURE_CONTEXT,
        fromHex(challengeHex),
      );
      mlDsaSignatureHex = `0x${toHex(pqSign(pq, rep, COMPOSITE_LABEL_MLDSA65_P256))}`;
    }
    return {
      pq,
      mlDsaSignatureHex,
      assertion: {
        authenticator_data: Array.from(a.authenticatorData),
        client_data_json: Array.from(a.clientDataJson),
        signature: Array.from(a.signature),
      },
    };
  }
}

/** Which passkey the person picks on this device, for signing in. */
export async function pickPasskey(
  rpId: string,
  api: CredentialsApi = browserCredentials(),
): Promise<string> {
  const a = await assert(api, rpId, crypto.getRandomValues(new Uint8Array(32)));
  return a.credentialId;
}
