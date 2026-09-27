/**
 * The custody gate, client side.
 *
 * Every custody change (enrolment, adding or removing a device, the
 * second-factor policy, spending limits, session keys, guardians) is
 * authorised the same way:
 *
 *   1. the node issues a single-use challenge bound to the account, the
 *      operation and the operation's target (`tenzro_createCustodyChallenge`);
 *   2. an enrolled passkey signs the raw 32-byte digest as its WebAuthn
 *      challenge (user verification required);
 *   3. the ML-DSA-65 key derived from that passkey's PRF output signs the same
 *      digest;
 *   4. both legs travel with the change as `authorization`.
 *
 * A session token never authorises a custody change; each one takes a fresh
 * passkey approval.
 */

import { fromHex, toHex } from './bytes.ts';
import { deriveCustodyKey, signCustodyDigest } from './derive.ts';
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
  | 'add_passkey'
  | 'remove_passkey'
  | 'set_passkey_policy'
  | 'grant_session_key'
  | 'revoke_session_key'
  | 'set_spending_limit'
  | 'add_hardware_signer'
  | 'add_guardian'
  | 'cancel_recovery';

export interface CustodyChallenge {
  readonly challenge_id: string;
  /** The 32-byte digest to sign, `0x`-prefixed hex. */
  readonly challenge_hex: string;
  readonly account_address?: string;
  readonly operation?: string;
  readonly expires_in_secs: number;
}

/** Proof of control that accompanies a custody change. */
export interface CustodyAuthorization {
  readonly challenge_id: string;
  readonly credential_id_hex: string;
  readonly assertion: WebAuthnAssertionWire;
  readonly ml_dsa_signature_hex: string;
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
  if (fromHex(challenge.challenge_hex).length !== 32) {
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

/**
 * Signs a node-issued digest with a passkey and the ML-DSA-65 key derived
 * from it. The secret key lives only for the length of this call.
 */
export async function authorizeChallenge(
  authenticator: PasskeyAuthenticator,
  challenge: CustodyChallenge,
  allow: readonly CredentialRef[],
  opts: AuthorizeOptions = {},
): Promise<{ authorization: CustodyAuthorization; signer: PasskeySignature }> {
  const digest = fromHex(challenge.challenge_hex);
  const signer = await authenticator.get({
    challenge: digest,
    allow,
    ...(opts.hybrid ? { hybrid: true } : {}),
    ...(opts.hints ? { hints: opts.hints } : {}),
  });
  const mlDsaSignature = signWithPrf(signer, digest);
  return {
    signer,
    authorization: {
      challenge_id: challenge.challenge_id,
      credential_id_hex: toHex(signer.credentialId, true),
      assertion: signer.assertion,
      ml_dsa_signature_hex: toHex(mlDsaSignature, true),
    },
  };
}

/** ML-DSA-65 signature over `digest` with the key derived from the assertion's PRF output. */
export function signWithPrf(signer: PasskeySignature, digest: Uint8Array): Uint8Array {
  if (!signer.prf) {
    throw new PasskeyError(
      'This passkey did not return a key-derivation value (PRF). Use a phone or a security key that supports it.',
      'no-prf',
    );
  }
  const { secretKey } = deriveCustodyKey(signer.prf);
  try {
    return signCustodyDigest(digest, secretKey);
  } finally {
    secretKey.fill(0);
  }
}
