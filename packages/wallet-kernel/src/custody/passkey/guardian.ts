/**
 * Recovery guardians are plain passkeys.
 *
 * A guardian is an ES256 passkey on the Tenzro relying party, held by the
 * account holder (a security key, another device) or by a person they trust.
 * Nothing is derived from it: its P-256 key is the guardian's key, and it
 * approves a recovery with an ordinary assertion. The guardian hands the
 * account holder a card with the public key, the credential id and the
 * registration authenticatorData (which names the passkey's provider and
 * whether it syncs), and the holder adds it with a passkey approval.
 *
 * Independence: the network counts approvals by independent root, not by
 * guardian. Synced passkeys of one provider count once between them; each
 * device-bound passkey counts on its own. A threshold above the number of
 * roots is refused. `checkGuardianQuorum` previews that rule.
 */

import { fromHex, normalizeHex, toHex, utf8 } from './bytes.ts';
import { parseAuthenticatorFlags } from './webauthn.ts';

const CARD_FORMAT = 'tenzro-guardian';
const CARD_VERSION = 2;

/** Longest guardian label the network accepts, in bytes. */
export const MAX_GUARDIAN_LABEL_BYTES = 64;

/** Who holds the guardian passkey. Sets the node role, and so the recovery wait. */
export type GuardianSource = 'own_passkey' | 'security_key' | 'trusted_person';

/** The node's recovery role for a guardian. */
export type GuardianRole = 'recovery_key' | 'email_verifier' | 'device';

/** A security key the holder keeps is a recovery key; anything else waits the longest. */
export function guardianRole(source: GuardianSource): GuardianRole {
  return source === 'security_key' ? 'recovery_key' : 'device';
}

const ROLE_BYTE: Record<GuardianRole, number> = {
  recovery_key: 0x01,
  email_verifier: 0x02,
  device: 0x03,
};

/** What a passkey's registration authenticatorData says about where it lives. */
export interface RegistrationProvenance {
  /** The provider's AAGUID, 16 bytes; all zero when it reports none. */
  readonly aaguid: Uint8Array;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
}

/** Reads the AAGUID and backup flags from registration authenticatorData. */
export function registrationProvenance(authenticatorData: Uint8Array): RegistrationProvenance {
  const flags = parseAuthenticatorFlags(authenticatorData);
  if (authenticatorData.length < 53 || ((authenticatorData[32] ?? 0) & 0x40) === 0) {
    throw new Error('registration authenticatorData carries no attested credential');
  }
  return {
    aaguid: authenticatorData.slice(37, 53),
    backupEligible: flags.backupEligible,
    backupState: flags.backedUp,
  };
}

/** What a guardian shares with the account holder. Public data only. */
export interface GuardianCard {
  readonly format: typeof CARD_FORMAT;
  readonly version: typeof CARD_VERSION;
  readonly label: string;
  readonly role: GuardianRole;
  /** The relying party the guardian passkey is registered on (its wallet provider's domain). */
  readonly rpId?: string;
  /** The guardian passkey's P-256 key, raw `x || y`, `0x` hex. */
  readonly p256: string;
  /** The guardian passkey's credential id, `0x` hex. */
  readonly credentialId: string;
  /** Its registration authenticatorData, `0x` hex. */
  readonly registrationAuthenticatorData: string;
}

export function encodeGuardianCard(card: GuardianCard): string {
  const bytes = utf8(JSON.stringify(card));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeGuardianCard(text: string): GuardianCard {
  let card: GuardianCard;
  try {
    const b64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    card = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))),
    ) as GuardianCard;
  } catch {
    throw new Error('This is not a guardian card.');
  }
  if (card?.format !== CARD_FORMAT || card.version !== CARD_VERSION) {
    throw new Error('This is not a guardian card.');
  }
  if (!(card.role in ROLE_BYTE)) throw new Error('The guardian card names an unknown role.');
  if (fromHex(card.p256).length !== 64 || fromHex(card.credentialId).length === 0) {
    throw new Error('The guardian card carries a malformed key.');
  }
  try {
    registrationProvenance(fromHex(card.registrationAuthenticatorData));
  } catch {
    throw new Error('The guardian card carries malformed registration data.');
  }
  if (utf8(card.label.trim()).length > MAX_GUARDIAN_LABEL_BYTES) {
    throw new Error(`A guardian label is at most ${MAX_GUARDIAN_LABEL_BYTES} bytes.`);
  }
  return card;
}

/** A guardian as far as independence is concerned. */
export interface QuorumMember {
  /** Names a device-bound guardian (its key or credential id). */
  readonly id: string;
  readonly backupEligible: boolean;
  /** AAGUID hex; zero or absent when the provider reports none. */
  readonly aaguid?: string;
}

/** A guardian card as a quorum member. */
export function cardQuorumMember(card: GuardianCard): QuorumMember {
  const p = registrationProvenance(fromHex(card.registrationAuthenticatorData));
  return { id: normalizeHex(card.p256), backupEligible: p.backupEligible, aaguid: toHex(p.aaguid) };
}

/**
 * The independent root a guardian belongs to: its sync provider when it can
 * sync, itself when it is device-bound. Synced passkeys whose provider
 * reports no AAGUID share one root.
 */
export function guardianRoot(m: QuorumMember): string {
  if (!m.backupEligible) return `device:${normalizeHex(m.id)}`;
  const aaguid = normalizeHex(m.aaguid ?? '').padStart(32, '0');
  return `provider:${aaguid}`;
}

/** How many independent roots `members` amount to. */
export function guardianIndependentRoots(members: readonly QuorumMember[]): number {
  return new Set(members.map(guardianRoot)).size;
}

export interface QuorumCheck {
  readonly ok: boolean;
  readonly roots: number;
  /** One sentence for the UI when the quorum is refused or weak. */
  readonly reason: string | null;
}

/**
 * Previews the network's rule for `threshold` over `members`: approvals count
 * by independent root, and the threshold must be between 1 and the number of
 * roots. A threshold of 1 is accepted but flagged: one guardian could then
 * recover the account alone.
 */
export function checkGuardianQuorum(
  members: readonly QuorumMember[],
  threshold: number,
): QuorumCheck {
  const roots = guardianIndependentRoots(members);
  if (!Number.isInteger(threshold) || threshold < 1) {
    return { ok: false, roots, reason: 'The threshold must be at least 1.' };
  }
  if (threshold > roots) {
    return {
      ok: false,
      roots,
      reason:
        roots < members.length
          ? `These guardians amount to ${roots} independent provider(s): passkeys that sync through one provider count once. Add a guardian from another provider or a security key.`
          : `Add ${threshold - roots} more guardian(s) from different providers to reach the threshold.`,
    };
  }
  if (threshold < 2) {
    return {
      ok: true,
      roots,
      reason: 'One guardian can recover this account alone. A threshold of 2 or more is safer.',
    };
  }
  return { ok: true, roots, reason: null };
}
