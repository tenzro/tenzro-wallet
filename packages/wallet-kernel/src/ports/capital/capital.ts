/**
 * CapitalIntentPort — regulated capital allocation over tokenized assets.
 *
 * Capital Intents are the capital-markets analog of an AP2 Intent Mandate:
 * a signed, expiring authorization to acquire / exit / rebalance / hedge /
 * yield a basket of tokenized assets subject to regulatory regime, KYA
 * ceilings, and per-leg constraints. Solvers bid; an assigner (principal
 * or delegate) picks a winner; lifecycle is
 * Open → Quote → Assign → Execute → Verify (or Compensate) → Settle.
 *
 * 1:1 asset backing flows through `submitReserveAttestation` /
 * `getReserve`, gating `attestedMint`.
 *
 * Wallet usage: the wallet does NOT pick solvers or score reputation; it
 * just signs intents on behalf of the user/agent and surfaces the
 * lifecycle in the UI.
 */

export interface CapitalIntentLifecycle {
  open(intent: unknown): Promise<unknown>;
  quote(
    intentId: string,
    solverDid: string,
    plan: string,
    price: number,
    etaSecs: number,
  ): Promise<unknown>;
  assign(
    intentId: string,
    opts?: { solverDid?: string; auto?: boolean; payer?: string; payee?: string },
  ): Promise<unknown>;
  execute(intentId: string, leg: unknown): Promise<unknown>;
  verify(intentId: string): Promise<unknown>;
  compensate(intentId: string): Promise<unknown>;
  settle(intentId: string, payee?: string): Promise<unknown>;
  getIntent(intentId: string): Promise<unknown>;
}

export interface ReserveAttestationPort {
  submitReserveAttestation(attestation: unknown): Promise<unknown>;
  getReserve(assetId: string): Promise<unknown>;
  attestedMint(
    tokenId: string,
    to: string,
    amount: string,
    caller: string,
  ): Promise<unknown>;
}

export type CapitalIntentPort = CapitalIntentLifecycle & ReserveAttestationPort;
