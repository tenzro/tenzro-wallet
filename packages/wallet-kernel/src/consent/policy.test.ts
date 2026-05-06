import { describe, expect, it } from 'vitest';
import { provisionIdentity } from '../identity/provision.ts';
import type { AssetId } from '../types/asset.ts';
import type { Consent } from '../types/consent.ts';
import type { Intent } from '../types/intent.ts';
import { PolicyViolationError, enforcePolicy } from './policy.ts';

const TNZO: AssetId = { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 };
const USDC: AssetId = { scope: 'tenzro-asset', symbol: 'USDC', decimals: 6 };

const id = await provisionIdentity({ uuid: 'test-1' });
const consent: Consent = { approvedAt: Date.now() };
const intent = (amount: bigint, asset = TNZO): Intent => ({
  kind: 'send',
  from: id.did,
  to: { kind: 'tdip', did: id.did },
  asset,
  amount,
});

describe('policy enforcement', () => {
  it('allows transfers under all caps', () => {
    expect(() =>
      enforcePolicy(intent(10n), consent, {
        sessionPolicy: { maxPerTx: 100n, maxPerDay: 1000n },
      }),
    ).not.toThrow();
  });

  it('blocks transfers over per-tx cap', () => {
    expect(() =>
      enforcePolicy(intent(101n), consent, {
        sessionPolicy: { maxPerTx: 100n },
      }),
    ).toThrow(PolicyViolationError);
  });

  it('blocks transfers that would exceed daily cap', () => {
    expect(() =>
      enforcePolicy(intent(50n), consent, {
        sessionPolicy: { maxPerDay: 100n },
        spentSoFarToday: 60n,
      }),
    ).toThrow(/daily cap/);
  });

  it('takes the more-restrictive of session ∩ delegation', () => {
    // delegation says 1000, session says 50 → 50 wins.
    expect(() =>
      enforcePolicy(intent(100n), consent, {
        delegationScope: { maxPerTx: 1000n },
        sessionPolicy: { maxPerTx: 50n },
      }),
    ).toThrow();
  });

  it('blocks assets not in whitelist', () => {
    expect(() =>
      enforcePolicy(intent(1n, USDC), consent, {
        sessionPolicy: { assetWhitelist: [TNZO] },
      }),
    ).toThrow(/whitelist/);
  });

  it('blocks expired sessions', () => {
    // approvedAt must be strictly greater than expiresAt to count as expired;
    // use a wide gap so the test is not sensitive to clock granularity between
    // the two `Date.now()` calls.
    const now = Date.now();
    const approved: Consent = { approvedAt: now };
    expect(() =>
      enforcePolicy(intent(1n), approved, {
        sessionPolicy: { expiresAt: now - 1000 },
      }),
    ).toThrow(/expired/);
  });

  it('is a no-op when no policy is set', () => {
    expect(() => enforcePolicy(intent(10n ** 24n), consent, {})).not.toThrow();
  });

  describe('KYC tier', () => {
    it('passes when signer tier meets requirement', () => {
      expect(() =>
        enforcePolicy(intent(10n), consent, {
          sessionPolicy: { minKycTier: 'Basic' },
          signerKycTier: 'Basic',
        }),
      ).not.toThrow();
    });

    it('passes when signer tier exceeds requirement', () => {
      expect(() =>
        enforcePolicy(intent(10n), consent, {
          sessionPolicy: { minKycTier: 'Basic' },
          signerKycTier: 'Full',
        }),
      ).not.toThrow();
    });

    it('blocks when signer tier is below requirement', () => {
      expect(() =>
        enforcePolicy(intent(10n), consent, {
          sessionPolicy: { minKycTier: 'Enhanced' },
          signerKycTier: 'Basic',
        }),
      ).toThrow(/KYC tier/);
    });

    it('treats omitted signerKycTier as Unverified', () => {
      expect(() =>
        enforcePolicy(intent(10n), consent, {
          sessionPolicy: { minKycTier: 'Basic' },
        }),
      ).toThrow(/Unverified/);
    });

    it('intersects to the higher (more restrictive) tier', () => {
      // session says Basic, delegation says Full → Full wins.
      expect(() =>
        enforcePolicy(intent(10n), consent, {
          sessionPolicy: { minKycTier: 'Basic' },
          delegationScope: { minKycTier: 'Full' },
          signerKycTier: 'Enhanced',
        }),
      ).toThrow(/Full/);
    });
  });
});
