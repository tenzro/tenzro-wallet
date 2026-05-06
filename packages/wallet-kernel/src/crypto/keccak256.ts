/**
 * keccak256 — the original Keccak-f[1600] permutation, NIST padding *not*
 * applied (this is the pre-FIPS-202 variant Ethereum uses, distinct from the
 * official SHA3-256). Accepts a Uint8Array, returns a 32-byte digest.
 *
 * Pure JS implementation, no dependency on Node `crypto` or WebCrypto. Hot
 * path is the round function; we keep it on plain `Uint32Array` lanes so the
 * code is readable and the JIT can box it into typed-array ops.
 *
 * Why we ship our own:
 *   - WebCrypto's `digest('SHA3-256', …)` is *not* keccak-256 — different
 *     padding byte (0x06 vs 0x01).
 *   - The kernel package has no `@types/node` and ships to browsers, so
 *     `crypto.createHash('keccak256')` isn't on the table either.
 *
 * Cross-checked against the canonical test vectors in
 * https://keccak.team/files/Keccak-reference-3.0.pdf appendix A.
 */

// Round constants for Keccak-f[1600], as 64-bit ints split into [hi, lo]
// 32-bit halves so we can run the bitwise ops on Uint32Array.
const RC: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00000001],
  [0x00000000, 0x00008082],
  [0x80000000, 0x0000808a],
  [0x80000000, 0x80008000],
  [0x00000000, 0x0000808b],
  [0x00000000, 0x80000001],
  [0x80000000, 0x80008081],
  [0x80000000, 0x00008009],
  [0x00000000, 0x0000008a],
  [0x00000000, 0x00000088],
  [0x00000000, 0x80008009],
  [0x00000000, 0x8000000a],
  [0x00000000, 0x8000808b],
  [0x80000000, 0x0000008b],
  [0x80000000, 0x00008089],
  [0x80000000, 0x00008003],
  [0x80000000, 0x00008002],
  [0x80000000, 0x00000080],
  [0x00000000, 0x0000800a],
  [0x80000000, 0x8000000a],
  [0x80000000, 0x80008081],
  [0x80000000, 0x00008080],
  [0x00000000, 0x80000001],
  [0x80000000, 0x80008008],
];

// Rotation offsets for ρ.
// prettier-ignore
const RHO: readonly number[] = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

// Lane permutation for π: PI[x*5 + y] = src lane index.
// prettier-ignore
const PI: readonly number[] = [
  0, 6, 12, 18, 24, 3, 9, 10, 16, 22, 1, 7, 13, 19, 20, 4, 5, 11, 17, 23, 2, 8, 14, 15, 21,
];

const RATE = 136; // bytes (1088 bits) for keccak-256
const OUTPUT = 32;

export function keccak256(input: Uint8Array): Uint8Array {
  // 25 lanes × 64 bits → 50 × Uint32 (lane n stored as [hi=2n+1, lo=2n]).
  const state = new Uint32Array(50);

  // Absorb full RATE-byte blocks.
  let off = 0;
  while (off + RATE <= input.length) {
    xorBlock(state, input, off);
    permute(state);
    off += RATE;
  }

  // Pad final block: 0x01 (keccak), then zeros, then 0x80 high bit.
  const tail = new Uint8Array(RATE);
  tail.set(input.subarray(off));
  tail[input.length - off] = 0x01;
  tail[RATE - 1] = (tail[RATE - 1] ?? 0) | 0x80;
  xorBlock(state, tail, 0);
  permute(state);

  // Squeeze 32 bytes from the rate.
  const out = new Uint8Array(OUTPUT);
  for (let i = 0; i < OUTPUT; i++) {
    const laneIdx = (i / 8) | 0;
    const byteInLane = i % 8;
    const word = byteInLane < 4 ? state[laneIdx * 2]! : state[laneIdx * 2 + 1]!;
    out[i] = (word >>> ((byteInLane % 4) * 8)) & 0xff;
  }
  return out;
}

function xorBlock(state: Uint32Array, input: Uint8Array, off: number): void {
  for (let i = 0; i < RATE; i += 8) {
    const lane = i >> 3;
    const lo =
      input[off + i]! |
      (input[off + i + 1]! << 8) |
      (input[off + i + 2]! << 16) |
      (input[off + i + 3]! << 24);
    const hi =
      input[off + i + 4]! |
      (input[off + i + 5]! << 8) |
      (input[off + i + 6]! << 16) |
      (input[off + i + 7]! << 24);
    state[lane * 2] = state[lane * 2]! ^ (lo >>> 0);
    state[lane * 2 + 1] = state[lane * 2 + 1]! ^ (hi >>> 0);
  }
}

function permute(s: Uint32Array): void {
  for (let r = 0; r < 24; r++) {
    // θ
    const cLo = new Uint32Array(5);
    const cHi = new Uint32Array(5);
    for (let x = 0; x < 5; x++) {
      cLo[x] = s[x * 2]! ^ s[(x + 5) * 2]! ^ s[(x + 10) * 2]! ^ s[(x + 15) * 2]! ^ s[(x + 20) * 2]!;
      cHi[x] =
        s[x * 2 + 1]! ^
        s[(x + 5) * 2 + 1]! ^
        s[(x + 10) * 2 + 1]! ^
        s[(x + 15) * 2 + 1]! ^
        s[(x + 20) * 2 + 1]!;
    }
    for (let x = 0; x < 5; x++) {
      const dLo = cLo[(x + 4) % 5]! ^ rotl32(cLo[(x + 1) % 5]!, cHi[(x + 1) % 5]!, 1).lo;
      const dHi = cHi[(x + 4) % 5]! ^ rotl32(cLo[(x + 1) % 5]!, cHi[(x + 1) % 5]!, 1).hi;
      for (let y = 0; y < 5; y++) {
        s[(x + y * 5) * 2] = (s[(x + y * 5) * 2]! ^ dLo) >>> 0;
        s[(x + y * 5) * 2 + 1] = (s[(x + y * 5) * 2 + 1]! ^ dHi) >>> 0;
      }
    }

    // ρ + π
    const bLo = new Uint32Array(25);
    const bHi = new Uint32Array(25);
    for (let i = 0; i < 25; i++) {
      const src = PI[i]!;
      const rot = RHO[src]!;
      const r2 = rotl32(s[src * 2]!, s[src * 2 + 1]!, rot);
      bLo[i] = r2.lo;
      bHi[i] = r2.hi;
    }

    // χ
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const idx = x + y * 5;
        s[idx * 2] =
          (bLo[idx]! ^ (~bLo[((x + 1) % 5) + y * 5]! & bLo[((x + 2) % 5) + y * 5]!)) >>> 0;
        s[idx * 2 + 1] =
          (bHi[idx]! ^ (~bHi[((x + 1) % 5) + y * 5]! & bHi[((x + 2) % 5) + y * 5]!)) >>> 0;
      }
    }

    // ι
    s[0] = (s[0]! ^ RC[r]![1]) >>> 0;
    s[1] = (s[1]! ^ RC[r]![0]) >>> 0;
  }
}

/** 64-bit left-rotation, lanes split into hi/lo 32-bit halves. */
function rotl32(lo: number, hi: number, n: number): { lo: number; hi: number } {
  const m = n % 64;
  if (m === 0) return { lo: lo >>> 0, hi: hi >>> 0 };
  if (m < 32) {
    return {
      lo: ((lo << m) | (hi >>> (32 - m))) >>> 0,
      hi: ((hi << m) | (lo >>> (32 - m))) >>> 0,
    };
  }
  const k = m - 32;
  if (k === 0) return { lo: hi >>> 0, hi: lo >>> 0 };
  return {
    lo: ((hi << k) | (lo >>> (32 - k))) >>> 0,
    hi: ((lo << k) | (hi >>> (32 - k))) >>> 0,
  };
}
