/**
 * Dual-mode Canton provider resolution.
 *
 * The wallet talks to a Canton participant in one of two ways, and BOTH flow
 * through the same self-custody `CantonValidatorPort` / `LedgerApiAdapter` — the
 * wallet ALWAYS signs locally via the Interactive Submission Service. The mode
 * only changes (a) which base URLs the adapter points at and (b) how each
 * request authenticates. It never moves signing off the wallet.
 *
 *   1. **BYO Canton node** (self-hosted participant). The operator runs their
 *      own Canton participant + Splice validator-app. The wallet holds the
 *      party key and signs locally; auth is the operator's own Canton JWT sent
 *      as `Authorization: Bearer <jwt>`, OR the BYO-issuer escape hatch
 *      `X-Canton-Auth: Bearer <jwt>` when the operator's issuer differs from
 *      the participant's default identity provider.
 *
 *   2. **Tenzro Network-provided Canton**. The wallet points at a Tenzro node's
 *      Canton surface; auth is a `tnz_...` API key in `X-Tenzro-Api-Key`. The
 *      Tenzro node resolves the key to a tenant, server-mints the tenant's
 *      Canton JWT, and forwards the request to its Canton participant. The
 *      wallet never sees the Canton JWT — its only credential is the API key.
 *
 * This module produces a `LedgerApiAdapterConfig` for either mode; the kernel
 * passes that to `new LedgerApiAdapter(cfg)` and threads the port into the
 * canton-internal / canton-external surfaces unchanged.
 */

import type { LedgerApiAdapterConfig } from './adapters/ledger-api-adapter.ts';

/** BYO Canton node: self-hosted participant, wallet-held auth. */
export interface ByoCantonProviderConfig {
  readonly mode: 'byo-node';
  /** JSON Ledger API base URL, e.g. `https://canton.acme.example:7575`. */
  readonly ledgerBaseUrl: string;
  /** Splice validator-app base URL, e.g. `https://canton.acme.example:5003`. */
  readonly validatorBaseUrl: string;
  /** Canton user id for prepare/execute + completion filters. */
  readonly userId: string;
  /** Canton JWT getter. Cache/refresh inside the closure as needed. */
  readonly token: () => Promise<string>;
  /**
   * When true, send the JWT as `X-Canton-Auth: Bearer <jwt>` instead of the
   * standard `Authorization` header — the BYO-issuer escape hatch for an
   * operator whose token issuer differs from the participant's default IDP.
   */
  readonly useCantonAuthHeader?: boolean;
  readonly fetch?: typeof fetch;
}

/** Tenzro Network-provided Canton: node-mediated, API-key auth. */
export interface TenzroCantonProviderConfig {
  readonly mode: 'tenzro-network';
  /**
   * Base URL of the Tenzro node's Canton surface. The node exposes the same
   * JSON Ledger API shape under this origin and resolves the API key to a
   * tenant before forwarding. Both ledger + validator calls go here — the
   * node fronts both, so one base URL drives both seams.
   */
  readonly baseUrl: string;
  /** Canton user id for prepare/execute + completion filters. */
  readonly userId: string;
  /**
   * `tnz_...` API key getter. The node server-mints the tenant's Canton JWT
   * from this; the wallet never holds the Canton JWT. Cache/refresh inside the
   * closure as needed.
   */
  readonly apiKey: () => Promise<string>;
  readonly fetch?: typeof fetch;
}

export type CantonProviderConfig = ByoCantonProviderConfig | TenzroCantonProviderConfig;

/**
 * Resolve a `CantonProviderConfig` to the `LedgerApiAdapterConfig` the kernel
 * feeds to `new LedgerApiAdapter(...)`. The only per-mode differences are the
 * base URLs and the auth-header builder; everything downstream (prepare/sign/
 * execute, content verification, completion tailing) is mode-agnostic.
 */
export function resolveCantonAdapterConfig(
  provider: CantonProviderConfig,
): LedgerApiAdapterConfig {
  if (provider.mode === 'tenzro-network') {
    const base: LedgerApiAdapterConfig = {
      ledgerBaseUrl: provider.baseUrl,
      validatorBaseUrl: provider.baseUrl,
      userId: provider.userId,
      // `token` is unused when `authHeaders` is set, but the interface requires
      // it. Throw if anything ever falls through to it — that'd be a bug.
      token: () =>
        Promise.reject(
          new Error(
            'tenzro-network canton: token() must not be called — auth is the API key',
          ),
        ),
      authHeaders: async () => ({ 'x-tenzro-api-key': await provider.apiKey() }),
      ...(provider.fetch !== undefined ? { fetch: provider.fetch } : {}),
    };
    return base;
  }

  // BYO node.
  const base: LedgerApiAdapterConfig = {
    ledgerBaseUrl: provider.ledgerBaseUrl,
    validatorBaseUrl: provider.validatorBaseUrl,
    userId: provider.userId,
    token: provider.token,
    ...(provider.useCantonAuthHeader
      ? {
          authHeaders: async () => ({
            'x-canton-auth': `Bearer ${await provider.token()}`,
          }),
        }
      : {}),
    ...(provider.fetch !== undefined ? { fetch: provider.fetch } : {}),
  };
  return base;
}
