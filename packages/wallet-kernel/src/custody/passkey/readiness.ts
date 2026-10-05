/**
 * Wallet readiness: how many independent roots protect the account.
 *
 * Any passkey the holder unlocks (biometric or PIN) can approve, synced or
 * not. What protects the account is independence: sending, recovery and
 * raising limits need two roots that cannot be lost or taken together.
 *
 *   - a device-bound passkey (a security key, a device-only credential) is a
 *     root of its own;
 *   - synced passkeys are grouped by their provider (the AAGUID the network
 *     records): every copy in one iCloud Keychain or one password manager is a
 *     single root, because one account compromise or loss reaches them all;
 *   - a passkey the network has no provider record for counts as one root.
 *
 * With one independent root the wallet receives but does not send, until a
 * second one (or a guardian) is added.
 */

import type { PasskeyTier } from './webauthn.ts';

export interface DeviceSummary {
  /** Credential id, `0x`-prefixed hex. */
  readonly credentialIdHex: string;
  readonly label?: string;
  /** Unknown when the node has no record of the passkey's sync state. */
  readonly tier?: PasskeyTier;
  /** The provider (authenticator model or password manager) the network recorded, hex. */
  readonly aaguid?: string;
  /** Whether this is the passkey the wallet is running on. */
  readonly thisDevice?: boolean;
  /** The wallet provider's relying party the passkey is registered on. */
  readonly rpId?: string;
  /** When it joined the keystore on chain (ms); absent before the account's first change. */
  readonly addedAtMs?: number;
  /**
   * Where it stands on the wallet: `on-wallet` acts and counts now;
   * `waiting` is linked and counts as a device from `countsFromMs` (a new
   * passkey on an account with fewer than two devices waits, so a stolen
   * one cannot add itself and spend); `recovering` joins by recovery once
   * the wait ends at `countsFromMs`, and any device on the wallet can cancel
   * it until then.
   */
  readonly status?: DeviceStatus;
  /** When a `waiting` or `recovering` passkey starts to count (ms). */
  readonly countsFromMs?: number;
}

export type DeviceStatus = 'on-wallet' | 'waiting' | 'recovering';

/** The devices that act and count now. */
export function devicesOnWallet(devices: readonly DeviceSummary[]): DeviceSummary[] {
  return devices.filter((d) => (d.status ?? 'on-wallet') === 'on-wallet');
}

/** The root a passkey belongs to: its sync provider when synced, itself otherwise. */
export function rootOf(d: DeviceSummary): string {
  return d.tier === 'synced' && d.aaguid
    ? `provider:${d.aaguid.toLowerCase()}`
    : `passkey:${d.credentialIdHex.toLowerCase()}`;
}

/** How many roots the account has that cannot be lost or taken together. */
export function independentRoots(devices: readonly DeviceSummary[]): number {
  return new Set(devices.map(rootOf)).size;
}

export type ReadinessBlocker = 'no-devices' | 'single-root';

export interface WalletReadiness {
  /** The account can send. Receiving is always possible. */
  readonly ready: boolean;
  readonly blocker: ReadinessBlocker | null;
  readonly devices: number;
  /** Roots that cannot be lost or taken together (see `independentRoots`). */
  readonly independentRoots: number;
  readonly deviceBoundDevices: number;
  readonly syncedDevices: number;
  readonly guardians: number;
  /** One sentence the UI can show next to the device list. */
  readonly guidance: string;
}

export function assessReadiness(
  listed: readonly DeviceSummary[],
  opts: { readonly guardians?: number } = {},
): WalletReadiness {
  const guardians = opts.guardians ?? 0;
  // Only passkeys on the wallet count; one still waiting or joining by
  // recovery does not, and guardians recover but never spend.
  const devices = devicesOnWallet(listed);
  const roots = independentRoots(devices);
  const base = {
    devices: devices.length,
    independentRoots: roots,
    deviceBoundDevices: devices.filter((d) => d.tier === 'device-bound').length,
    syncedDevices: devices.filter((d) => d.tier === 'synced').length,
    guardians,
  };

  if (devices.length === 0) {
    return {
      ...base,
      ready: false,
      blocker: 'no-devices',
      guidance: 'Create a passkey to set up this wallet.',
    };
  }
  if (roots < 2) {
    return {
      ...base,
      ready: false,
      blocker: 'single-root',
      guidance:
        devices.length > 1
          ? 'Your passkeys all sync through one password manager, so they count as one. Add a passkey from another provider, a security key, or a guardian before sending.'
          : listed.some((d) => d.status === 'waiting')
            ? 'Your new device counts once its wait is over; sending opens then.'
            : 'Add a second device before sending. With one passkey, losing that device means losing the wallet.',
    };
  }
  return {
    ...base,
    ready: true,
    blocker: null,
    guidance: `Protected by ${roots} independent roots. Any device on the wallet can approve and send.${
      guardians > 0
        ? ` ${guardians} guardian${guardians === 1 ? '' : 's'} can help you recover.`
        : ''
    }`,
  };
}
