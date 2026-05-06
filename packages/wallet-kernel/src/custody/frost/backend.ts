/**
 * FrostBackend — device-side FROST round computation.
 *
 * The wallet kernel does not bundle a FROST library. The choice (per
 * 2026 audit landscape — NCC Group's October 2023 review of the
 * Zcash Foundation `frost` crates is the only completed audit of a
 * pure-Rust FROST implementation that covers both Ed25519 (RFC 9591)
 * and secp256k1) is to wrap the ZF crates as WebAssembly via
 * `wasm-bindgen` and inject the resulting binding through the
 * `FrostBackend` port at host-app construction time. The kernel only
 * needs the port surface defined alongside the unwrapper:
 *
 *   ```ts
 *   import type { FrostBackend } from '../passkey-share/unwrapper.ts';
 *   ```
 *
 * Two reference backends ship in this file:
 *
 *   - `frostBackendUnavailable()` — a typed-throw stub. Used until the
 *     host app links a real binding. Throwing here (instead of letting
 *     the FROST drivers fail mid-round with "undefined is not callable")
 *     keeps the failure mode legible.
 *
 *   - `composeFrostBackend(...)` — small dispatch helper for hosts that
 *     ship two distinct WASM bundles per scheme. The Ed25519 bundle and
 *     secp256k1 bundle are independent crates upstream
 *     (`frost-ed25519`, `frost-secp256k1`), so most hosts will load them
 *     separately and join them at this seam.
 *
 * Browser-clean: no Node-specific globals, no DOM dependencies. The
 * eventual WASM binding sits behind dynamic `import()` so SSR / Node
 * tests that don't exercise FROST never touch the WASM module.
 */

import type { FrostBackend, ShareUnwrapRequest } from '../passkey-share/unwrapper.ts';
import type { FrostScheme } from './coordinator.ts';

export class FrostBackendUnavailable extends Error {
  constructor(readonly scheme: FrostScheme | undefined) {
    super(
      `FROST backend not configured${scheme ? ` for ${scheme}` : ''}: ` +
        'host app must inject a real FrostBackend (e.g. WASM-wrapped ' +
        'frost-ed25519 / frost-secp256k1) before signing.',
    );
    this.name = 'FrostBackendUnavailable';
  }
}

/**
 * Default backend that fails loudly. Wire a real FROST library in via
 * `composeFrostBackend()` (or your own implementation) before any
 * signing flow runs.
 */
export function frostBackendUnavailable(): FrostBackend {
  return {
    async commit({ scheme }: { share: Uint8Array; scheme: FrostScheme }) {
      throw new FrostBackendUnavailable(scheme);
    },
    async respond({
      scheme,
    }: {
      share: Uint8Array;
      scheme: FrostScheme;
      preimage: Uint8Array;
      groupCommitment: Uint8Array;
      signerSet: readonly string[];
      lambda: Uint8Array;
    }) {
      throw new FrostBackendUnavailable(scheme);
    },
  };
}

/**
 * Compose per-scheme backends into a single `FrostBackend`. Lets hosts
 * load WASM bundles lazily (e.g. dynamic `import()` per curve) and join
 * them here without the kernel learning about loaders.
 *
 * Either backend may be omitted; calls into a missing scheme throw
 * `FrostBackendUnavailable`.
 */
export function composeFrostBackend(parts: {
  readonly ed25519?: FrostBackend;
  readonly secp256k1?: FrostBackend;
}): FrostBackend {
  function pick(scheme: FrostScheme): FrostBackend {
    const got = scheme === 'ed25519' ? parts.ed25519 : parts.secp256k1;
    if (!got) throw new FrostBackendUnavailable(scheme);
    return got;
  }
  return {
    async commit(args) {
      return pick(args.scheme).commit(args);
    },
    async respond(args) {
      return pick(args.scheme).respond(args);
    },
  };
}

// `ShareUnwrapRequest` re-exported so host wiring can import the full
// FROST surface from one module instead of reaching into passkey-share.
export type { FrostBackend, ShareUnwrapRequest };
