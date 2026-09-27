/**
 * Popup transport: use a Tenzro wallet from any site.
 *
 * Passkeys belong to one domain (`tenzro.com`). A site on another domain cannot
 * ask for them directly, so it opens the hosted wallet in a window, sends the
 * request there, and the person approves it with their passkey on the wallet's
 * own origin. The result comes back by `postMessage`.
 *
 * Both sides check origins exactly: the site accepts messages only from the
 * wallet's origin and the window it opened; the wallet replies only to the
 * site's origin as the browser reports it.
 */

import type { EIP1193Provider } from 'tenzro-sdk';

import type { OwnershipProof } from '../custody/passkey/custody.ts';

export const POPUP_PROTOCOL = 'tenzro-wallet/popup/v1';
export const DEFAULT_WALLET_URL = 'https://wallet.tenzro.com';

/** Methods the wallet window serves. */
export type PopupMethod =
  | 'tenzro_connect'
  | 'tenzro_sendTransaction'
  | 'tenzro_addWallet'
  | 'tenzro_disconnect';

export interface PopupRequest {
  readonly protocol: typeof POPUP_PROTOCOL;
  readonly type: 'request';
  readonly id: string;
  readonly method: PopupMethod;
  readonly params?: unknown;
}

export interface PopupResponse {
  readonly protocol: typeof POPUP_PROTOCOL;
  readonly type: 'response';
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export interface PopupReady {
  readonly protocol: typeof POPUP_PROTOCOL;
  readonly type: 'ready';
}

/**
 * Params of `tenzro_connect`. Pass a one-time `challenge` (hex, 16 to 64 bytes)
 * to receive an ownership proof: the site's server then verifies it with the
 * credential's P-256 key from the account record on the node.
 */
export interface PopupConnectParams {
  readonly challenge?: string;
}

/** Result of `tenzro_connect`. */
export interface PopupConnection {
  readonly account: string;
  readonly did: string;
  readonly proof?: OwnershipProof;
}

/** Params of `tenzro_addWallet`: which further wallet (1 or more) to create under the identity. */
export interface PopupAddWallet {
  readonly salt: number;
}

/** Result of `tenzro_addWallet`. */
export interface PopupAddedWallet {
  readonly account: string;
  readonly did: string;
  readonly salt: number;
}

/** Params of `tenzro_sendTransaction`: a TNZO transfer, value in base units (decimal string). */
export interface PopupSendTransaction {
  readonly to: string;
  readonly value: string;
}

export const POPUP_METHODS: readonly PopupMethod[] = [
  'tenzro_connect',
  'tenzro_sendTransaction',
  'tenzro_addWallet',
  'tenzro_disconnect',
];

/** Error codes, following EIP-1193. */
export const POPUP_ERRORS = {
  rejected: 4001,
  unauthorized: 4100,
  unsupported: 4200,
  internal: -32603,
} as const;

export class PopupProviderError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'PopupProviderError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isPopupRequest(v: unknown): v is PopupRequest {
  return (
    isRecord(v) &&
    v.protocol === POPUP_PROTOCOL &&
    v.type === 'request' &&
    typeof v.id === 'string' &&
    POPUP_METHODS.includes(v.method as PopupMethod)
  );
}

export function isPopupResponse(v: unknown): v is PopupResponse {
  return (
    isRecord(v) &&
    v.protocol === POPUP_PROTOCOL &&
    v.type === 'response' &&
    typeof v.id === 'string'
  );
}

export function isPopupReady(v: unknown): v is PopupReady {
  return isRecord(v) && v.protocol === POPUP_PROTOCOL && v.type === 'ready';
}

/**
 * Whether this page can use passkeys for `rpId` directly (it is on that domain
 * or a subdomain). Sites listed as related origins can too, but a page cannot
 * know that without fetching the list, so they may pass `direct: true`.
 */
export function canUsePasskeysDirectly(rpId: string, hostname: string): boolean {
  return hostname === rpId || hostname.endsWith(`.${rpId}`);
}

/** The parts of `window` the provider uses; injectable for tests. */
export interface PopupHost {
  open(url: string, target: string, features: string): PopupWindow | null;
  addEventListener(
    type: 'message',
    listener: (e: { data: unknown; origin: string; source: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (e: { data: unknown; origin: string; source: unknown }) => void,
  ): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PopupWindow {
  postMessage(message: unknown, targetOrigin: string): void;
  close(): void;
  readonly closed: boolean;
}

export interface PopupProviderOptions {
  /** The hosted wallet. Default `https://wallet.tenzro.com`. */
  readonly walletUrl?: string;
  /** How long a request may wait for the person. Default 5 minutes. */
  readonly timeoutMs?: number;
  readonly host?: PopupHost;
}

let counter = 0;
function requestId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

/**
 * An EIP-1193 provider backed by the hosted wallet. Call `request` from a click
 * handler: browsers only let a user gesture open a window.
 */
export function createPopupProvider(opts: PopupProviderOptions = {}): EIP1193Provider {
  const walletUrl = new URL(opts.walletUrl ?? DEFAULT_WALLET_URL);
  const walletOrigin = walletUrl.origin;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  return {
    request<T = unknown>(args: {
      method: string;
      params?: readonly unknown[] | Record<string, unknown>;
    }): Promise<T> {
      const host = opts.host ?? (globalThis as unknown as { window: PopupHost }).window;
      if (!POPUP_METHODS.includes(args.method as PopupMethod)) {
        return Promise.reject(
          new PopupProviderError(
            POPUP_ERRORS.unsupported,
            `${args.method} is not supported by the wallet window.`,
          ),
        );
      }
      const approveUrl = new URL('/approve', walletUrl).toString();
      const popup = host.open(approveUrl, 'tenzro-wallet', 'popup,width=420,height=680');
      if (!popup) {
        return Promise.reject(
          new PopupProviderError(
            POPUP_ERRORS.internal,
            'The browser blocked the wallet window. Call this from a click.',
          ),
        );
      }
      const id = requestId();
      const request: PopupRequest = {
        protocol: POPUP_PROTOCOL,
        type: 'request',
        id,
        method: args.method as PopupMethod,
        ...(args.params !== undefined ? { params: args.params } : {}),
      };

      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          host.removeEventListener('message', onMessage);
          host.clearInterval(poll);
          host.clearTimeout(timer);
          fn();
        };
        const onMessage = (e: { data: unknown; origin: string; source: unknown }) => {
          if (e.origin !== walletOrigin || e.source !== popup) return;
          if (isPopupReady(e.data)) {
            popup.postMessage(request, walletOrigin);
            return;
          }
          if (isPopupResponse(e.data) && e.data.id === id) {
            const res = e.data;
            finish(() => {
              popup.close();
              if (res.error) reject(new PopupProviderError(res.error.code, res.error.message));
              else resolve(res.result as T);
            });
          }
        };
        host.addEventListener('message', onMessage);
        const poll = host.setInterval(() => {
          if (popup.closed)
            finish(() =>
              reject(
                new PopupProviderError(POPUP_ERRORS.rejected, 'The wallet window was closed.'),
              ),
            );
        }, 500);
        const timer = host.setTimeout(() => {
          finish(() => {
            popup.close();
            reject(new PopupProviderError(POPUP_ERRORS.rejected, 'The request timed out.'));
          });
        }, timeoutMs);
      });
    },
  };
}
