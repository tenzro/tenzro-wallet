/**
 * Pin walletNew() orchestration semantics:
 *   - happy path runs start → enrol → finalize → store → confirm in order;
 *   - the credentialId returned matches the wrapped share's credentialId;
 *   - if the user cancels the passkey UI, the kernel calls cancel(sessionId);
 *   - if finalize fails, the kernel calls cancel(sessionId);
 *   - if shareStore.put fails, the kernel calls cancel(sessionId);
 *   - if confirm fails, the kernel calls cancel(sessionId);
 *   - shareStore is optional (no put when omitted).
 */

import { describe, expect, it, vi } from 'vitest';
import type { TdipIdentity } from '../types/identity.ts';
import {
  walletNew,
  type DeviceShareStore,
  type PasskeyEnroller,
  type PasskeyEnrolment,
  type ProvisioningPort,
  type WrappedDeviceShare,
} from './wallet-new.ts';

const FAKE_IDENTITY: TdipIdentity = {
  did: 'did:tenzro:human:abc' as TdipIdentity['did'],
  parts: { method: 'tenzro', kind: 'human', uuid: 'abc' },
  keys: new Map(),
  createdAt: 1_700_000_000_000,
};

const FAKE_SHARE: WrappedDeviceShare = {
  credentialId: 'cred-1',
  wrappedShare: new Uint8Array([9, 9]),
  alg: 'aes-256-gcm',
  salt: new Uint8Array([1, 2]),
};

function fakeEnrolment(credentialId = 'cred-1'): PasskeyEnrolment {
  return { credentialId, attestationObject: 'att', clientDataJson: 'cdj' };
}

function makeProvisioning(
  overrides: Partial<ProvisioningPort> = {},
): { port: ProvisioningPort; calls: { name: string; args: unknown }[] } {
  const calls: { name: string; args: unknown }[] = [];
  const start = vi.fn(async (args: { kind: 'human' }) => {
    calls.push({ name: 'start', args });
    return {
      sessionId: 'sess-1',
      challenge: new Uint8Array([0xc1]),
      userHandle: new Uint8Array([0x01]),
      userDisplayName: 'alice',
    };
  });
  const finalize = vi.fn(async (args) => {
    calls.push({ name: 'finalize', args });
    return {
      identity: FAKE_IDENTITY,
      threshold: { k: 2, n: 2 },
      wrappedShare: FAKE_SHARE,
    };
  });
  const confirm = vi.fn(async (args) => {
    calls.push({ name: 'confirm', args });
  });
  const cancel = vi.fn(async (args) => {
    calls.push({ name: 'cancel', args });
  });
  return {
    port: { start, finalize, confirm, cancel, ...overrides },
    calls,
  };
}

function makeEnroller(
  result: PasskeyEnrolment | Error = fakeEnrolment(),
): PasskeyEnroller & { enroll: ReturnType<typeof vi.fn> } {
  const enroll = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { enroll } as PasskeyEnroller & { enroll: ReturnType<typeof vi.fn> };
}

describe('walletNew — happy path', () => {
  it('orchestrates start → enroll → finalize → store → confirm in order', async () => {
    const { port, calls } = makeProvisioning();
    const enroller = makeEnroller();
    const store: DeviceShareStore & { put: ReturnType<typeof vi.fn> } = {
      put: vi.fn(async () => undefined),
    };

    const r = await walletNew({
      enroller,
      provisioning: port,
      shareStore: store,
    });

    expect(r.identity.did).toBe(FAKE_IDENTITY.did);
    expect(r.threshold).toEqual({ k: 2, n: 2 });
    expect(r.credentialId).toBe('cred-1');

    const order = calls.map((c) => c.name);
    expect(order).toEqual(['start', 'finalize', 'confirm']);
    expect(enroller.enroll).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith({
      did: FAKE_IDENTITY.did,
      share: FAKE_SHARE,
    });
  });

  it('skips shareStore when not provided', async () => {
    const { port, calls } = makeProvisioning();
    await walletNew({ enroller: makeEnroller(), provisioning: port });
    expect(calls.map((c) => c.name)).toEqual(['start', 'finalize', 'confirm']);
  });

  it('passes node-issued challenge + userHandle to enroller', async () => {
    const { port } = makeProvisioning();
    const enroller = makeEnroller();
    await walletNew({ enroller, provisioning: port });
    expect(enroller.enroll).toHaveBeenCalledWith({
      challenge: new Uint8Array([0xc1]),
      userId: new Uint8Array([0x01]),
      userDisplayName: 'alice',
    });
  });
});

describe('walletNew — failure paths cancel cleanly', () => {
  it('cancels session if user cancels passkey ceremony', async () => {
    const { port, calls } = makeProvisioning();
    await expect(
      walletNew({
        enroller: makeEnroller(new Error('user cancelled')),
        provisioning: port,
      }),
    ).rejects.toThrow(/user cancelled/);
    expect(calls.map((c) => c.name)).toEqual(['start', 'cancel']);
    expect(calls.at(-1)?.args).toEqual({ sessionId: 'sess-1' });
  });

  it('cancels session if finalize throws', async () => {
    const { port, calls } = makeProvisioning({
      finalize: vi.fn(async () => {
        throw new Error('quorum unreachable');
      }),
    });
    await expect(
      walletNew({ enroller: makeEnroller(), provisioning: port }),
    ).rejects.toThrow(/quorum unreachable/);
    expect(calls.map((c) => c.name)).toContain('cancel');
  });

  it('cancels session if shareStore.put throws', async () => {
    const { port, calls } = makeProvisioning();
    const store: DeviceShareStore = {
      put: async () => {
        throw new Error('quota exceeded');
      },
    };
    await expect(
      walletNew({
        enroller: makeEnroller(),
        provisioning: port,
        shareStore: store,
      }),
    ).rejects.toThrow(/quota exceeded/);
    expect(calls.map((c) => c.name)).toEqual(['start', 'finalize', 'cancel']);
  });

  it('cancels session if confirm throws', async () => {
    const { port, calls } = makeProvisioning({
      confirm: vi.fn(async () => {
        throw new Error('topology write failed');
      }),
    });
    await expect(
      walletNew({ enroller: makeEnroller(), provisioning: port }),
    ).rejects.toThrow(/topology write failed/);
    // confirm override doesn't write to `calls`; we only see the
    // default-tracked calls (start, finalize, cancel).
    expect(calls.map((c) => c.name)).toEqual(['start', 'finalize', 'cancel']);
  });

  it('swallows cancel errors so the original error surfaces', async () => {
    const { port } = makeProvisioning({
      finalize: vi.fn(async () => {
        throw new Error('finalize failed');
      }),
      cancel: vi.fn(async () => {
        throw new Error('cancel also failed');
      }),
    });
    await expect(
      walletNew({ enroller: makeEnroller(), provisioning: port }),
    ).rejects.toThrow(/finalize failed/);
  });
});
