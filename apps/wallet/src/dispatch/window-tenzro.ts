/**
 * `window.tenzro` dispatch — kernel-as-extension-host wiring.
 *
 * The kernel ships the announce-side helper (`buildEip6963Announcement`,
 * the canonical event names) and re-exports the SDK's consume-side helpers
 * for symmetry. What's missing for an actual dApp page is the *bridge*
 * between an EIP-1193 `provider.request({method, params})` and the
 * kernel's intent → prepare → sign → submit pipeline. That bridge is
 * intentionally not in the kernel: the kernel is browser-clean and DOM-
 * free, and dispatch is the host's job.
 *
 * This module ships a scaffolded bridge: a `KernelEip1193Provider` that
 * answers the small set of methods a dApp actually needs from a wallet,
 * and an `installTenzroProvider()` helper that puts it on `window.tenzro`
 * and dispatches the EIP-6963 announcement.
 *
 * Most methods are scaffolded — they return a typed "not yet wired"
 * response so the dispatch path is exercisable end-to-end (the
 * announcement fires; the SDK's `discoverEip6963Provider()` resolves; the
 * dApp gets a provider object) before the production routing decisions
 * (DPoP-bound JWT minting, user-confirmation popups, CAIP-25 sessions)
 * are wired. The reference extension at `apps/tenzro-extension/` is the
 * authoritative implementation; this scaffold lives in the wallet app so
 * a self-contained build can demo the announce/consume handshake without
 * the extension installed.
 */

import {
  type EIP1193Provider,
  type EIP6963ProviderDetail,
  EIP6963_ANNOUNCE_EVENT,
  EIP6963_REQUEST_EVENT,
  type Eip6963ProviderInfo,
  TENZRO_PROVIDER_RDNS,
  type WalletKernel,
  buildEip6963Announcement,
} from 'tenzro-wallet';

/**
 * Minimal RPC method registry. The dApp side calls
 * `provider.request({method, params})` — this maps each known method to a
 * kernel-backed handler. Unknown methods get a JSON-RPC -32601.
 */
type RpcHandler = (params: unknown) => Promise<unknown>;

export interface KernelEip1193ProviderOptions {
  readonly kernel: WalletKernel;
  /**
   * Optional override for the dispatch table. Use this from the reference
   * extension to override scaffolded methods with production-grade ones
   * without touching the announcement plumbing.
   */
  readonly methods?: Readonly<Record<string, RpcHandler>>;
}

/**
 * EIP-1193 provider that routes `request()` through the kernel.
 *
 * Implements the EIP-1193 surface narrowly — `request()` only. Event
 * emission (`accountsChanged`, `chainChanged`) is left as a follow-up
 * because the kernel doesn't yet expose account/chain change observables;
 * the reference extension adds them.
 */
export class KernelEip1193Provider implements EIP1193Provider {
  readonly #kernel: WalletKernel;
  readonly #methods: Map<string, RpcHandler>;

  constructor(opts: KernelEip1193ProviderOptions) {
    this.#kernel = opts.kernel;
    this.#methods = new Map(Object.entries(this.#defaultMethods()));
    if (opts.methods) {
      for (const [method, handler] of Object.entries(opts.methods)) {
        this.#methods.set(method, handler);
      }
    }
  }

  async request<T = unknown>(args: {
    method: string;
    params?: readonly unknown[] | Record<string, unknown>;
  }): Promise<T> {
    const handler = this.#methods.get(args.method);
    if (!handler) {
      throw rpcError(-32601, `Method not found: ${args.method}`);
    }
    return handler(args.params ?? []) as Promise<T>;
  }

  /**
   * Default scaffolded dispatch table. Returns the wallet's TDIP DID for
   * the always-cheap identity reads, and a typed "not yet wired" error
   * for everything that requires the M5/M6 DPoP-session machinery.
   *
   * The reference extension overrides each "not yet wired" entry with the
   * real router → prepare → sign → submit call.
   */
  #defaultMethods(): Record<string, RpcHandler> {
    const kernel = this.#kernel;
    return {
      // EIP-1193 housekeeping — safe to answer from kernel state alone.
      eth_chainId: async () => '0x0',
      eth_accounts: async () => [],
      net_version: async () => '0',

      // Identity — the kernel already knows this.
      tenzro_did: async () => kernel.identity.did,

      // Balance aggregation — read-only and already plumbed.
      tenzro_balances: async () => kernel.balances(),

      // Anything that needs a signing path is scaffolded.
      eth_sendTransaction: async () => {
        throw rpcError(
          -32601,
          'eth_sendTransaction: kernel scaffold — wire through the reference ' +
            'extension at apps/tenzro-extension/ for production dispatch.',
        );
      },
      personal_sign: async () => {
        throw rpcError(
          -32601,
          'personal_sign: kernel scaffold — wire through the reference extension.',
        );
      },
      tenzro_prepareIntent: async () => {
        throw rpcError(
          -32601,
          'tenzro_prepareIntent: kernel scaffold — wire through the reference extension.',
        );
      },
    };
  }
}

/**
 * Build the EIP-6963 announcement detail (`{ info, provider }`) that goes
 * inside the `eip6963:announceProvider` event. Pure, DOM-free.
 *
 * `uuid` must be stable across announcements within a single page load
 * (per spec). `icon` must be a `data:` URL — the kernel builder rejects
 * `https://` icons because the spec requires inline assets so dApps don't
 * leak fingerprintable network requests on enumeration.
 */
export function buildAnnouncementDetail(args: {
  readonly uuid: string;
  readonly icon: string;
  readonly name?: string;
  readonly rdns?: string;
  readonly provider: EIP1193Provider;
}): EIP6963ProviderDetail {
  const info: Eip6963ProviderInfo = buildEip6963Announcement({
    uuid: args.uuid,
    icon: args.icon,
    ...(args.name === undefined ? {} : { name: args.name }),
    ...(args.rdns === undefined ? {} : { rdns: args.rdns }),
  });
  return { info, provider: args.provider };
}

/**
 * Install a Tenzro EIP-1193 provider on `window.tenzro` and dispatch the
 * EIP-6963 announcement. Returns a `dispose()` to unwire the listener and
 * remove the global — useful for tests and HMR.
 *
 * Re-announces on every `eip6963:requestProvider` per spec (dApps that load
 * after the wallet must still discover it).
 *
 * Ignores SSR — if there's no `window`, the call is a no-op so the same
 * code path can run in tests / Node bundlers.
 */
export function installTenzroProvider(args: {
  readonly uuid: string;
  readonly icon: string;
  readonly name?: string;
  /** Defaults to the SDK's `TENZRO_PROVIDER_RDNS` so consume side aligns. */
  readonly rdns?: string;
  readonly provider: EIP1193Provider;
}): { readonly dispose: () => void } {
  if (typeof window === 'undefined') {
    return { dispose: () => {} };
  }
  const detail = buildAnnouncementDetail({
    uuid: args.uuid,
    icon: args.icon,
    ...(args.name === undefined ? {} : { name: args.name }),
    rdns: args.rdns ?? TENZRO_PROVIDER_RDNS,
    provider: args.provider,
  });

  // Keep a typed reference to `window.tenzro` so callers can grab the
  // provider directly (e.g. legacy non-EIP-6963 dApps).
  (window as unknown as { tenzro?: EIP1193Provider }).tenzro = args.provider;

  const announce = () => {
    window.dispatchEvent(new CustomEvent(EIP6963_ANNOUNCE_EVENT, { detail }));
  };
  const onRequest = () => {
    announce();
  };

  window.addEventListener(EIP6963_REQUEST_EVENT, onRequest);
  // Spec: announce immediately on install (so dApps already in the page
  // pick us up) and again on every request (so dApps loaded later do).
  announce();

  return {
    dispose: () => {
      window.removeEventListener(EIP6963_REQUEST_EVENT, onRequest);
      const w = window as unknown as { tenzro?: EIP1193Provider };
      // biome-ignore lint/performance/noDelete: removing the property cleanly is intentional; assignment to `undefined` violates exactOptionalPropertyTypes.
      if (w.tenzro === args.provider) delete w.tenzro;
    },
  };
}

function rpcError(code: number, message: string): Error & { code: number } {
  const err = new Error(message) as Error & { code: number };
  err.code = code;
  return err;
}
