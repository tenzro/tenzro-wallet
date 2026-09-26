/**
 * `SigningDriver` for passkey accounts.
 *
 * The preimage is the 32-byte UserOperation hash. Each contributing passkey
 * signs it as its WebAuthn challenge, the ML-DSA-65 key derived from that
 * passkey's PRF output signs the same hash, and the driver returns the
 * encoded bundle the account's WebAuthn validator verifies.
 */

import type { SigningDriver, SigningRequest, SigningResult } from '../../types/signing-driver.ts';
import { toHex } from './bytes.ts';
import { signWithPrf } from './gate.ts';
import { type HybridSignatureEntry, encodeHybridSignatureBundle } from './userop.ts';
import { type CredentialRef, type PasskeyAuthenticator, PasskeyError } from './webauthn.ts';

export interface PasskeySigningDriverOptions {
  readonly authenticator: PasskeyAuthenticator;
  /** Passkeys allowed to sign. Defaults to the credential ids on the account's surface key. */
  readonly credentials?: () => readonly CredentialRef[];
  /** 2 when the account's second-factor policy is `two_credentials`. */
  readonly requiredSignatures?: 1 | 2;
  /** Let a passkey on another device approve over hybrid (QR). */
  readonly hybrid?: boolean;
}

export function passkeySigningDriver(opts: PasskeySigningDriverOptions): SigningDriver {
  return {
    id: 'passkey',
    async sign(req: SigningRequest): Promise<SigningResult> {
      if (req.scheme !== 'webauthn-p256+ml-dsa-65') {
        throw new PasskeyError(`the passkey driver cannot sign ${req.scheme}`, 'invalid');
      }
      if (req.preimage.length !== 32) {
        throw new PasskeyError('the passkey driver signs 32-byte operation hashes only', 'invalid');
      }
      const allow =
        opts.credentials?.() ??
        (req.surfaceKey.surface === 'tenzro-native'
          ? req.surfaceKey.credentialIds.map((id) => ({ id }))
          : []);
      const required = opts.requiredSignatures ?? 1;
      const used = new Set<string>();
      const entries: HybridSignatureEntry[] = [];
      for (let i = 0; i < required; i++) {
        const remaining = allow.filter((c) => !used.has(c.id.replace(/^0x/, '').toLowerCase()));
        const signed = await opts.authenticator.get({
          challenge: req.preimage,
          allow: remaining,
          ...(opts.hybrid ? { hybrid: true } : {}),
        });
        const id = toHex(signed.credentialId);
        if (used.has(id)) {
          throw new PasskeyError(
            'Approve with a different passkey for the second signature.',
            'invalid',
          );
        }
        used.add(id);
        entries.push({
          authenticatorData: new Uint8Array(signed.assertion.authenticator_data),
          clientDataJson: new Uint8Array(signed.assertion.client_data_json),
          signature: new Uint8Array(signed.assertion.signature),
          ...(signed.assertion.user_handle
            ? { userHandle: new Uint8Array(signed.assertion.user_handle) }
            : {}),
          mlDsaSignature: signWithPrf(signed, req.preimage),
          credentialId: signed.credentialId,
        });
      }
      return { signatures: [encodeHybridSignatureBundle(entries)] };
    },
  };
}
