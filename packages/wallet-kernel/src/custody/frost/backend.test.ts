/**
 * Pin the FrostBackend dispatch helpers' behaviour:
 *   - `frostBackendUnavailable()` throws `FrostBackendUnavailable` for
 *     both `commit` and `respond` and includes the scheme in the
 *     message so failures are diagnosable.
 *   - `composeFrostBackend()` routes by scheme and falls back to
 *     `FrostBackendUnavailable` for missing curves.
 */

import { describe, expect, it, vi } from 'vitest';
import type { FrostBackend } from '../passkey-share/unwrapper.ts';
import {
  FrostBackendUnavailable,
  composeFrostBackend,
  frostBackendUnavailable,
} from './backend.ts';

const ZERO = new Uint8Array(0);

describe('frostBackendUnavailable', () => {
  it('throws FrostBackendUnavailable on commit, with scheme in message', async () => {
    const b = frostBackendUnavailable();
    const err = await b
      .commit({ share: ZERO, scheme: 'ed25519' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(FrostBackendUnavailable);
    expect((err as FrostBackendUnavailable).scheme).toBe('ed25519');
    expect((err as Error).message).toMatch(/ed25519/);
  });

  it('throws on respond too', async () => {
    const b = frostBackendUnavailable();
    await expect(
      b.respond({
        share: ZERO,
        scheme: 'secp256k1',
        preimage: ZERO,
        groupCommitment: ZERO,
        signerSet: [],
        lambda: ZERO,
      }),
    ).rejects.toBeInstanceOf(FrostBackendUnavailable);
  });
});

describe('composeFrostBackend', () => {
  function fakeBackend(): FrostBackend & { commit: ReturnType<typeof vi.fn>; respond: ReturnType<typeof vi.fn> } {
    return {
      commit: vi.fn(async () => new Uint8Array([0xc0])),
      respond: vi.fn(async () => new Uint8Array([0xaa])),
    } as unknown as FrostBackend & {
      commit: ReturnType<typeof vi.fn>;
      respond: ReturnType<typeof vi.fn>;
    };
  }

  it('routes ed25519 calls to the ed25519 backend', async () => {
    const ed = fakeBackend();
    const sec = fakeBackend();
    const b = composeFrostBackend({ ed25519: ed, secp256k1: sec });
    const out = await b.commit({ share: ZERO, scheme: 'ed25519' });
    expect(Array.from(out)).toEqual([0xc0]);
    expect(ed.commit).toHaveBeenCalledTimes(1);
    expect(sec.commit).not.toHaveBeenCalled();
  });

  it('routes secp256k1 calls to the secp256k1 backend', async () => {
    const ed = fakeBackend();
    const sec = fakeBackend();
    const b = composeFrostBackend({ ed25519: ed, secp256k1: sec });
    await b.respond({
      share: ZERO,
      scheme: 'secp256k1',
      preimage: ZERO,
      groupCommitment: ZERO,
      signerSet: [],
      lambda: ZERO,
    });
    expect(sec.respond).toHaveBeenCalledTimes(1);
    expect(ed.respond).not.toHaveBeenCalled();
  });

  it('throws FrostBackendUnavailable when target scheme missing', async () => {
    const ed = fakeBackend();
    const b = composeFrostBackend({ ed25519: ed }); // no secp256k1
    await expect(
      b.commit({ share: ZERO, scheme: 'secp256k1' }),
    ).rejects.toBeInstanceOf(FrostBackendUnavailable);
  });
});
