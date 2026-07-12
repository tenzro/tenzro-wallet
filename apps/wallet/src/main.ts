/**
 * Wallet app entry point — wires the kernel + the three host-side pieces.
 *
 * This is a scaffold. It demonstrates the **load order** for a production
 * wallet app: build the kernel, inject the host-side FROST WASM backend,
 * mount the onboarding UI, and dispatch `window.tenzro` so dApps can
 * discover the wallet via EIP-6963. The actual kernel construction
 * (identity provisioning, surface assembly, balance providers, agent
 * ports) is deliberately skipped here — that's what `walletNew()` /
 * `walletRecover()` produce, and they need a `ProvisioningPort` /
 * `RecoveryPort` that an embedder supplies.
 *
 * Reference docs:
 *   - SDK fromInjected flow:       sdk/tenzro-ts-sdk/README.md
 *   - Reference browser extension: apps/tenzro-extension/README.md
 *
 * The reference extension is the authoritative dispatch surface; this
 * wallet app exists so a self-contained build can demo the same flow
 * without the extension installed (e.g. a hosted web wallet).
 */

import type { ProvisioningPort, RecoveryPort, WalletKernel } from 'tenzro-wallet';
import { type PasskeyEnroller, WebAuthnAuthenticatorAdapter } from 'tenzro-wallet';

import { KernelEip1193Provider, installTenzroProvider } from './dispatch/window-tenzro.ts';
import { loadStubFrostWasm } from './host/frost-wasm.ts';
import { mountOnboarding } from './ui/onboarding.ts';

/**
 * What the embedder must supply. The kernel orchestrators reach the
 * Tenzro RPC node through these ports — the embedder picks the transport
 * (e.g. `fetch` against `https://rpc.tenzro.xyz/wallet/*`).
 *
 * `enroller` wraps `navigator.credentials.create()` and is mode-agnostic.
 * The kernel ships `WebAuthnAuthenticatorAdapter` for the *get* (assertion)
 * path used by the share unwrapper; a sibling enroller for the *create*
 * path is left to the embedder because RP id / origin policy lives there.
 */
export interface WalletAppOptions {
  readonly provisioning: ProvisioningPort;
  readonly recovery: RecoveryPort;
  readonly enroller: PasskeyEnroller;
  /**
   * Mount point for the onboarding UI. If omitted, the UI is not
   * mounted — useful for headless dispatch-only embeds.
   */
  readonly onboardingContainer?: HTMLElement;
  /**
   * UUID for the EIP-6963 announcement. Must be stable across re-announces
   * within a single page load. Omit to skip the `window.tenzro` install.
   */
  readonly providerAnnouncement?: {
    readonly uuid: string;
    /** `data:image/...` URL — required by EIP-6963. */
    readonly icon: string;
  };
}

/**
 * Boot the wallet app. The order matters:
 *
 *   1. Load the FROST WASM backend so any signing flow that fires after
 *      onboarding has a real `FrostBackend` ready. (Stub during
 *      development; swap `loadStubFrostWasm()` for `await loadFrostWasm()`
 *      once the wasm-bindgen artifacts are bundled.)
 *
 *   2. Mount the onboarding UI and wait for the user to choose
 *      enrol/recover. Kernel construction can't proceed without an
 *      identity, and `walletNew` / `walletRecover` are what produce one.
 *
 *   3. Build the kernel from the produced identity + surface modules.
 *      (Surface assembly is embedder-specific and not in this scaffold.)
 *
 *   4. Install the EIP-1193 provider on `window.tenzro` and dispatch the
 *      EIP-6963 announcement. Now any dApp on the page can call
 *      `discoverEip6963Provider()` from `tenzro-sdk` and get a
 *      kernel-backed provider.
 *
 * Returns a handle the embedder can use to introspect / tear down.
 */
export async function startWalletApp(opts: WalletAppOptions): Promise<{
  readonly frostBackend: ReturnType<typeof loadStubFrostWasm>;
  readonly mountOnboarding: () => Promise<void>;
  readonly installProvider: (kernel: WalletKernel) => { dispose: () => void };
}> {
  // 1. FROST host-side seam. Stub today; real WASM tomorrow.
  const frostBackend = loadStubFrostWasm();

  // 2. Onboarding mount, returned as a function so embedders can decide
  //    when to show it (e.g. only if no existing kernel is cached).
  const mount = async () => {
    if (!opts.onboardingContainer) return;
    const handle = mountOnboarding({
      container: opts.onboardingContainer,
      deps: {
        provisioning: opts.provisioning,
        recovery: opts.recovery,
        enroller: opts.enroller,
      },
    });
    await handle.result;
  };

  // 4. Provider install factory — the embedder calls this once they have
  //    a fully-constructed kernel from step 3.
  const install = (kernel: WalletKernel) => {
    if (!opts.providerAnnouncement) return { dispose: () => {} };
    const provider = new KernelEip1193Provider({ kernel });
    return installTenzroProvider({
      uuid: opts.providerAnnouncement.uuid,
      icon: opts.providerAnnouncement.icon,
      provider,
    });
  };

  return {
    frostBackend,
    mountOnboarding: mount,
    installProvider: install,
  };
}

/**
 * Convenience: construct a `WebAuthnAuthenticatorAdapter` against the
 * default `navigator.credentials` — the kernel's PRF-primary unwrapper
 * uses this. The wallet app holds a single instance and shares it with
 * the (embedder-supplied) `PasskeyEnroller` so both paths agree on RP id
 * / origin behaviour.
 *
 * `rpId` must match the WebAuthn RP id pinned at enrol time — usually the
 * wallet's apex domain (e.g. `'wallet.tenzro.xyz'`).
 */
export function defaultPasskeyAuthenticator(args: {
  readonly rpId: string;
}): WebAuthnAuthenticatorAdapter {
  return new WebAuthnAuthenticatorAdapter({ rpId: args.rpId });
}

// Re-export the scaffolded surfaces so embedders can import them from one
// place rather than reaching into per-module paths.
export {
  loadFrostWasm,
  loadStubFrostWasm,
  wasmFrostBackend,
  type FrostWasmBundle,
  type FrostWasmModule,
} from './host/frost-wasm.ts';
export {
  KernelEip1193Provider,
  installTenzroProvider,
  buildAnnouncementDetail,
} from './dispatch/window-tenzro.ts';
export {
  mountOnboarding,
  type OnboardingDeps,
  type OnboardingMount,
  type OnboardingResult,
} from './ui/onboarding.ts';
