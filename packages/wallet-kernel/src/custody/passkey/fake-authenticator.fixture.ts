/**
 * In-memory WebAuthn authenticator for unit tests. Produces real P-256
 * assertions (DER, over `authenticatorData || SHA-256(clientDataJSON)`) and a
 * deterministic PRF output per credential, so the custody flows run end to
 * end without a browser. Test-only; excluded from the package build.
 */

import { p256 } from '@noble/curves/nist.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { concatBytes, fromHex, toHex, toNumberArray, utf8 } from './bytes.ts';
import { custodyPrfSalt } from './derive.ts';
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
  readonly prfSecret: Uint8Array;
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
  returnPrfOnCreate = true;
  tier: PasskeyTier = 'device-bound';
  #counter = 0;

  constructor(rpId = 'tenzro.com') {
    this.rpId = rpId;
  }

  async create(opts: CreatePasskeyOptions): Promise<CreatedPasskey> {
    this.#counter += 1;
    const seed = sha256(utf8(`fake-credential-${this.#counter}`));
    const secretKey = p256.utils.randomSecretKey(concatBytes(seed, sha256(seed)).slice(0, 48));
    const cred: FakeCredential = {
      id: seed.slice(0, 16),
      secretKey,
      publicKey: p256.getPublicKey(secretKey, false).slice(1),
      userId: opts.userId,
      prfSecret: sha256(concatBytes(seed, utf8('prf'))),
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
      ...(this.returnPrfOnCreate ? { prf: this.#prf(cred) } : {}),
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
      prf: this.#prf(cred),
      userHandle: cred.userId,
    };
  }

  credential(idHex: string): FakeCredential | undefined {
    return this.credentials.find((c) => toHex(c.id) === idHex.replace(/^0x/, ''));
  }

  #prf(cred: FakeCredential): Uint8Array {
    return hmac(sha256, cred.prfSecret, custodyPrfSalt());
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
    return this.calls.filter((c) => c.method === method).map((c) => c.params as Record<string, unknown>);
  }
}

export const challengeDigest = (n: number): string => toHex(sha256(utf8(`challenge-${n}`)), true);

export { fromHex };
