/**
 * Pin walletRecover() orchestration semantics. Mirrors wallet-new tests:
 *   - happy path: start → enroll → finalize → store → confirm;
 *   - forwards proof + did + forceRotate verbatim to start;
 *   - cancels session on failure at any step;
 *   - returns the *new* credentialId from the freshly-wrapped share.
 */

import { describe, expect, it, vi } from 'vitest';
import type { TdipDid, TdipIdentity } from '../types/identity.ts';
import type {
  DeviceShareStore,
  PasskeyEnroller,
  PasskeyEnrolment,
  WrappedDeviceShare,
} from './wallet-new.ts';
import { walletRecover, type RecoveryPort } from './wallet-recover.ts';

const DID = 'did:tenzro:human:abc' as TdipDid;

const FAKE_IDENTITY: TdipIdentity = {
  did: DID,
  parts: { method: 'tenzro', kind: 'human', uuid: 'abc' },
  keys: new Map(),
  createdAt: 1_700_000_000_000,
};

const FAKE_SHARE: WrappedDeviceShare = {
  credentialId: 'cred-new',
  wrappedShare: new Uint8Array([0xee]),
  alg: 'aes-256-gcm',
  salt: new Uint8Array([3, 3]),
};

function fakeEnrolment(credentialId = 'cred-new'): PasskeyEnrolment {
  return { credentialId, attestationObject: 'att', clientDataJson: 'cdj' };
}

function makeRecovery(
  overrides: Partial<RecoveryPort> = {},
): { port: RecoveryPort; calls: { name: string; args: unknown }[] } {
  const calls: { name: string; args: unknown }[] = [];
  const start = vi.fn(async (args) => {
    calls.push({ name: 'start', args });
    return {
      sessionId: 'rsess-1',
      challenge: new Uint8Array([0xc1]),
      userHandle: new Uint8Array([0x02]),
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
  return { port: { start, finalize, confirm, cancel, ...overrides }, calls };
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

describe('walletRecover — happy path', () => {
  it('runs start → enroll → finalize → store → confirm and returns new credentialId', async () => {
    const { port, calls } = makeRecovery();
    const enroller = makeEnroller();
    const store: DeviceShareStore & { put: ReturnType<typeof vi.fn> } = {
      put: vi.fn(async () => undefined),
    };

    const r = await walletRecover({
      did: DID,
      proof: { kind: 'email-otp', otp: '123456' },
      enroller,
      recovery: port,
      shareStore: store,
    });

    expect(r.identity.did).toBe(DID);
    expect(r.threshold).toEqual({ k: 2, n: 2 });
    expect(r.credentialId).toBe('cred-new');

    expect(calls.map((c) => c.name)).toEqual(['start', 'finalize', 'confirm']);
    expect(store.put).toHaveBeenCalledWith({
      did: DID,
      share: FAKE_SHARE,
    });
  });

  it('forwards proof + did + forceRotate to start', async () => {
    const { port, calls } = makeRecovery();
    await walletRecover({
      did: DID,
      proof: {
        kind: 'social',
        delegateSignatures: [
          { delegateDid: 'did:tenzro:human:d1' as TdipDid, signature: new Uint8Array([1]) },
        ],
      },
      forceRotate: true,
      enroller: makeEnroller(),
      recovery: port,
    });
    const startCall = calls.find((c) => c.name === 'start');
    expect(startCall?.args).toMatchObject({
      did: DID,
      forceRotate: true,
      proof: { kind: 'social' },
    });
  });

  it('omits forceRotate when not provided', async () => {
    const { port, calls } = makeRecovery();
    await walletRecover({
      did: DID,
      proof: { kind: 'email-otp', otp: '000' },
      enroller: makeEnroller(),
      recovery: port,
    });
    const startCall = calls.find((c) => c.name === 'start');
    expect(startCall?.args).not.toHaveProperty('forceRotate');
  });
});

describe('walletRecover — failure paths cancel cleanly', () => {
  it('cancels session if user cancels passkey ceremony', async () => {
    const { port, calls } = makeRecovery();
    await expect(
      walletRecover({
        did: DID,
        proof: { kind: 'email-otp', otp: '000' },
        enroller: makeEnroller(new Error('user cancelled')),
        recovery: port,
      }),
    ).rejects.toThrow(/user cancelled/);
    expect(calls.map((c) => c.name)).toEqual(['start', 'cancel']);
  });

  it('cancels session if finalize throws', async () => {
    const { port, calls } = makeRecovery({
      finalize: vi.fn(async () => {
        throw new Error('quorum unreachable');
      }),
    });
    await expect(
      walletRecover({
        did: DID,
        proof: { kind: 'email-otp', otp: '000' },
        enroller: makeEnroller(),
        recovery: port,
      }),
    ).rejects.toThrow(/quorum unreachable/);
    expect(calls.map((c) => c.name)).toContain('cancel');
  });

  it('cancels session if shareStore.put throws', async () => {
    const { port, calls } = makeRecovery();
    const store: DeviceShareStore = {
      put: async () => {
        throw new Error('quota exceeded');
      },
    };
    await expect(
      walletRecover({
        did: DID,
        proof: { kind: 'email-otp', otp: '000' },
        enroller: makeEnroller(),
        recovery: port,
        shareStore: store,
      }),
    ).rejects.toThrow(/quota exceeded/);
    expect(calls.map((c) => c.name)).toEqual(['start', 'finalize', 'cancel']);
  });
});
