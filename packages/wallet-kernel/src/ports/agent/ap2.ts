/**
 * Ap2Port — kernel's view of the AP2 (Agent Payment Protocol) layer.
 *
 * AP2 v0.2 was donated to the FIDO Alliance on April 28 2026 and is the
 * de-facto agent-payment standard. The protocol expresses each step of an
 * agent-driven payment as a Verifiable Digital Credential (VDC):
 *   • Intent  — "user wants to buy X under Y constraints"
 *   • Cart    — "this exact merchant + this exact basket"
 *   • Payment — "this rail pulled this amount on this day"
 *
 * Tenzro's node ships AP2 as RPC methods (`tenzro_ap2*`) and the
 * `tenzro-sdk` exposes them via `Ap2Client`. The wallet kernel does NOT
 * re-implement the protocol; it consumes it through this port and trusts
 * the node's verification result the same way it trusts the rest of the
 * RPC surface (the node holds the FIDO trust anchor).
 *
 * Port shape mirrors the SDK semantics: a session is keyed by
 * (agentDid, providerDid, service, maxAmount); individual payments are
 * authorized within the session and then executed.
 */

/** A Verifiable Digital Credential — opaque JSON-shaped envelope. */
export type Ap2Vdc = Readonly<Record<string, unknown>>;

/** Mandate-verification result for a single VDC. */
export interface Ap2MandateVerification {
  readonly valid: boolean;
  /** "Intent" | "Cart" | "Payment" — surfaced raw from the verifier. */
  readonly mandateType: string;
  readonly issuerDid?: string;
  readonly subjectDid?: string;
  /** Unix-seconds expiry. */
  readonly expiresAt?: number;
  readonly error?: string;
}

/**
 * Pair-validation result for an Intent + Cart mandate. Matches the SDK
 * shape (`tenzro-sdk` `Ap2Client.validateMandatePair`): the verifier
 * returns the resolved DIDs and mandate IDs alongside a `valid` flag
 * and a `delegationEnforced` flag, not the per-leg verification details.
 */
export interface Ap2MandatePairValidation {
  readonly valid: boolean;
  readonly intentMandateId?: string;
  readonly cartMandateId?: string;
  readonly principalDid?: string;
  readonly agentDid?: string;
  readonly delegationEnforced: boolean;
  readonly error?: string;
}

export type Ap2SessionStatus = 'active' | 'completed' | 'cancelled' | 'expired';

export interface Ap2Session {
  readonly sessionId: string;
  readonly agentDid: string;
  readonly providerDid: string;
  readonly service: string;
  /** Max authorised spend, in smallest units of `asset`. */
  readonly maxAmount: bigint;
  /** Cumulative spent, smallest units. */
  readonly totalSpent: bigint;
  readonly asset: string;
  readonly status: Ap2SessionStatus;
}

export type Ap2AuthorizationStatus = 'pending' | 'approved' | 'executed' | 'rejected';

export interface Ap2Authorization {
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly amount: bigint;
  readonly status: Ap2AuthorizationStatus;
}

export interface Ap2PaymentReceipt {
  readonly receiptId: string;
  readonly sessionId: string;
  readonly amount: bigint;
  readonly asset: string;
}

export interface Ap2CancelResult {
  readonly sessionId: string;
  readonly status: string;
  readonly refundedAmount?: bigint;
}

export interface CreateSessionRequest {
  readonly agentDid: string;
  readonly providerDid: string;
  readonly service: string;
  readonly maxAmount: bigint;
  /** Defaults to 'TNZO' when the adapter calls the node. */
  readonly asset?: string;
}

export interface Ap2Port {
  /** Verify a single mandate VDC against the node's FIDO trust anchor. */
  verifyMandate(vdc: Ap2Vdc): Promise<Ap2MandateVerification>;

  /**
   * Validate an Intent+Cart pair for mutual consistency. Set
   * `enforceDelegation` to require that the agent DID claimed in the cart
   * is bound to the principal DID via a verifiable delegation chain.
   */
  validateMandatePair(
    intentVdc: Ap2Vdc,
    cartVdc: Ap2Vdc,
    enforceDelegation?: boolean,
  ): Promise<Ap2MandatePairValidation>;

  createSession(req: CreateSessionRequest): Promise<Ap2Session>;
  authorizePayment(sessionId: string, amount: bigint): Promise<Ap2Authorization>;
  executePayment(sessionId: string, authorizationId: string): Promise<Ap2PaymentReceipt>;
  cancelSession(sessionId: string): Promise<Ap2CancelResult>;
  getSession(sessionId: string): Promise<Ap2Session | null>;
  listAgentSessions(agentDid: string): Promise<readonly Ap2Session[]>;
}
