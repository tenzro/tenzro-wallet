/**
 * WebAuthn seam for passkey custody.
 *
 * `PasskeyAuthenticator` is the port the custody flows drive; the browser
 * implementation wraps `navigator.credentials`. Tests (and non-browser hosts
 * such as a desktop shell) inject their own implementation.
 *
 * Rules enforced here, for every ceremony:
 *   - P-256 (ES256) only: the network verifies P-256 assertions only.
 *   - User verification is required (PIN or biometric), and the UV flag must
 *     be set in the returned authenticator data.
 *   - The PRF extension is always requested with the canonical Tenzro salt, so
 *     the post-quantum key can be derived without an extra prompt.
 *   - The backup flags set the trust tier: a synced passkey (BE = 1) is a
 *     lower tier and can never be the only root of an account.
 */

import {
  asBytes,
  fromHex,
  randomBytes,
  toArrayBuffer,
  toHex,
  toNumberArray,
} from './bytes.ts';
import { COSE_ES256, DEFAULT_RP_ID, DEFAULT_RP_NAME } from './constants.ts';
import { custodyPrfSalt, normalizeP256PublicKey } from './derive.ts';

/** `device-bound` (BE = 0) or `synced` (BE = 1, the credential can move between devices). */
export type PasskeyTier = 'device-bound' | 'synced';

/** A credential the ceremony may use, by id (hex) and optional transports hint. */
export interface CredentialRef {
  readonly id: string;
  readonly transports?: readonly string[];
}

/** A WebAuthn assertion in the node's wire format: byte fields as JSON number arrays. */
export interface WebAuthnAssertionWire {
  readonly authenticator_data: number[];
  readonly client_data_json: number[];
  readonly signature: number[];
  readonly user_handle: number[] | null;
}

export interface CreatedPasskey {
  readonly credentialId: Uint8Array;
  /** Raw P-256 public key, `x || y` (64 bytes). */
  readonly publicKey: Uint8Array;
  readonly transports: readonly string[];
  readonly tier: PasskeyTier;
  /** PRF output, when the authenticator returned it at creation. */
  readonly prf?: Uint8Array;
}

export interface PasskeySignature {
  readonly credentialId: Uint8Array;
  readonly assertion: WebAuthnAssertionWire;
  readonly prf?: Uint8Array;
  readonly userHandle?: Uint8Array;
}

export interface CreatePasskeyOptions {
  /** WebAuthn `user.id`. The account address (20 bytes) for linked devices. */
  readonly userId: Uint8Array;
  readonly userName: string;
  /** Credentials already on the account, so the same authenticator is not enrolled twice. */
  readonly exclude?: readonly CredentialRef[];
  /** Ask for a roaming authenticator (security key, or a phone over hybrid). */
  readonly crossPlatform?: boolean;
}

export interface GetPasskeyOptions {
  /** Raw bytes the authenticator signs as the WebAuthn challenge. */
  readonly challenge: Uint8Array;
  /** Empty or omitted: discoverable sign-in (the user picks a passkey). */
  readonly allow?: readonly CredentialRef[];
  /** Offer every transport, including a phone over hybrid (QR). */
  readonly hybrid?: boolean;
}

export interface PasskeyAuthenticator {
  readonly rpId: string;
  create(opts: CreatePasskeyOptions): Promise<CreatedPasskey>;
  get(opts: GetPasskeyOptions): Promise<PasskeySignature>;
}

export type PasskeyErrorKind =
  | 'unsupported'
  | 'cancelled'
  | 'no-user-verification'
  | 'no-prf'
  | 'already-enrolled'
  | 'not-found'
  | 'last-device'
  | 'invalid';

export class PasskeyError extends Error {
  readonly kind: PasskeyErrorKind;
  constructor(message: string, kind: PasskeyErrorKind) {
    super(message);
    this.name = 'PasskeyError';
    this.kind = kind;
  }
}

export interface AuthenticatorFlags {
  readonly userPresent: boolean;
  readonly userVerified: boolean;
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
}

/** Reads the flags byte (`authenticatorData[32]`). */
export function parseAuthenticatorFlags(authenticatorData: Uint8Array): AuthenticatorFlags {
  if (authenticatorData.length < 37) {
    throw new PasskeyError('authenticator data is too short', 'invalid');
  }
  const f = authenticatorData[32] ?? 0;
  return {
    userPresent: (f & 0x01) !== 0,
    userVerified: (f & 0x04) !== 0,
    backupEligible: (f & 0x08) !== 0,
    backedUp: (f & 0x10) !== 0,
  };
}

/** Validates the flags of a ceremony and returns the credential's trust tier. */
export function checkAuthenticatorFlags(authenticatorData: Uint8Array): PasskeyTier {
  const flags = parseAuthenticatorFlags(authenticatorData);
  if (!flags.userVerified) {
    throw new PasskeyError(
      'The authenticator did not verify you. Use a PIN, fingerprint or face unlock.',
      'no-user-verification',
    );
  }
  if (flags.backedUp && !flags.backupEligible) {
    throw new PasskeyError('The authenticator reported inconsistent backup flags.', 'invalid');
  }
  return flags.backupEligible ? 'synced' : 'device-bound';
}

/** Whether this runtime can run passkey custody at all (secure context, WebAuthn, PRF). */
export async function passkeySupport(): Promise<{ ok: boolean; reason?: string }> {
  const g = globalThis as {
    isSecureContext?: boolean;
    PublicKeyCredential?: {
      getClientCapabilities?: () => Promise<Record<string, boolean>>;
    };
  };
  if (!g.isSecureContext || !g.PublicKeyCredential) {
    return {
      ok: false,
      reason: 'Passkeys need an up-to-date browser on a secure (HTTPS) page.',
    };
  }
  const caps = await g.PublicKeyCredential.getClientCapabilities?.().catch(() => undefined);
  if (caps && caps['extension:prf'] === false) {
    return {
      ok: false,
      reason:
        'This browser cannot derive keys from passkeys. Use a current browser, a phone, or a security key.',
    };
  }
  return { ok: true };
}

function wrapError(err: unknown): never {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') {
    throw new PasskeyError('The passkey request was cancelled or timed out.', 'cancelled');
  }
  if (name === 'InvalidStateError') {
    throw new PasskeyError(
      'This authenticator already holds a passkey for this account.',
      'already-enrolled',
    );
  }
  if (err instanceof PasskeyError) throw err;
  throw new PasskeyError((err as Error)?.message || 'The passkey request failed.', 'unsupported');
}

function prfResult(cred: PublicKeyCredential): Uint8Array | undefined {
  const ext = cred.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer | ArrayBufferView } };
  };
  const first = ext.prf?.results?.first;
  return first ? asBytes(first) : undefined;
}

function descriptors(
  refs: readonly CredentialRef[] | undefined,
  hybrid: boolean,
): PublicKeyCredentialDescriptor[] {
  return (refs ?? []).map((c) => ({
    type: 'public-key' as const,
    id: toArrayBuffer(fromHex(c.id)),
    ...(hybrid
      ? { transports: ['hybrid', 'internal', 'usb', 'nfc', 'ble'] as AuthenticatorTransport[] }
      : c.transports
        ? { transports: [...c.transports] as AuthenticatorTransport[] }
        : {}),
  }));
}

export interface BrowserPasskeyAuthenticatorOptions {
  /** WebAuthn RP id. Defaults to `tenzro.com`; must match the node's configured RP id. */
  readonly rpId?: string;
  readonly rpName?: string;
  /** Defaults to `navigator.credentials`. */
  readonly credentials?: CredentialsContainer;
  readonly timeoutMs?: number;
}

/** `PasskeyAuthenticator` over `navigator.credentials`. */
export class BrowserPasskeyAuthenticator implements PasskeyAuthenticator {
  readonly rpId: string;
  readonly #rpName: string;
  readonly #timeout: number;
  readonly #credentials: CredentialsContainer | undefined;

  constructor(opts: BrowserPasskeyAuthenticatorOptions = {}) {
    this.rpId = opts.rpId ?? DEFAULT_RP_ID;
    this.#rpName = opts.rpName ?? DEFAULT_RP_NAME;
    this.#timeout = opts.timeoutMs ?? 120_000;
    this.#credentials = opts.credentials;
  }

  #container(): CredentialsContainer {
    const c =
      this.#credentials ??
      (globalThis as { navigator?: { credentials?: CredentialsContainer } }).navigator
        ?.credentials;
    if (!c) throw new PasskeyError('Passkeys are not available in this environment.', 'unsupported');
    return c;
  }

  async create(opts: CreatePasskeyOptions): Promise<CreatedPasskey> {
    let cred: PublicKeyCredential;
    try {
      cred = (await this.#container().create({
        publicKey: {
          rp: { id: this.rpId, name: this.#rpName },
          user: {
            id: toArrayBuffer(opts.userId),
            name: opts.userName,
            displayName: opts.userName,
          },
          challenge: toArrayBuffer(randomBytes(32)),
          pubKeyCredParams: [{ type: 'public-key', alg: COSE_ES256 }],
          authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'required',
            ...(opts.crossPlatform ? { authenticatorAttachment: 'cross-platform' as const } : {}),
          },
          excludeCredentials: descriptors(opts.exclude, false),
          attestation: 'none',
          timeout: this.#timeout,
          extensions: {
            prf: { eval: { first: toArrayBuffer(custodyPrfSalt()) } },
            credProps: true,
          } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential;
    } catch (err) {
      wrapError(err);
    }
    const res = cred.response as AuthenticatorAttestationResponse;
    if (res.getPublicKeyAlgorithm() !== COSE_ES256) {
      throw new PasskeyError('This authenticator did not create a P-256 passkey.', 'unsupported');
    }
    const spki = res.getPublicKey();
    if (!spki) throw new PasskeyError('The passkey has no readable public key.', 'unsupported');
    const tier = checkAuthenticatorFlags(asBytes(res.getAuthenticatorData()));
    const prf = prfResult(cred);
    return {
      credentialId: asBytes(cred.rawId),
      publicKey: normalizeP256PublicKey(asBytes(spki)),
      transports: res.getTransports?.() ?? [],
      tier,
      ...(prf ? { prf } : {}),
    };
  }

  async get(opts: GetPasskeyOptions): Promise<PasskeySignature> {
    let cred: PublicKeyCredential;
    try {
      cred = (await this.#container().get({
        publicKey: {
          rpId: this.rpId,
          challenge: toArrayBuffer(opts.challenge),
          userVerification: 'required',
          allowCredentials: descriptors(opts.allow, opts.hybrid ?? false),
          timeout: this.#timeout,
          extensions: {
            prf: { eval: { first: toArrayBuffer(custodyPrfSalt()) } },
          } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential;
    } catch (err) {
      wrapError(err);
    }
    const res = cred.response as AuthenticatorAssertionResponse;
    const authData = asBytes(res.authenticatorData);
    checkAuthenticatorFlags(authData);
    const userHandle = res.userHandle ? asBytes(res.userHandle) : undefined;
    const prf = prfResult(cred);
    return {
      credentialId: asBytes(cred.rawId),
      assertion: {
        authenticator_data: toNumberArray(authData),
        client_data_json: toNumberArray(asBytes(res.clientDataJSON)),
        signature: toNumberArray(asBytes(res.signature)),
        user_handle: userHandle ? toNumberArray(userHandle) : null,
      },
      ...(prf ? { prf } : {}),
      ...(userHandle ? { userHandle } : {}),
    };
  }
}

/** Hex id of a credential, without `0x`. */
export const credentialIdHex = (id: Uint8Array): string => toHex(id);
