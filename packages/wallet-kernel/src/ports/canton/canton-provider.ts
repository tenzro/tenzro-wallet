/**
 * Canton participant resolution.
 *
 * The wallet talks to a Canton participant the operator runs (a participant
 * plus a Splice validator-app) through the self-custody
 * `CantonValidatorPort` / `LedgerApiAdapter`: the wallet holds the party key
 * and always signs locally via the Interactive Submission Service. The
 * participant authenticates the operator's own Canton JWT, sent as
 * `Authorization: Bearer <jwt>`, or as `X-Canton-Auth: Bearer <jwt>` when the
 * operator's issuer differs from the participant's default identity provider.
 *
 * Moves between Tenzro and Canton go through Tenzro's native Canton
 * settlement, signed by the account's passkey; no Tenzro node holds a
 * credential for the wallet.
 */

import type { LedgerApiAdapterConfig } from './adapters/ledger-api-adapter.ts';

/** A Canton participant the operator runs, with wallet-held auth. */
export interface CantonProviderConfig {
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
   * standard `Authorization` header, for an operator whose token issuer
   * differs from the participant's default identity provider.
   */
  readonly useCantonAuthHeader?: boolean;
  readonly fetch?: typeof fetch;
}

/** Resolve a `CantonProviderConfig` to the `LedgerApiAdapterConfig` the kernel feeds to `new LedgerApiAdapter(...)`. */
export function resolveCantonAdapterConfig(provider: CantonProviderConfig): LedgerApiAdapterConfig {
  return {
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
}
