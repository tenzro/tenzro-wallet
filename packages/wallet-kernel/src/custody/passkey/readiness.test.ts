import { describe, expect, it } from 'vitest';
import { assessReadiness, independentRoots } from './readiness.ts';

const dev = (id: string, tier?: 'device-bound' | 'synced', aaguid?: string) => ({
  credentialIdHex: `0x${id}`,
  ...(tier ? { tier } : {}),
  ...(aaguid ? { aaguid } : {}),
});
const ICLOUD = 'fbfc3007154e4ecc8c0b6e020557d7bd';
const OTHER = 'ea9b8d664d011d213ce4b6b48cb575d4';

describe('independentRoots', () => {
  it('counts synced copies in one provider once', () => {
    expect(independentRoots([dev('01', 'synced', ICLOUD), dev('02', 'synced', ICLOUD)])).toBe(1);
  });

  it('counts different providers separately', () => {
    expect(independentRoots([dev('01', 'synced', ICLOUD), dev('02', 'synced', OTHER)])).toBe(2);
  });

  it('counts every device-bound passkey on its own, even of one model', () => {
    expect(
      independentRoots([dev('01', 'device-bound', OTHER), dev('02', 'device-bound', OTHER)]),
    ).toBe(2);
  });

  it('counts a synced provider and a security key as two', () => {
    expect(independentRoots([dev('01', 'synced', ICLOUD), dev('02', 'device-bound')])).toBe(2);
  });

  it('counts a passkey with no provider record as one root', () => {
    expect(independentRoots([dev('01'), dev('02')])).toBe(2);
  });
});

describe('assessReadiness', () => {
  it('blocks sending with a single root', () => {
    const r = assessReadiness([dev('01', 'device-bound')]);
    expect(r.ready).toBe(false);
    expect(r.blocker).toBe('single-root');
  });

  it('is ready with two independent roots, synced or not', () => {
    const r = assessReadiness([dev('01', 'synced', ICLOUD), dev('02', 'synced', OTHER)]);
    expect(r.ready).toBe(true);
    expect(r.independentRoots).toBe(2);
    expect(r.blocker).toBeNull();
  });

  it('treats two copies in one password manager as one root', () => {
    const r = assessReadiness([dev('01', 'synced', ICLOUD), dev('02', 'synced', ICLOUD)]);
    expect(r.ready).toBe(false);
    expect(r.blocker).toBe('single-root');
    expect(r.guidance).toMatch(/one password manager/);
  });

  it('guardians recover but do not open sending', () => {
    expect(assessReadiness([dev('01', 'device-bound')], { guardians: 2 }).ready).toBe(false);
  });

  it('reports an empty account', () => {
    expect(assessReadiness([]).blocker).toBe('no-devices');
  });
});

describe('device states', () => {
  it('a passkey still waiting to count does not open sending', () => {
    const waiting = { ...dev('02', 'device-bound'), status: 'waiting' as const, countsFromMs: 10 };
    const r = assessReadiness([dev('01', 'device-bound'), waiting]);
    expect(r.ready).toBe(false);
    expect(r.independentRoots).toBe(1);
    expect(r.guidance).toMatch(/counts once its wait is over/);
  });

  it('a passkey joining by recovery does not count', () => {
    const joining = {
      ...dev('03', 'device-bound'),
      status: 'recovering' as const,
      countsFromMs: 10,
    };
    expect(assessReadiness([dev('01', 'device-bound'), joining]).ready).toBe(false);
  });

  it('two devices on the wallet open sending', () => {
    const r = assessReadiness([
      dev('01', 'device-bound'),
      { ...dev('02', 'device-bound'), status: 'on-wallet' as const },
    ]);
    expect(r.ready).toBe(true);
    expect(r.guidance).toMatch(/2 independent roots/);
  });
});
