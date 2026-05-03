/**
 * Canonical wire identifier for a `SurfaceKey`. Used as the
 * `surfaceKey` field on Tenzro custody endpoint payloads
 * (`/wallet/frost/*`, `/wallet/mldsa/*`, etc.) so the node can find
 * the correct share-set without the wallet shipping public-key bytes
 * inline on every request.
 *
 * Convention:
 *   - tenzro-native / svm-on-tenzro: `{surface}:{address}`
 *   - evm-on-tenzro:                 `{surface}:{address}` (lower-case hex)
 *   - canton-{internal,external}:    `{surface}:{partyId}`
 */

import type { SurfaceKey } from '../types/identity.ts';

export function surfaceKeyId(key: SurfaceKey): string {
  switch (key.surface) {
    case 'tenzro-native':
    case 'svm-on-tenzro':
      return `${key.surface}:${key.address}`;
    case 'evm-on-tenzro':
      return `${key.surface}:${key.address.toLowerCase()}`;
    case 'canton-internal':
    case 'canton-external':
      return `${key.surface}:${key.partyId}`;
  }
}
