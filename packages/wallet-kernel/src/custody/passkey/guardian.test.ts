import { describe, expect, it } from 'vitest';

import { concatBytes, toHex, utf8 } from './bytes.ts';
import { SignatureContext, signingDigest } from './composite.ts';
import {
  type GuardianCard,
  type QuorumMember,
  cardQuorumMember,
  checkGuardianQuorum,
  decodeGuardianCard,
  encodeGuardianCard,
  guardianRole,
  guardianTarget,
  recoveryApprovalChallenge,
  recoveryOpHash,
  registrationProvenance,
} from './guardian.ts';

const rpIdHash = new Uint8Array(32).fill(0xee);

function regData(flags: number, aaguid: Uint8Array, credentialId: Uint8Array): Uint8Array {
  return concatBytes(
    rpIdHash,
    new Uint8Array([0x45 | flags, 0, 0, 0, 0]),
    aaguid,
    new Uint8Array([0, credentialId.length]),
    credentialId,
  );
}

const aaguidA = new Uint8Array(16).fill(0xa1);

function card(over: Partial<GuardianCard> = {}, flags = 0x18): GuardianCard {
  return {
    format: 'tenzro-guardian',
    version: 2,
    label: 'Backup key',
    role: 'recovery_key',
    p256: toHex(new Uint8Array(64).fill(1), true),
    credentialId: '0x0405',
    registrationAuthenticatorData: toHex(regData(flags, aaguidA, new Uint8Array([4, 5])), true),
    ...over,
  };
}

describe('recoveryOpHash', () => {
  it('matches the network derivation', () => {
    const h = recoveryOpHash({
      account: `0x${'11'.repeat(20)}`,
      newPasskeyPublicKey: concatBytes(new Uint8Array(32).fill(2), new Uint8Array(32).fill(3)),
      newCredentialId: new Uint8Array([4, 5]),
      recoveryId: 'rec-1',
      expiresAtMs: 1_700_000_000_000,
    });
    // Reference: python hashlib over the same preimage.
    expect(toHex(h)).toBe('7136490488210343c2c3a15e2e3d995c39ba80ec155740323426cd73d750a377');
  });

  it('is approved under the recovery-approval context', () => {
    const op = new Uint8Array(32).fill(9);
    expect(recoveryApprovalChallenge(op)).toEqual(signingDigest(SignatureContext.RecoveryApproval, op));
  });
});

describe('guardian cards', () => {
  it('round-trip and refuse anything else', () => {
    const c = card();
    expect(decodeGuardianCard(encodeGuardianCard(c))).toEqual(c);
    expect(() => decodeGuardianCard('not a card')).toThrow();
    expect(() => decodeGuardianCard(encodeGuardianCard(card({ p256: '0x01' })))).toThrow();
    expect(() =>
      decodeGuardianCard(encodeGuardianCard(card({ registrationAuthenticatorData: '0x00' }))),
    ).toThrow();
  });

  it('read provider and backup flags from the registration', () => {
    const p = registrationProvenance(regData(0x18, aaguidA, new Uint8Array([1])));
    expect(p).toEqual({ aaguid: aaguidA, backupEligible: true, backupState: true });
    expect(registrationProvenance(regData(0, aaguidA, new Uint8Array([1]))).backupEligible).toBe(false);
  });

  it('name key, no pq key, provider, flags, role and label in the target', () => {
    const t = guardianTarget(card());
    expect(toHex(t)).toBe(
      toHex(
        concatBytes(
          new Uint8Array(64).fill(1),
          new Uint8Array(32),
          aaguidA,
          new Uint8Array([0b11, 0x01]),
          utf8('Backup key'),
        ),
      ),
    );
    expect(toHex(guardianTarget(card({ role: 'device' })))).not.toBe(toHex(t));
    expect(toHex(guardianTarget(card({ label: 'Phone' })))).not.toBe(toHex(t));
  });

  it('maps sources to node roles', () => {
    expect(guardianRole('security_key')).toBe('recovery_key');
    expect(guardianRole('own_passkey')).toBe('device');
    expect(guardianRole('trusted_person')).toBe('device');
  });
});

describe('quorum preview', () => {
  const synced = (id: string, aaguid = 'a1'.repeat(16)): QuorumMember => ({ id, backupEligible: true, aaguid });
  const bound = (id: string): QuorumMember => ({ id, backupEligible: false });

  it('counts synced passkeys of one provider once', () => {
    const r = checkGuardianQuorum([synced('01'), synced('02'), synced('03')], 2);
    expect(r.ok).toBe(false);
    expect(r.roots).toBe(1);
  });

  it('counts each device-bound passkey on its own', () => {
    expect(checkGuardianQuorum([bound('01'), bound('02')], 2)).toEqual({ ok: true, roots: 2, reason: null });
  });

  it('groups synced passkeys that report no provider', () => {
    expect(checkGuardianQuorum([synced('01', ''), synced('02', '00'.repeat(16))], 2).roots).toBe(1);
  });

  it('accepts distinct providers up to the root count', () => {
    const members = [synced('01'), synced('02', 'b2'.repeat(16)), bound('03')];
    expect(checkGuardianQuorum(members, 3).ok).toBe(true);
    expect(checkGuardianQuorum(members, 4).ok).toBe(false);
    expect(checkGuardianQuorum(members, 0).ok).toBe(false);
  });

  it('flags a threshold of one', () => {
    const r = checkGuardianQuorum([bound('01')], 1);
    expect(r.ok).toBe(true);
    expect(r.reason).not.toBeNull();
  });

  it('reads a card as a member', () => {
    expect(cardQuorumMember(card())).toEqual({ id: '01'.repeat(64), backupEligible: true, aaguid: 'a1'.repeat(16) });
  });
});
