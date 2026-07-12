/**
 * Testnet faucet — POST {address} to api.tenzro.xyz/faucet.
 *
 * The endpoint always returns HTTP 200 with `{success, tx_hash, amount,
 * message}`. Rate-limit failures come back as `success:false` with a
 * `Try again in N seconds` message, so we surface the message verbatim
 * rather than throwing on the HTTP layer.
 */

import { TENZRO_API_URL } from './config';

export interface FaucetResult {
  readonly success: boolean;
  readonly tx_hash: string | null;
  readonly amount: string;
  readonly message: string;
}

export async function requestFaucet(address: string): Promise<FaucetResult> {
  const res = await fetch(`${TENZRO_API_URL}/faucet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) {
    throw new Error(`Faucet HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return (await res.json()) as FaucetResult;
}
