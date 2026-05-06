/**
 * In-memory 2-of-3 MPC stub. Stand-in for the real Shamir/threshold
 * implementation that lands in M2 alongside the Tenzro Cortex TEE driver.
 *
 * Returns deterministic mock signatures so tests can assert behavior without
 * pulling in real crypto in M1.
 */

import type { SigningDriver, SigningRequest, SigningResult } from '../types/signing-driver.ts';

export interface InternalMpcOptions {
  /** Fail every signing call; used in tests. */
  readonly failAll?: boolean;
}

export function internalMpcDriver(opts: InternalMpcOptions = {}): SigningDriver {
  return {
    id: 'internal-mpc',
    async sign(req: SigningRequest): Promise<SigningResult> {
      if (opts.failAll) throw new Error('signing rejected by policy');
      const sigCount = req.scheme === 'ed25519+ml-dsa-65' ? 2 : 1;
      const signatures: Uint8Array[] = [];
      for (let i = 0; i < sigCount; i++) {
        signatures.push(deterministic(req.preimage, req.scheme, i));
      }
      return { signatures };
    },
  };
}

function deterministic(preimage: Uint8Array, scheme: string, leg: number): Uint8Array {
  // secp256k1 sigs are 65 bytes on the wire (r||s||v). Ed25519 sigs are 64.
  // ML-DSA-65 sigs are 3293 bytes. The mock matches these shapes so the
  // surface modules can do real wire-format serialization in tests.
  const len = scheme === 'ed25519+ml-dsa-65' && leg === 1 ? 3293 : scheme === 'secp256k1' ? 65 : 64;
  const out = new Uint8Array(len);
  const tag = new TextEncoder().encode(`${scheme}:${leg}:`);
  for (let i = 0; i < len; i++) {
    out[i] =
      ((preimage[i % preimage.length] ?? 0) ^ (tag[i % tag.length] ?? 0) ^ ((i + leg) * 17)) & 0xff;
  }
  // Force a valid yParity (0 or 1) on the trailing v byte for secp256k1, so
  // the EVM surface's `splitSignature` accepts it.
  if (scheme === 'secp256k1') out[64] = leg & 0x01;
  return out;
}
