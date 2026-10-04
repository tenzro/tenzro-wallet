/**
 * In-memory WebAuthn authenticator for unit tests. Produces real P-256
 * assertions (DER, over `authenticatorData || SHA-256(clientDataJSON)`) and
 * registration authenticatorData, so the custody flows run end to end without
 * a browser. Test-only; excluded from the package build.
 */

import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, fromHex, toHex, toNumberArray, utf8 } from './bytes.ts';
import { custodyChallengeDigest } from './gate.ts';
import { PasskeyError } from './webauthn.ts';
import type {
  CreatePasskeyOptions,
  CreatedPasskey,
  GetPasskeyOptions,
  PasskeyAuthenticator,
  PasskeySignature,
  PasskeyTier,
} from './webauthn.ts';

interface FakeCredential {
  readonly id: Uint8Array;
  readonly secretKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly userId: Uint8Array;
  readonly aaguid: Uint8Array;
  readonly tier: PasskeyTier;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class FakeAuthenticator implements PasskeyAuthenticator {
  readonly rpId: string;
  readonly credentials: FakeCredential[] = [];
  /** Which credential answers the next `get()` when several are allowed. */
  preferred: string | undefined;
  /** AAGUID of the provider, 16 bytes; zero reports none. */
  aaguid: Uint8Array = new Uint8Array(16);
  tier: PasskeyTier = 'device-bound';
  /**
   * Behave as a device that already holds the account's passkeys (synced
   * through its credential manager): create() refuses when one of them is
   * excluded, as a browser does with InvalidStateError.
   */
  syncsExisting = false;
  /** Report `immediateGet` support, as a browser that can ask silently does. */
  immediateGet = false;

  async supportsImmediateGet(): Promise<boolean> {
    return this.immediateGet;
  }
  #counter = 0;

  constructor(rpId = 'tenzro.com') {
    this.rpId = rpId;
  }

  async create(opts: CreatePasskeyOptions): Promise<CreatedPasskey> {
    if (this.syncsExisting && (opts.exclude ?? []).some((c) => this.credentials.some((h) => toHex(h.id) === c.id))) {
      throw new PasskeyError('This authenticator already holds a passkey for this account.', 'already-enrolled');
    }
    this.#counter += 1;
    const seed = sha256(utf8(`fake-credential-${this.#counter}`));
    const secretKey = p256.utils.randomSecretKey(concatBytes(seed, sha256(seed)).slice(0, 48));
    const cred: FakeCredential = {
      id: seed.slice(0, 16),
      secretKey,
      publicKey: p256.getPublicKey(secretKey, false).slice(1),
      userId: opts.userId,
      aaguid: this.aaguid,
      tier: this.tier,
    };
    const excluded = (opts.exclude ?? []).some((c) => c.id === toHex(cred.id));
    if (excluded) throw new Error('excluded');
    this.credentials.push(cred);
    return {
      credentialId: cred.id,
      publicKey: cred.publicKey,
      transports: ['internal'],
      tier: cred.tier,
      registrationAuthenticatorData: concatBytes(
        sha256(utf8(this.rpId)),
        new Uint8Array([0x01 | 0x04 | 0x40 | (cred.tier === 'synced' ? 0x08 | 0x10 : 0), 0, 0, 0, 0]),
        cred.aaguid,
        new Uint8Array([0, cred.id.length]),
        cred.id,
        // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
        new Uint8Array([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
        cred.publicKey.slice(0, 32),
        new Uint8Array([0x22, 0x58, 0x20]),
        cred.publicKey.slice(32),
      ),
      ...(/^0*$/.test(toHex(cred.aaguid)) ? {} : { aaguid: toHex(cred.aaguid) }),
    };
  }

  async get(opts: GetPasskeyOptions): Promise<PasskeySignature> {
    const allowed = (opts.allow ?? []).map((c) => c.id.replace(/^0x/, '').toLowerCase());
    const pool =
      allowed.length === 0
        ? this.credentials
        : this.credentials.filter((c) => allowed.includes(toHex(c.id)));
    const cred =
      pool.find((c) => this.preferred !== undefined && toHex(c.id) === this.preferred) ?? pool[0];
    if (!cred) throw new Error('no matching credential');
    const flags = 0x01 | 0x04 | (cred.tier === 'synced' ? 0x08 | 0x10 : 0);
    const authData = concatBytes(sha256(utf8(this.rpId)), new Uint8Array([flags, 0, 0, 0, 1]));
    const clientData = utf8(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: b64url(opts.challenge),
        origin: `https://${this.rpId}`,
      }),
    );
    const signature = p256.sign(concatBytes(authData, sha256(clientData)), cred.secretKey, {
      format: 'der',
    });
    return {
      credentialId: cred.id,
      assertion: {
        authenticator_data: toNumberArray(authData),
        client_data_json: toNumberArray(clientData),
        signature: toNumberArray(signature),
        user_handle: toNumberArray(cred.userId),
      },
      userHandle: cred.userId,
    };
  }

  credential(idHex: string): FakeCredential | undefined {
    return this.credentials.find((c) => toHex(c.id) === idHex.replace(/^0x/, ''));
  }
}

/** Records every JSON-RPC call and answers from a handler map. */
export class MockRpc {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly handlers: Record<string, (params: never) => unknown>;

  constructor(handlers: Record<string, (params: never) => unknown>) {
    this.handlers = handlers;
  }

  async call<T>(method: string, params: unknown = []): Promise<T> {
    this.calls.push({ method, params });
    const h = this.handlers[method];
    if (!h) throw new Error(`unexpected RPC ${method}`);
    return (await h(params as never)) as T;
  }

  paramsOf(method: string): Array<Record<string, unknown>> {
    return this.calls
      .filter((c) => c.method === method)
      .map((c) => c.params as Record<string, unknown>);
  }
}

export const challengeDigest = (n: number): string => toHex(sha256(utf8(`challenge-${n}`)), true);

export { fromHex };

/** A custody challenge as the node issues it: the digest over the requested change and a nonce. */
export function issuedChallenge(
  n: number,
  p: { account_address: string; operation: string; target_hex?: string },
): Record<string, unknown> {
  const nonce = new Uint8Array(16).fill(n);
  const target = fromHex(p.target_hex ?? '');
  const digest = custodyChallengeDigest(fromHex(p.account_address), p.operation, target, nonce);
  return {
    challenge_id: `c${n}`,
    challenge_hex: toHex(digest, true),
    nonce_hex: toHex(nonce, true),
    target_hex: toHex(target, true),
    expires_in_secs: 300,
  };
}
