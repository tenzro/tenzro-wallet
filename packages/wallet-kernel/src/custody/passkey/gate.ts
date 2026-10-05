/**
 * The custody gate, client side.
 *
 * Every custody change the node gates (enrolment, spending limits, session
 * keys, agents) is
 * authorised the same way:
 *
 *   1. the node issues a single-use challenge bound to the account, the
 *      operation and the operation's target (`tenzro_createCustodyChallenge`);
 *   2. the wallet recomputes the digest from the account, operation, target
 *      and the challenge's nonce, so it never signs a digest it was merely
 *      handed;
 *   3. an enrolled passkey signs `signingDigest(AccountOwner, digest)` as its
 *      WebAuthn challenge (user verification required);
 *   4. the assertion travels with the change as `authorization`.
 *
 * A session token never authorises a custody change; each one takes a fresh
 * passkey approval.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import type { KeystoreAnchor } from './keystore.ts';

import { concatBytes, equalBytes, fromHex, toHex, utf8 } from './bytes.ts';
import { SignatureContext, signingDigest, webauthnChallenge } from './composite.ts';
import type { JsonRpcTransport } from './rpc.ts';
import {
  type CredentialRef,
  type PasskeyAuthenticator,
  PasskeyError,
  type PasskeyHint,
  type PasskeySignature,
  type WebAuthnAssertionWire,
} from './webauthn.ts';

export type CustodyOperation =
  | 'enroll_passkey'
  | 'grant_session_key'
  | 'revoke_session_key'
  | 'set_spending_limit'
  | 'add_hardware_signer'
  | 'revoke_delegated_agent';

export interface CustodyChallenge {
  readonly challenge_id: string;
  /** The 32-byte custody digest, `0x`-prefixed hex. */
  readonly challenge_hex: string;
  /** base64url of `signingDigest(AccountOwner, digest)`. */
  readonly webauthn_challenge?: string;
  /** The 16-byte nonce the digest binds, `0x` hex. */
  readonly nonce_hex: string;
  /** The target the node bound, `0x` hex. */
  readonly target_hex: string;
  readonly account_address?: string;
  readonly operation?: string;
  readonly expires_in_secs: number;
}

/** Proof of control that accompanies a custody change. */
export interface CustodyAuthorization {
  readonly challenge_id: string;
  readonly credential_id_hex: string;
  readonly assertion: WebAuthnAssertionWire;
  /** For an account with no keystore on chain yet: its first passkey, which must derive it. */
  readonly anchor?: KeystoreAnchor;
}

const CUSTODY_DOMAIN = 'tenzro/custody-challenge/v1';

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

/**
 * The digest a passkey approves for one custody change:
 * `SHA-256(domain || len account || account || len op || op || len target || target || nonce)`.
 */
export function custodyChallengeDigest(
  account: Uint8Array,
  operation: string,
  target: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  const op = utf8(operation);
  return sha256(
    concatBytes(
      utf8(CUSTODY_DOMAIN),
      u32be(account.length),
      account,
      u32be(op.length),
      op,
      u32be(target.length),
      target,
      nonce,
    ),
  );
}

export async function requestCustodyChallenge(
  rpc: JsonRpcTransport,
  account: string,
  operation: CustodyOperation,
  target: Uint8Array,
): Promise<CustodyChallenge> {
  const challenge = await rpc.call<CustodyChallenge>('tenzro_createCustodyChallenge', {
    account_address: account,
    operation,
    ...(target.length > 0 ? { target_hex: toHex(target, true) } : {}),
  });
  const digest = fromHex(challenge.challenge_hex);
  if (digest.length !== 32) {
    throw new PasskeyError('The node issued a malformed custody challenge.', 'invalid');
  }
  const nonce = fromHex(challenge.nonce_hex ?? '');
  if (
    nonce.length !== 16 ||
    !equalBytes(fromHex(challenge.target_hex ?? ''), target) ||
    !equalBytes(custodyChallengeDigest(fromHex(account), operation, target, nonce), digest)
  ) {
    throw new PasskeyError(
      'The node issued a custody challenge for a different change than the one requested.',
      'invalid',
    );
  }
  if (
    challenge.webauthn_challenge !== undefined &&
    challenge.webauthn_challenge !== webauthnChallenge(SignatureContext.AccountOwner, digest)
  ) {
    throw new PasskeyError('The node issued a malformed custody challenge.', 'invalid');
  }
  return challenge;
}

export interface AuthorizeOptions {
  /** Offer every transport so a passkey on another device can approve (QR). */
  readonly hybrid?: boolean;
  /** Which authenticator the browser should offer first. */
  readonly hints?: readonly PasskeyHint[];
}

/** Approves a node-issued custody challenge with a passkey. */
export async function authorizeChallenge(
  authenticator: PasskeyAuthenticator,
  challenge: CustodyChallenge,
  allow: readonly CredentialRef[],
  opts: AuthorizeOptions = {},
): Promise<{ authorization: CustodyAuthorization; signer: PasskeySignature }> {
  const signer = await authenticator.get({
    challenge: signingDigest(SignatureContext.AccountOwner, fromHex(challenge.challenge_hex)),
    allow,
    ...(opts.hybrid ? { hybrid: true } : {}),
    ...(opts.hints ? { hints: opts.hints } : {}),
  });
  return {
    signer,
    authorization: {
      challenge_id: challenge.challenge_id,
      credential_id_hex: toHex(signer.credentialId, true),
      assertion: signer.assertion,
    },
  };
}
