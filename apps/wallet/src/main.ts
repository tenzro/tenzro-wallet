/**
 * Wallet app entry point: wires the kernel's passkey custody, the onboarding
 * UI and the `window.tenzro` provider.
 *
 * Load order:
 *   1. Build a JSON-RPC transport over the network's staked RPC operators
 *      (found from bootstrap hints, each checked against the chain, with
 *      failover) and a WebAuthn authenticator (RP ID configurable, default
 *      "tenzro.com").
 *   2. Mount onboarding: create a wallet from a passkey, or sign in with an
 *      existing passkey on this device or a phone (hybrid / QR).
 *   3. Build the kernel from the resulting account (embedder-specific).
 *   4. Install the EIP-1193 provider on `window.tenzro` and announce it
 *      (EIP-6963).
 *
 * Nothing secret is stored: the passkey lives in the authenticator and is
 * the only signing key.
 */

import {
  BOOTSTRAP_RPC_URLS,
  BrowserPasskeyAuthenticator,
  DEFAULT_RP_ID,
  NETWORK_1_CHAIN_ID,
  NetworkTransport,
  PasskeyCustody,
  type WalletKernel,
  readChainId,
} from 'tenzro-wallet';

import { KernelEip1193Provider, installTenzroProvider } from './dispatch/window-tenzro.ts';
import { mountOnboarding } from './ui/onboarding.ts';

export interface WalletAppOptions {
  /** Endpoints to start from (hints only). Defaults to Tenzro Network 1's. */
  readonly bootstrapRpcUrls?: readonly string[];
  /** The chain every endpoint must answer for. Defaults to Tenzro Network 1. */
  readonly chainId?: number;
  /** WebAuthn relying party id. Must match the node's. Defaults to "tenzro.com". */
  readonly rpId?: string;
  /** Mount point for the onboarding UI. Omit for headless, dispatch-only embeds. */
  readonly onboardingContainer?: HTMLElement;
  /** EIP-6963 announcement. Omit to skip the `window.tenzro` install. */
  readonly providerAnnouncement?: {
    readonly uuid: string;
    /** `data:image/...` URL — required by EIP-6963. */
    readonly icon: string;
  };
}

export async function startWalletApp(opts: WalletAppOptions = {}): Promise<{
  readonly custody: PasskeyCustody;
  readonly mountOnboarding: () => Promise<void>;
  readonly installProvider: (kernel: WalletKernel) => { dispose: () => void };
}> {
  const rpc = new NetworkTransport({
    bootstrap: opts.bootstrapRpcUrls ?? BOOTSTRAP_RPC_URLS,
    chainId: opts.chainId ?? NETWORK_1_CHAIN_ID,
  });
  const custody = new PasskeyCustody({
    rpc,
    authenticator: new BrowserPasskeyAuthenticator({ rpId: opts.rpId ?? DEFAULT_RP_ID }),
  });

  const mount = async () => {
    if (!opts.onboardingContainer) return;
    const handle = mountOnboarding({ container: opts.onboardingContainer, custody });
    await handle.result;
  };

  const install = (kernel: WalletKernel) => {
    if (!opts.providerAnnouncement) return { dispose: () => {} };
    const provider = new KernelEip1193Provider({ kernel, chainId: () => readChainId(rpc) });
    return installTenzroProvider({
      uuid: opts.providerAnnouncement.uuid,
      icon: opts.providerAnnouncement.icon,
      provider,
    });
  };

  return { custody, mountOnboarding: mount, installProvider: install };
}

export {
  KernelEip1193Provider,
  installTenzroProvider,
  buildAnnouncementDetail,
} from './dispatch/window-tenzro.ts';
export {
  mountOnboarding,
  type OnboardingMount,
  type OnboardingResult,
} from './ui/onboarding.ts';
