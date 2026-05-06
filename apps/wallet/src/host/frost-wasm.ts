/**
 * FROST WASM host binding — fills the kernel's `FrostBackend` seam.
 *
 * The kernel ships `frostBackendUnavailable()` as a typed-throw default
 * because it deliberately doesn't bundle a FROST library (see
 * `packages/wallet-kernel/src/custody/frost/backend.ts` for the rationale —
 * NCC-audited ZF FROST crates compiled to WebAssembly via wasm-bindgen are
 * the chosen substrate). The wallet app is the host that injects a real
 * binding at construction time.
 *
 * Layout:
 *
 *   - `loadFrostWasm()` is the lazy loader. It dynamically imports the two
 *     per-curve WASM bundles (`frost-ed25519`, `frost-secp256k1`) so SSR /
 *     browser-bundle paths that never sign don't pull the WASM in.
 *
 *   - `wasmFrostBackend()` wraps each loaded module in the `FrostBackend`
 *     port shape and joins them via the kernel's `composeFrostBackend()`.
 *
 *   - `loadStubFrostWasm()` is the development-time placeholder. It
 *     returns objects that *implement* the WASM shape so the rest of the
 *     wiring typechecks and the onboarding UI can run end-to-end without
 *     the WASM artifacts on disk; calling them throws so a missed
 *     production binding fails loudly.
 *
 * When the actual WASM binaries land, the only change here is swapping the
 * `loadStubFrostWasm()` import for the real `import('@tenzro/frost-ed25519-wasm')`
 * (and the secp256k1 sibling) — the `wasmFrostBackend()` wrapper stays put.
 *
 * The kernel only sees a `FrostBackend` — it never learns which loader
 * variant produced it.
 */

import { type FrostBackend, composeFrostBackend } from '@tenzro/wallet-kernel';

/**
 * What we need out of each per-curve WASM bundle. Pinned here so the
 * actual wasm-bindgen output (which exposes `default` as the init function
 * plus named exports) and the dev-time stub agree on shape.
 */
export interface FrostWasmModule {
  /**
   * Round 1: device produces a hiding/binding nonce commitment. Input is
   * the unwrapped device share bytes (post passkey unwrap); output is the
   * commitment the kernel forwards to the FROST coordinator.
   */
  commit(share: Uint8Array): Promise<Uint8Array>;
  /**
   * Round 2: device produces its signature share over the preimage given
   * the group commitment + signer set + Lagrange coefficient.
   */
  respond(args: {
    readonly share: Uint8Array;
    readonly preimage: Uint8Array;
    readonly groupCommitment: Uint8Array;
    readonly signerSet: readonly string[];
    readonly lambda: Uint8Array;
  }): Promise<Uint8Array>;
}

/** Both curves bundled together; either can be omitted to fall back to a typed-throw. */
export interface FrostWasmBundle {
  readonly ed25519?: FrostWasmModule;
  readonly secp256k1?: FrostWasmModule;
}

/**
 * Wrap a loaded WASM bundle in the kernel's `FrostBackend` shape. Each
 * round delegates to the per-curve module; absent curves bubble up to
 * `composeFrostBackend()` which throws `FrostBackendUnavailable`.
 *
 * Note that the kernel-side `commit`/`respond` signatures take a `scheme`
 * arg; the dispatch in `composeFrostBackend()` peels that off so the WASM
 * modules don't need to know they're being multiplexed.
 */
export function wasmFrostBackend(bundle: FrostWasmBundle): FrostBackend {
  function asPort(mod: FrostWasmModule | undefined): FrostBackend | undefined {
    if (!mod) return undefined;
    return {
      async commit({ share }) {
        return mod.commit(share);
      },
      async respond({ share, preimage, groupCommitment, signerSet, lambda }) {
        return mod.respond({ share, preimage, groupCommitment, signerSet, lambda });
      },
    };
  }
  const parts: { ed25519?: FrostBackend; secp256k1?: FrostBackend } = {};
  const ed = asPort(bundle.ed25519);
  if (ed) parts.ed25519 = ed;
  const sk = asPort(bundle.secp256k1);
  if (sk) parts.secp256k1 = sk;
  return composeFrostBackend(parts);
}

/**
 * Production loader — swap in real wasm-bindgen modules here. Left as a
 * no-op throw on purpose so an accidental production build that forgets to
 * publish the WASM bundles fails at startup, not mid-signing.
 *
 * Replace the body with something like:
 *
 *   const ed = await import('@tenzro/frost-ed25519-wasm');
 *   await ed.default(); // wasm-bindgen init
 *   const sk = await import('@tenzro/frost-secp256k1-wasm');
 *   await sk.default();
 *   return wasmFrostBackend({
 *     ed25519: { commit: ed.commit, respond: ed.respond },
 *     secp256k1: { commit: sk.commit, respond: sk.respond },
 *   });
 *
 * once the WASM artifacts ship.
 */
export async function loadFrostWasm(): Promise<FrostBackend> {
  throw new Error(
    'loadFrostWasm: real WASM binding not wired yet. Use ' +
      "loadStubFrostWasm() during development, or replace this loader's " +
      'body with the wasm-bindgen import shown in the source comment.',
  );
}

/**
 * Development-time placeholder. Returns a backend whose round operations
 * throw with a clear "stub" message — keeps non-signing flows (onboarding
 * UI walkthroughs, EIP-6963 dispatch tests) workable without the WASM
 * artifacts on disk.
 *
 * Tests that exercise FROST wire formats should override this with a fake
 * that returns deterministic bytes.
 */
export function loadStubFrostWasm(): FrostBackend {
  const stubModule: FrostWasmModule = {
    async commit() {
      throw new Error(
        'FROST WASM stub: commit() called but no real binding loaded. ' +
          'Replace loadStubFrostWasm() with loadFrostWasm() once the ' +
          'wasm-bindgen artifacts are bundled.',
      );
    },
    async respond() {
      throw new Error('FROST WASM stub: respond() called but no real binding loaded.');
    },
  };
  return wasmFrostBackend({ ed25519: stubModule, secp256k1: stubModule });
}
