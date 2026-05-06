/**
 * Pin the share-unwrap mode-selection + path orchestration. The
 * authenticator + envelope ports are stubbed; tests verify each mode
 * calls the right endpoint subset and that share bytes get wiped on
 * dispose().
 */

import { describe, expect, it, vi } from 'vitest';
import {
  type FrostBackend,
  type PasskeyAuthenticatorAdapter,
  type PasskeyCapabilities,
  PasskeyShareUnwrapper,
  type ShareEnvelopePort,
} from './unwrapper.ts';

function caps(p: { prf?: boolean; largeBlob?: boolean }): PasskeyCapabilities {
  return { prf: p.prf ?? false, largeBlob: p.largeBlob ?? false, escrow: true };
}

function makeAuth(): PasskeyAuthenticatorAdapter & {
  prfCalls: number;
  largeBlobCalls: number;
  basicCalls: number;
} {
  const stub = {
    prfCalls: 0,
    largeBlobCalls: 0,
    basicCalls: 0,
    async prfAssertion() {
      stub.prfCalls++;
      return {
        prfOutput: new Uint8Array(32).fill(0x77),
        assertion: {
          credentialId: 'c',
          clientDataJson: '',
          authenticatorData: '',
          signature: '',
        },
      };
    },
    async readLargeBlob() {
      stub.largeBlobCalls++;
      return {
        blob: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        assertion: {
          credentialId: 'c',
          clientDataJson: '',
          authenticatorData: '',
          signature: '',
        },
      };
    },
    async basicAssertion() {
      stub.basicCalls++;
      return {
        credentialId: 'c',
        clientDataJson: '',
        authenticatorData: '',
        signature: '',
      };
    },
  };
  return stub;
}

function makeEnv(): ShareEnvelopePort & {
  fetchCalls: number;
  startCalls: number;
  finishCalls: number;
} {
  const stub = {
    fetchCalls: 0,
    startCalls: 0,
    finishCalls: 0,
    async fetchEnvelope() {
      stub.fetchCalls++;
      return {
        wrappedShare: new Uint8Array([1, 2, 3, 4]),
        alg: 'aes-256-gcm',
        salt: new Uint8Array([9, 9]),
      };
    },
    async startEscrow() {
      stub.startCalls++;
      return { nonce: 'n', expiresAt: Date.now() + 60_000 };
    },
    async finishEscrow() {
      stub.finishCalls++;
      return {
        wrappedShare: new Uint8Array([5, 6, 7, 8]),
        pepper: new Uint8Array(32).fill(0x33),
      };
    },
  };
  return stub;
}

function makeFrost(): FrostBackend {
  return {
    async commit() {
      return new Uint8Array([0xc0]);
    },
    async respond() {
      return new Uint8Array([0xa0]);
    },
  };
}

const REQ = {
  credentialId: 'cred-1',
  surfaceKeyId: 'tenzro-native:tnz1abc',
  scheme: 'ed25519' as const,
};

const fakeDecrypt = vi.fn(async () => new Uint8Array([0x42, 0x42, 0x42]));

describe('PasskeyShareUnwrapper.pickMode', () => {
  it('picks prf when supported', () => {
    const u = new PasskeyShareUnwrapper({
      capabilities: caps({ prf: true, largeBlob: true }),
      authenticator: makeAuth(),
      envelope: makeEnv(),
      frost: makeFrost(),
      aeadDecrypt: fakeDecrypt,
    });
    expect(u.pickMode()).toBe('prf');
  });

  it('falls back to large-blob when prf absent', () => {
    const u = new PasskeyShareUnwrapper({
      capabilities: caps({ largeBlob: true }),
      authenticator: makeAuth(),
      envelope: makeEnv(),
      frost: makeFrost(),
      aeadDecrypt: fakeDecrypt,
    });
    expect(u.pickMode()).toBe('large-blob');
  });

  it('falls back to escrow when nothing else', () => {
    const u = new PasskeyShareUnwrapper({
      capabilities: caps({}),
      authenticator: makeAuth(),
      envelope: makeEnv(),
      frost: makeFrost(),
      aeadDecrypt: fakeDecrypt,
    });
    expect(u.pickMode()).toBe('escrow');
  });
});

describe('PasskeyShareUnwrapper.unwrap', () => {
  it('PRF path calls prf-assertion + envelope endpoint, then aead-decrypts', async () => {
    fakeDecrypt.mockClear();
    const auth = makeAuth();
    const env = makeEnv();
    const u = new PasskeyShareUnwrapper({
      capabilities: caps({ prf: true }),
      authenticator: auth,
      envelope: env,
      frost: makeFrost(),
      aeadDecrypt: fakeDecrypt,
    });
    const holder = await u.unwrap(REQ);
    expect(auth.prfCalls).toBe(1);
    expect(env.fetchCalls).toBe(1);
    expect(env.startCalls).toBe(0);
    expect(fakeDecrypt).toHaveBeenCalledOnce();
    expect(holder.scheme).toBe('ed25519');
  });

  it('largeBlob path skips the envelope endpoint entirely', async () => {
    const auth = makeAuth();
    const env = makeEnv();
    const u = new PasskeyShareUnwrapper({
      capabilities: caps({ largeBlob: true }),
      authenticator: auth,
      envelope: env,
      frost: makeFrost(),
      aeadDecrypt: fakeDecrypt,
    });
    await u.unwrap(REQ);
    expect(auth.largeBlobCalls).toBe(1);
    expect(env.fetchCalls).toBe(0);
    expect(env.startCalls).toBe(0);
  });

  it('escrow path runs challenge → basic-assertion → unwrap', async () => {
    fakeDecrypt.mockClear();
    const auth = makeAuth();
    const env = makeEnv();
    const u = new PasskeyShareUnwrapper({
      capabilities: caps({}),
      authenticator: auth,
      envelope: env,
      frost: makeFrost(),
      aeadDecrypt: fakeDecrypt,
    });
    await u.unwrap(REQ);
    expect(env.startCalls).toBe(1);
    expect(auth.basicCalls).toBe(1);
    expect(env.finishCalls).toBe(1);
    expect(fakeDecrypt).toHaveBeenCalledOnce();
  });

  it('share holder wipes secret bytes on dispose', async () => {
    const share = new Uint8Array([0x42, 0x42, 0x42]);
    const u = new PasskeyShareUnwrapper({
      capabilities: caps({ prf: true }),
      authenticator: makeAuth(),
      envelope: makeEnv(),
      frost: makeFrost(),
      aeadDecrypt: async () => share,
    });
    const holder = await u.unwrap(REQ);
    expect(share.every((b) => b === 0x42)).toBe(true);
    holder.dispose?.();
    expect(share.every((b) => b === 0)).toBe(true);

    // calls after dispose throw
    await expect(holder.commit()).rejects.toThrow(/already disposed/);
  });
});
