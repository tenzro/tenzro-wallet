/**
 * Canton MainNet validator smoke test — env-gated. Skipped in CI by default;
 * run locally against the Tenzro-hosted Canton validator to confirm the
 * `LedgerApiAdapter` actually talks to a real participant + Splice
 * validator-app.
 *
 * Required env (see `.env.example` at repo root):
 *   - CANTON_LEDGER_BASE_URL — JSON Ledger API root (e.g. https://canton.example:7575)
 *   - CANTON_VALIDATOR_BASE_URL — Splice validator-app root (e.g. https://canton.example:5003)
 *   - CANTON_AUTH0_TOKEN — Auth0 JWT, audience https://canton.network.global
 *   - CANTON_USER_ID — Canton user (Auth0 subject mapped on the validator)
 *   - CANTON_TEST_PARTY — party id we own (`<hint>::<fingerprint>`)
 *
 * Optional env:
 *   - CANTON_TEST_TIMEOUT_MS — default 30s.
 *
 * What it does:
 *   1. Construct `LedgerApiAdapter` with a static-token getter pulled from env.
 *   2. Drain `getActiveContracts({ party })` — the cheapest authenticated read.
 *      Confirms transport + auth + party visibility in one shot.
 *   3. Probe `lookupPreapproval(party)` against the Splice validator-app —
 *      confirms the second base URL also works under the same auth.
 *
 * Each call is its own assertion so transport, auth, or Splice-proxy
 * breakage all surface at the right line. Operational specifics for the
 * Tenzro-operated validator live in a private operations document.
 */

import { describe, expect, it } from 'vitest';
import { LedgerApiAdapter } from '../ports/canton/adapters/ledger-api-adapter.ts';

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

const HAS_AUTH = Boolean(
  env.CANTON_LEDGER_BASE_URL &&
    env.CANTON_VALIDATOR_BASE_URL &&
    env.CANTON_AUTH0_TOKEN &&
    env.CANTON_USER_ID &&
    env.CANTON_TEST_PARTY,
);
const TIMEOUT_MS = Number(env.CANTON_TEST_TIMEOUT_MS ?? 30_000);

describe.skipIf(!HAS_AUTH)('integration: canton mainnet validator smoke', () => {
  it(
    'reads active contracts and looks up preapproval against tenzro validator',
    async () => {
      const token = env.CANTON_AUTH0_TOKEN ?? '';
      const adapter = new LedgerApiAdapter({
        ledgerBaseUrl: env.CANTON_LEDGER_BASE_URL ?? '',
        validatorBaseUrl: env.CANTON_VALIDATOR_BASE_URL ?? '',
        userId: env.CANTON_USER_ID ?? '',
        token: async () => token,
      });
      const party = env.CANTON_TEST_PARTY ?? '';

      // 1. Auth + transport check via the JSON Ledger API. An empty active-set
      //    is a valid result; the assertion is "didn't throw".
      const seen: string[] = [];
      for await (const c of adapter.getActiveContracts({ party })) {
        seen.push(c.contractId);
        if (seen.length >= 5) break; // cap — we only need to prove it streams
      }
      expect(Array.isArray(seen)).toBe(true);

      // 2. Splice validator-app reachability. `lookupPreapproval` returns null
      //    when the party has no preapproval contract — that's fine; we only
      //    care that the second base URL responds under the same auth.
      const preapproval = await adapter.lookupPreapproval(party);
      expect(preapproval === null || typeof preapproval.contractId === 'string').toBe(true);
    },
    TIMEOUT_MS,
  );
});
