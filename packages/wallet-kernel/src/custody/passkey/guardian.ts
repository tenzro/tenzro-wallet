/**
 * Recovery guardians are passkeys.
 *
 * A guardian's recovery key (Ed25519 + ML-DSA-65) is derived from its
 * passkey's PRF output at the moment it signs and wiped right after; nothing is
 * stored. The guardian hands the account holder a card with the public halves
 * and the passkey's provider, and the holder adds it with a passkey approval.
 *
 * Independence: a provider (one iCloud Keychain, one password manager) counts
 * once however many guardians sync through it, and a device-bound security key
 * counts on its own. A quorum is accepted only when no single provider holds
 * enough guardians to reach the threshold alone.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

import { concatBytes, fromHex, utf8 } from './bytes.ts';
import type { PasskeyTier } from './webauthn.ts';

const ED25519_INFO = 'tenzro/guardian/ed25519/v1';
const ML_DSA_INFO = 'tenzro/guardian/ml-dsa-65/v1';
const COMPOSITE_PREFIX = 'CompositeAlgorithmSignatures2025';
const LABEL_MLDSA65_ED25519 = 'COMPSIG-MLDSA65-Ed25519-SHA512';
const RECOVERY_APPROVAL_CONTEXT = 'tenzro/identity/recovery-approval';
const RECOVERY_DOMAIN = 'tenzro/recovery/v1\0';
const CARD_FORMAT = 'tenzro-guardian';

/** Who holds the guardian passkey. Sets the node role, and so the recovery wait. */
export type GuardianSource = 'own_passkey' | 'security_key' | 'trusted_person';

/** The node's recovery role for a guardian. */
export type GuardianRole = 'recovery_key' | 'device';

/** A security key the holder keeps is a recovery key; anything else waits the longest. */
export function guardianRole(source: GuardianSource): GuardianRole {
  return source === 'security_key' ? 'recovery_key' : 'device';
}

export interface GuardianKeys {
  readonly ed25519PublicKey: Uint8Array;
  readonly mlDsaPublicKey: Uint8Array;
  /** Signs a recovery approval, then the caller wipes. */
  approve(recoveryOpHash: Uint8Array): Uint8Array;
  wipe(): void;
}

/** Derives the guardian key pair from a passkey's PRF output. Deterministic in `prf`. */
export function deriveGuardianKeys(prf: Uint8Array): GuardianKeys {
  if (prf.length < 32) throw new Error('passkey PRF output must be at least 32 bytes');
  const edSecret = hkdf(sha256, prf, new Uint8Array(0), utf8(ED25519_INFO), 32);
  const mlSeed = hkdf(sha256, prf, new Uint8Array(0), utf8(ML_DSA_INFO), 32);
  const ml = ml_dsa65.keygen(mlSeed);
  mlSeed.fill(0);
  return {
    ed25519PublicKey: ed25519.getPublicKey(edSecret),
    mlDsaPublicKey: ml.publicKey,
    approve(recoveryOpHash: Uint8Array): Uint8Array {
      const m = compositeMessage(recoveryOpHash);
      const classical = ed25519.sign(m, edSecret);
      const pq = ml_dsa65.sign(m, ml.secretKey, { context: utf8(LABEL_MLDSA65_ED25519) });
      return encodeCompositeSignature(classical, pq);
    },
    wipe(): void {
      edSecret.fill(0);
      ml.secretKey.fill(0);
    },
  };
}

/** `M' = prefix || label || len(ctx) || ctx || SHA-512(message)` for a recovery approval. */
export function compositeMessage(message: Uint8Array): Uint8Array {
  const ctx = utf8(RECOVERY_APPROVAL_CONTEXT);
  return concatBytes(
    utf8(COMPOSITE_PREFIX),
    utf8(LABEL_MLDSA65_ED25519),
    new Uint8Array([ctx.length]),
    ctx,
    sha512(message),
  );
}

function u64le(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

/** The node's wire form of a composite signature: two length-prefixed byte strings. */
export function encodeCompositeSignature(classical: Uint8Array, pq: Uint8Array): Uint8Array {
  return concatBytes(u64le(classical.length), classical, u64le(pq.length), pq);
}

/** What a recovery's guardians approve, recomputed from its parts. */
export function recoveryOpHash(r: {
  readonly account: string;
  /** The new passkey, raw `x || y`. */
  readonly newPasskeyPublicKey: Uint8Array;
  readonly newMlDsaPublicKey: Uint8Array;
  readonly newCredentialId: Uint8Array;
  readonly recoveryId: string;
  readonly expiresAtMs: number;
}): Uint8Array {
  if (r.newPasskeyPublicKey.length !== 64) throw new Error('the new passkey key must be raw x || y');
  const h = sha256.create();
  h.update(utf8(RECOVERY_DOMAIN));
  for (const part of [
    fromHex(r.account),
    r.newPasskeyPublicKey.slice(0, 32),
    r.newPasskeyPublicKey.slice(32),
    sha256(r.newMlDsaPublicKey),
    r.newCredentialId,
    utf8(r.recoveryId),
  ]) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, part.length, false);
    h.update(len);
    h.update(part);
  }
  const exp = new Uint8Array(8);
  new DataView(exp.buffer).setBigUint64(0, BigInt(r.expiresAtMs), false);
  h.update(exp);
  return h.digest();
}

/** What a guardian shares with the account holder. Public data only. */
export interface GuardianCard {
  readonly format: typeof CARD_FORMAT;
  readonly version: 1;
  readonly label: string;
  readonly source: GuardianSource;
  /** `0x`-hex Ed25519 public key. */
  readonly ed25519: string;
  /** `0x`-hex ML-DSA-65 verifying key. */
  readonly mlDsa65: string;
  readonly tier: PasskeyTier;
  /** The provider the authenticator reported, hex; absent or zero when it reports none. */
  readonly aaguid?: string;
  /** The guardian passkey's credential id, hex. */
  readonly credentialId: string;
}

export function encodeGuardianCard(card: GuardianCard): string {
  return btoa(JSON.stringify(card)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeGuardianCard(text: string): GuardianCard {
  let card: GuardianCard;
  try {
    const b64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    card = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as GuardianCard;
  } catch {
    throw new Error('This is not a guardian card.');
  }
  if (card.format !== CARD_FORMAT || card.version !== 1) throw new Error('This is not a guardian card.');
  if (fromHex(card.ed25519).length !== 32 || fromHex(card.mlDsa65).length !== 1952) {
    throw new Error('The guardian card carries malformed keys.');
  }
  return card;
}

/** The independent root a guardian belongs to. */
export function guardianRoot(card: Pick<GuardianCard, 'tier' | 'aaguid' | 'credentialId'>): string {
  if (card.tier === 'device-bound') return `passkey:${card.credentialId.toLowerCase()}`;
  const aaguid = (card.aaguid ?? '').replace(/^0x/, '').toLowerCase();
  // A synced passkey whose provider reports no AAGUID is grouped with every
  // other such passkey: they may all be one provider.
  return /^0*$/.test(aaguid) ? 'provider:unreported' : `provider:${aaguid}`;
}

export interface QuorumCheck {
  readonly ok: boolean;
  /** One sentence for the UI when the quorum is refused. */
  readonly reason: string | null;
}

/**
 * Whether `threshold` approvals from `guardians` must span distinct providers.
 * Guardians the wallet has no card for (added elsewhere) are counted as one
 * shared provider, so they cannot make a quorum look more independent than it is.
 */
export function checkGuardianQuorum(
  guardians: readonly Pick<GuardianCard, 'tier' | 'aaguid' | 'credentialId'>[],
  unknownGuardians: number,
  threshold: number,
): QuorumCheck {
  const total = guardians.length + unknownGuardians;
  if (threshold < 2) {
    return { ok: false, reason: 'A recovery needs at least two guardians to approve, from different providers.' };
  }
  if (threshold > total) {
    return { ok: false, reason: `Add ${threshold - total} more guardian(s) to reach the threshold.` };
  }
  const perRoot = new Map<string, number>();
  for (const g of guardians) perRoot.set(guardianRoot(g), (perRoot.get(guardianRoot(g)) ?? 0) + 1);
  if (unknownGuardians > 0) perRoot.set('unknown', unknownGuardians);
  const largest = Math.max(...perRoot.values());
  if (largest >= threshold) {
    return {
      ok: false,
      reason:
        'Enough guardians sync through one provider to recover the account alone. Add a guardian from another provider or a security key.',
    };
  }
  return { ok: true, reason: null };
}
