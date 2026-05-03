import { describe, expect, it } from 'vitest';
import { provisionIdentity } from '../identity/provision.ts';
import type { AssetId } from '../types/asset.ts';
import type { Intent } from '../types/intent.ts';
import { selectRoute } from './route.ts';

const TNZO: AssetId = { scope: 'tenzro-native', symbol: 'TNZO', decimals: 18 };
const CC: AssetId = { scope: 'canton-mainnet', symbol: 'CC', decimals: 10 };
const id = await provisionIdentity({ uuid: 'route-1' });

describe('route selection', () => {
  it('routes TNZO to a TDIP recipient as native on tenzro-native', () => {
    const intent: Intent = {
      kind: 'send',
      from: id.did,
      to: { kind: 'tdip', did: id.did },
      asset: TNZO,
      amount: 1n,
    };
    const sel = selectRoute(intent);
    expect(sel.route.kind).toBe('native');
    expect(sel.fromSurface).toBe('tenzro-native');
  });

  it('treats TNZO native → SVM as a cross-VM pointer (not a bridge)', () => {
    const intent: Intent = {
      kind: 'send',
      from: id.did,
      to: { kind: 'svm', publicKey: 'recipient-svm-pk' },
      asset: TNZO,
      amount: 1n,
      fromSurface: 'tenzro-native',
    };
    const sel = selectRoute(intent);
    expect(sel.route.kind).toBe('cross-vm-pointer');
    if (sel.route.kind === 'cross-vm-pointer') {
      expect(sel.route.precompile).toBe('0x1003');
    }
  });

  it('routes CC sends through the canton-adapter bridge', () => {
    const intent: Intent = {
      kind: 'send',
      from: id.did,
      to: { kind: 'canton', partyId: 'kraken::1220abc' },
      asset: CC,
      amount: 1n,
    };
    const sel = selectRoute(intent);
    expect(sel.route.kind).toBe('native');
    expect(sel.fromSurface).toBe('canton-external');
  });

  it('routes TNZO native → EVM-on-Tenzro as a pointer op', () => {
    const intent: Intent = {
      kind: 'send',
      from: id.did,
      to: { kind: 'evm', address: '0xdead' },
      asset: TNZO,
      amount: 1n,
      fromSurface: 'tenzro-native',
    };
    const sel = selectRoute(intent);
    expect(sel.route.kind).toBe('cross-vm-pointer');
  });
});
