/**
 * What a passkey signs, and how its signature travels.
 *
 * Every signature the network checks is over a message representative
 * `M' = prefix || label || len(ctx) || ctx || SHA-512(message)`, bound to the
 * context the message is used in. A passkey's WebAuthn challenge is
 * `SHA-256(M')`; the browser carries it base64url-encoded in clientDataJSON.
 *
 * The passkey is the only key. Its assertion is the whole signature: a
 * `CompositeSignature` whose classical leg is the WebAuthn proof and whose
 * post-quantum leg is absent.
 */

import { sha256, sha512 } from '@noble/hashes/sha2.js';

import { concatBytes, toHex, utf8 } from './bytes.ts';
import type { PasskeySignature } from './webauthn.ts';

const COMPOSITE_PREFIX = 'CompositeAlgorithmSignatures2025';
const COMPOSITE_LABEL = 'COMPSIG-MLDSA65-ECDSA-P256-SHA512';

/** The contexts a wallet passkey signs under. */
export const SignatureContext = {
  /** A custody approval: proof the caller controls the account. */
  AccountOwner: 'tenzro/rpc/account-owner',
  /** A native transaction's digest. */
  Transaction: 'tenzro/tx',
  /** A guardian's approval of one recovery. */
  RecoveryApproval: 'tenzro/identity/recovery-approval',
} as const;

export type SignatureContext = (typeof SignatureContext)[keyof typeof SignatureContext];

/** `M'` for `message` under `context`. */
export function messageRepresentative(context: SignatureContext, message: Uint8Array): Uint8Array {
  const ctx = utf8(context);
  return concatBytes(
    utf8(COMPOSITE_PREFIX),
    utf8(COMPOSITE_LABEL),
    new Uint8Array([ctx.length]),
    ctx,
    sha512(message),
  );
}

/** `SHA-256(M')`: the bytes a passkey receives as its WebAuthn challenge. */
export function signingDigest(context: SignatureContext, message: Uint8Array): Uint8Array {
  return sha256(messageRepresentative(context, message));
}

/** Unpadded base64url. */
export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The challenge string the node expects in clientDataJSON for `message` under `context`. */
export function webauthnChallenge(context: SignatureContext, message: Uint8Array): string {
  return base64Url(signingDigest(context, message));
}

/** JSON form of a `CompositeSignature` carrying one passkey assertion. */
export interface CompositeSignatureJson {
  readonly classical: {
    readonly form: 'web_authn';
    readonly authenticator_data: string;
    readonly client_data_json: string;
    readonly signature: string;
  };
}

export function compositeSignatureJson(signed: PasskeySignature): CompositeSignatureJson {
  const a = signed.assertion;
  return {
    classical: {
      form: 'web_authn',
      authenticator_data: toHex(new Uint8Array(a.authenticator_data)),
      client_data_json: toHex(new Uint8Array(a.client_data_json)),
      signature: toHex(new Uint8Array(a.signature)),
    },
  };
}
