import { describe, expect, it } from 'vitest';

import { toHex, utf8 } from './bytes.ts';
import {
  SignatureContext,
  compositeSignatureJson,
  signingDigest,
  webauthnChallenge,
} from './composite.ts';
import { custodyChallengeDigest } from './gate.ts';

const msg = Uint8Array.from({ length: 32 }, (_, i) => i);

describe('signingDigest', () => {
  // Reference: python hashlib over prefix || label || len(ctx) || ctx || SHA-512(msg).
  it("is SHA-256(M') for the context", () => {
    expect(toHex(signingDigest(SignatureContext.Transaction, msg))).toBe(
      'fc165d6a0898b279d172d70288655f55566f00be87526fdc4785dbbc3fcb5356',
    );
    expect(webauthnChallenge(SignatureContext.Transaction, msg)).toBe(
      '_BZdagiYsnnRctcCiGVfVVZvAL6HUm_cR4XbvD_LU1Y',
    );
  });

  it('separates contexts', () => {
    expect(toHex(signingDigest(SignatureContext.AccountOwner, msg))).not.toBe(
      toHex(signingDigest(SignatureContext.RecoveryApproval, msg)),
    );
  });
});

describe('custodyChallengeDigest', () => {
  it('binds account, operation, target and nonce', () => {
    const nonce = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(
      toHex(
        custodyChallengeDigest(
          new Uint8Array(20).fill(7),
          'add_guardian',
          utf8('guardian-target'),
          nonce,
        ),
      ),
    ).toBe('ec7ea9196c21ab3eb2a0dcdc6b96e59a069b4a7b14a6f8576474d05ffe649b37');
  });
});

const signed = {
  credentialId: new Uint8Array([0xaa, 0xbb]),
  assertion: {
    authenticator_data: [1, 2, 3],
    client_data_json: Array.from(utf8('{}')),
    signature: [9, 9, 9, 9],
    user_handle: null,
  },
};

describe('compositeSignatureJson', () => {
  it('carries the assertion as the classical leg and omits pq', () => {
    expect(compositeSignatureJson(signed)).toEqual({
      classical: {
        form: 'web_authn',
        authenticator_data: '010203',
        client_data_json: '7b7d',
        signature: '09090909',
      },
    });
  });
});
