/**
 * CapitalIntentAdapter — `CapitalIntentPort` backed by the `tenzro-sdk`
 * `CapitalClient`. Mirrors the wallet's strict ports + adapters
 * discipline: this is the only file in the kernel allowed to import
 * `tenzro-sdk` for capital intents.
 *
 * SDK shape this targets (`tenzro-sdk@^0.4.0`).
 */

import type { CapitalClient } from 'tenzro-sdk';
import type { CapitalIntentPort } from './capital.ts';

export type CapitalClientLike = Pick<
  CapitalClient,
  | 'open'
  | 'quote'
  | 'assign'
  | 'execute'
  | 'verify'
  | 'compensate'
  | 'settle'
  | 'get'
  | 'submitReserveAttestation'
  | 'getReserve'
  | 'attestedMint'
>;

export class CapitalIntentAdapter implements CapitalIntentPort {
  constructor(private readonly client: CapitalClientLike) {}

  open(intent: unknown): Promise<unknown> {
    return this.client.open(intent as never);
  }
  quote(
    intentId: string,
    solverDid: string,
    plan: string,
    price: number,
    etaSecs: number,
  ): Promise<unknown> {
    return this.client.quote(intentId, solverDid, plan, price, etaSecs);
  }
  assign(
    intentId: string,
    opts: { solverDid?: string; auto?: boolean; payer?: string; payee?: string } = {},
  ): Promise<unknown> {
    return this.client.assign(intentId, opts);
  }
  execute(intentId: string, leg: unknown): Promise<unknown> {
    return this.client.execute(intentId, leg as never);
  }
  verify(intentId: string): Promise<unknown> {
    return this.client.verify(intentId);
  }
  compensate(intentId: string): Promise<unknown> {
    return this.client.compensate(intentId);
  }
  settle(intentId: string, payee?: string): Promise<unknown> {
    return this.client.settle(intentId, payee);
  }
  getIntent(intentId: string): Promise<unknown> {
    return this.client.get(intentId);
  }
  submitReserveAttestation(attestation: unknown): Promise<unknown> {
    return this.client.submitReserveAttestation(attestation as never);
  }
  getReserve(assetId: string): Promise<unknown> {
    return this.client.getReserve(assetId);
  }
  attestedMint(
    tokenId: string,
    to: string,
    amount: string,
    caller: string,
  ): Promise<unknown> {
    return this.client.attestedMint(tokenId, to, amount, caller);
  }
}
