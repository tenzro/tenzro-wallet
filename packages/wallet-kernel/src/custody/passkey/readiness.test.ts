import { describe, expect, it } from 'vitest';
import { assessReadiness } from './readiness.ts';

const dev = (id: string, tier?: 'device-bound' | 'synced') => ({
  credentialIdHex: `0x${id}`,
  ...(tier ? { tier } : {}),
});

describe('assessReadiness', () => {
  it('blocks sending with a single root', () => {
    const r = assessReadiness([dev('01', 'device-bound')]);
    expect(r.ready).toBe(false);
    expect(r.blocker).toBe('single-root');
  });

  it('is ready with two devices', () => {
    const r = assessReadiness([dev('01', 'device-bound'), dev('02')]);
    expect(r.ready).toBe(true);
    expect(r.blocker).toBeNull();
  });

  it('never lets synced passkeys be the only roots', () => {
    const r = assessReadiness([dev('01', 'synced'), dev('02', 'synced')]);
    expect(r.ready).toBe(false);
    expect(r.blocker).toBe('synced-only');
  });

  it('accepts one device plus guardians', () => {
    expect(assessReadiness([dev('01', 'device-bound')], { guardians: 2 }).ready).toBe(true);
  });

  it('reports an empty account', () => {
    expect(assessReadiness([]).blocker).toBe('no-devices');
  });
});
