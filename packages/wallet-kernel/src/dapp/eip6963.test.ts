/**
 * Pin EIP-6963 announcement-payload builder. The browser-extension package
 * dispatches the event; this kernel module just shapes the `info` half.
 */

import { describe, expect, it } from 'vitest';
import { TENZRO_PROVIDER_RDNS } from 'tenzro-sdk';
import {
  buildEip6963Announcement,
  EIP6963_ANNOUNCE_EVENT,
  EIP6963_REQUEST_EVENT,
} from './eip6963.ts';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

describe('buildEip6963Announcement', () => {
  it('returns the canonical info object with Tenzro defaults', () => {
    const info = buildEip6963Announcement({
      uuid: VALID_UUID,
      icon: VALID_ICON,
    });
    expect(info).toEqual({
      uuid: VALID_UUID,
      name: 'Tenzro Wallet',
      rdns: TENZRO_PROVIDER_RDNS,
      icon: VALID_ICON,
    });
  });

  it('default rdns matches the SDK constant (announce/consume alignment)', () => {
    // Pin: the kernel's announce side and the SDK's consume side
    // (`discoverEip6963Provider`) must agree on the rdns by construction.
    // If the SDK rotates the constant, this test continues to pass because
    // the kernel imports it; if anyone hardcodes a string here, the import
    // alignment is what surfaces the regression.
    const info = buildEip6963Announcement({
      uuid: VALID_UUID,
      icon: VALID_ICON,
    });
    expect(info.rdns).toBe(TENZRO_PROVIDER_RDNS);
    expect(TENZRO_PROVIDER_RDNS).toBe('network.tenzro.wallet');
  });

  it('overrides name + rdns when supplied', () => {
    const info = buildEip6963Announcement({
      uuid: VALID_UUID,
      icon: VALID_ICON,
      name: 'Tenzro Wallet (Beta)',
      rdns: 'beta.tenzro.com',
    });
    expect(info.name).toBe('Tenzro Wallet (Beta)');
    expect(info.rdns).toBe('beta.tenzro.com');
  });

  it('rejects malformed UUIDs', () => {
    expect(() =>
      buildEip6963Announcement({ uuid: 'not-a-uuid', icon: VALID_ICON }),
    ).toThrow(/invalid uuid/);
  });

  it('rejects non-data: icon URLs', () => {
    expect(() =>
      buildEip6963Announcement({
        uuid: VALID_UUID,
        icon: 'https://tenzro.com/icon.svg',
      }),
    ).toThrow(/data: URL/);
  });

  it('rejects rdns without a dot', () => {
    expect(() =>
      buildEip6963Announcement({
        uuid: VALID_UUID,
        icon: VALID_ICON,
        rdns: 'tenzro',
      }),
    ).toThrow(/reverse-DNS/);
  });

  it('exports the canonical event names', () => {
    expect(EIP6963_ANNOUNCE_EVENT).toBe('eip6963:announceProvider');
    expect(EIP6963_REQUEST_EVENT).toBe('eip6963:requestProvider');
  });
});
