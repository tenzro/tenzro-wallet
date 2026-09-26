/**
 * Wallet readiness: how many independent roots protect the account.
 *
 * A device-bound passkey cannot be copied, which is what makes it a good
 * root, and also why it cannot survive the loss of its device. Survivability
 * therefore comes from more than one root, never from weakening any one:
 *
 *   - an account with a single root is one lost device away from being
 *     unrecoverable, so the wallet receives but does not send until a second
 *     device (or a guardian) is added;
 *   - a synced passkey (backup eligible) is a lower tier: it can move between
 *     devices by design, so it is never the only root. An account whose roots
 *     are all synced needs a device-bound passkey or a guardian.
 */

import type { PasskeyTier } from './webauthn.ts';

export interface DeviceSummary {
  /** Credential id, `0x`-prefixed hex. */
  readonly credentialIdHex: string;
  readonly label?: string;
  /** Unknown when the node has no attestation record for the device. */
  readonly tier?: PasskeyTier;
  /** Whether this is the passkey the wallet is running on. */
  readonly thisDevice?: boolean;
}

export type ReadinessBlocker = 'no-devices' | 'single-root' | 'synced-only';

export interface WalletReadiness {
  /** The account can send. Receiving is always possible. */
  readonly ready: boolean;
  readonly blocker: ReadinessBlocker | null;
  readonly devices: number;
  readonly deviceBoundDevices: number;
  readonly syncedDevices: number;
  readonly guardians: number;
  /** One sentence the UI can show next to the device list. */
  readonly guidance: string;
}

export function assessReadiness(
  devices: readonly DeviceSummary[],
  opts: { readonly guardians?: number } = {},
): WalletReadiness {
  const guardians = opts.guardians ?? 0;
  const deviceBound = devices.filter((d) => d.tier === 'device-bound').length;
  const synced = devices.filter((d) => d.tier === 'synced').length;
  const base = {
    devices: devices.length,
    deviceBoundDevices: deviceBound,
    syncedDevices: synced,
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
  if (devices.length === 1 && guardians === 0) {
    return {
      ...base,
      ready: false,
      blocker: 'single-root',
      guidance:
        'Add a second device before sending. With one passkey, losing that device means losing the wallet.',
    };
  }
  if (synced === devices.length && deviceBound === 0 && guardians === 0) {
    return {
      ...base,
      ready: false,
      blocker: 'synced-only',
      guidance:
        'All your passkeys are synced copies. Add a device-bound passkey, such as a security key or a phone, or a guardian.',
    };
  }
  return {
    ...base,
    ready: true,
    blocker: null,
    guidance:
      devices.length >= 2
        ? `Protected by ${devices.length} devices. Any one of them can approve and recover the wallet.`
        : 'Protected by one device and your guardians.',
  };
}
