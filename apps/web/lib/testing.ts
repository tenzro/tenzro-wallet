/**
 * Test doubles: a software WebAuthn authenticator that signs exactly as a
 * passkey does, and an RPC transport answering from a script. Used by the
 * unit tests only.
 */

import { RpcClient, type RpcTransport } from 'tenzro-sdk';

import { fromBase64Url, toBase64Url, toHex } from './bytes';
import type { CredentialsApi } from './passkey';

const subtle = globalThis.crypto.subtle;

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', b as BufferSource));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

interface Key {
  readonly id: Uint8Array;
  readonly rpId: string;
  readonly pair: CryptoKeyPair;
  readonly raw: Uint8Array;
}

export interface SignedAssertion {
  readonly credentialId: string;
  readonly rpId: string;
  readonly challenge: string;
  readonly authenticatorData: Uint8Array;
  readonly clientDataJson: Uint8Array;
  readonly signature: Uint8Array;
}

/** A software authenticator; `synced` sets the backup flags of the keys it makes. */
export class SoftAuthenticator implements CredentialsApi {
  readonly keys: Key[] = [];
  readonly assertions: SignedAssertion[] = [];

  constructor(private readonly synced = false) {}

  async create(options: CredentialCreationOptions): Promise<Credential | null> {
    const o = options.publicKey as PublicKeyCredentialCreationOptions;
    const rpId = o.rp.id as string;
    const pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
    const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
    const id = globalThis.crypto.getRandomValues(new Uint8Array(16));
    this.keys.push({ id, rpId, pair, raw });
    const flags = 0x45 | (this.synced ? 0x18 : 0);
    const aaguid = new Uint8Array(16).fill(0xaa);
    const authData = concat(
      await sha256(new TextEncoder().encode(rpId)),
      Uint8Array.of(flags, 0, 0, 0, 0),
      aaguid,
      Uint8Array.of(0, id.length),
      id,
    );
    return {
      id: toBase64Url(id),
      type: 'public-key',
      rawId: id.buffer,
      response: {
        getPublicKey: () => spki.buffer,
        getAuthenticatorData: () => authData.buffer,
      },
    } as unknown as Credential;
  }

  async get(options: CredentialRequestOptions): Promise<Credential | null> {
    const o = options.publicKey as PublicKeyCredentialRequestOptions;
    const allow = o.allowCredentials?.[0]?.id;
    const key = allow
      ? this.keys.find((k) => toHex(k.id) === toHex(new Uint8Array(allow as ArrayBuffer)))
      : this.keys[this.keys.length - 1];
    if (!key) throw new DOMException('no such credential', 'NotAllowedError');
    const challenge = toBase64Url(new Uint8Array(o.challenge as ArrayBuffer));
    const clientDataJson = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: `https://${key.rpId}` }),
    );
    const flags = 0x05 | (this.synced ? 0x18 : 0);
    const authData = concat(
      await sha256(new TextEncoder().encode(key.rpId)),
      Uint8Array.of(flags, 0, 0, 0, 1),
    );
    const signature = new Uint8Array(
      await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key.pair.privateKey,
        concat(authData, await sha256(clientDataJson)) as BufferSource,
      ),
    );
    this.assertions.push({
      credentialId: toHex(key.id),
      rpId: key.rpId,
      challenge,
      authenticatorData: authData,
      clientDataJson,
      signature,
    });
    return {
      rawId: key.id.buffer,
      response: {
        authenticatorData: authData.buffer,
        clientDataJSON: clientDataJson.buffer,
        signature: signature.buffer,
        userHandle: null,
      },
    } as unknown as Credential;
  }
}

/** Whether an assertion's signature verifies under the P-256 key `publicKeyXy` (hex). */
export async function verifies(publicKeyXy: string, a: SignedAssertion): Promise<boolean> {
  const raw = concat(
    Uint8Array.of(4),
    Uint8Array.from(publicKeyXy.match(/../g) ?? [], (h) => Number.parseInt(h, 16)),
  );
  const key = await subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    a.signature as BufferSource,
    concat(a.authenticatorData, await sha256(a.clientDataJson)) as BufferSource,
  );
}

export function challengeBytes(a: SignedAssertion): Uint8Array {
  return fromBase64Url(a.challenge);
}

export type Handler = (params: unknown) => unknown;

/** An RPC client answering from `handlers`, recording every call. */
export function scriptedRpc(handlers: Record<string, Handler>) {
  const calls: { method: string; params: unknown }[] = [];
  const transport: RpcTransport = {
    async call<T>(method: string, params: unknown[] | Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      const h = handlers[method];
      if (!h) throw new Error(`unexpected RPC ${method}`);
      return (await h(params)) as T;
    },
  };
  return { rpc: new RpcClient('http://test.invalid', undefined, 1000, transport), calls };
}
