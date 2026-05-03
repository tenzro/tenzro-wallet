/**
 * PaymentRailsPort — agent-payment rail dispatcher.
 *
 * Tenzro's `PaymentClient` exposes five rails through one client class:
 *
 *   • MPP            — Tempo's Machine Payments Protocol
 *   • x402           — Coinbase HTTP-402, x402 Foundation governance,
 *                      absorbed as a payment method inside AP2
 *   • AP2            — FIDO Alliance Agentic-Payments TWG (v0.2, Apr 2026)
 *   • Visa TAP       — Visa Trusted Agent Protocol (RFC 9421 sigs)
 *   • Mastercard     — Mastercard Agent Pay (SingleUse / SessionBound /
 *                      Recurring tokens, KYA tier checks)
 *
 * The wallet doesn't pick the rail — the merchant or resource declares it
 * (HTTP 402 header, AP2 mandate type, etc.). The wallet's job is to
 * surface them through one port so a single agent-spending UI can drive
 * them all under the same SessionKey scope.
 *
 * Per `reference_agentic_payments_2026.md`: x402 is now subsumed inside
 * AP2 schema-wise, but stays a distinct *rail* on the wire (HTTP 402 vs.
 * AP2 mandate). We keep the methods separate so callers can opt into the
 * rail their counterparty actually speaks.
 */

export interface PaymentReceipt {
  readonly receiptId: string;
  /** Underlying tx hash on the settlement chain, when applicable. */
  readonly txHash?: string;
  /** Engine-reported status (Approved / Settled / Pending / Failed / …). */
  readonly status: string;
  /** Free-form metadata the engine attached. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface PayMppRequest {
  readonly url: string;
  readonly payerDid?: string;
}

export interface PayX402Request {
  readonly url: string;
  readonly payerDid?: string;
}

export interface PayAp2Request {
  /** Agent DID that authorises the payment under its delegation scope. */
  readonly agentDid: string;
  readonly url: string;
  /** Decimal-string amount (preserves precision; matches AP2 wire shape). */
  readonly amount: string;
}

export interface PayVisaTapRequest {
  /** Visa-issued credential. Opaque; forwarded verbatim. */
  readonly credential: Readonly<Record<string, unknown>>;
}

export interface PayMastercardRequest {
  /**
   * Mastercard-issued payment credential — typically one of the three
   * token kinds: SingleUse, SessionBound, Recurring.
   */
  readonly credential: Readonly<Record<string, unknown>>;
}

// ──────────────── Credential issuance / signing (SDK-pending) ────────────────
//
// Visa TAP credential signing and Mastercard Agent Pay token issuance are
// both *upstream* of settlement. The SDK is expected to expose them as
// methods on the same `PaymentClient`; per `reference_agentic_payments_2026.md`
// the wallet does NOT carry the protocol primitives kernel-side. These hooks
// throw "SDK pending" until the SDK exposes the methods (DESIGN.md §11.1).

export interface SignVisaTapRequest {
  /**
   * RFC 9421 HTTP message-signature inputs the SDK turns into the
   * `Signature-Input` / `Signature` header pair. The wallet only declares
   * what it carries on the wire — composition happens in the SDK.
   */
  readonly request: {
    readonly method: string;
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  };
  /** Agent DID whose key signs the message. */
  readonly agentDid: string;
}

export interface VisaTapSignedRequest {
  /** Original headers plus `Signature-Input` and `Signature`. */
  readonly headers: Readonly<Record<string, string>>;
  /** Echoed back so callers don't have to thread the URL separately. */
  readonly url: string;
  readonly method: string;
}

/** Mastercard token kinds per Mastercard Agent Pay spec. */
export type MastercardTokenKind = 'SingleUse' | 'SessionBound' | 'Recurring';

export interface IssueMastercardTokenRequest {
  readonly agentDid: string;
  readonly kind: MastercardTokenKind;
  /**
   * Per-token-kind binding params — opaque to the kernel (recurring schedule,
   * session id, single-use cap, etc.). The SDK validates against KYA tier.
   */
  readonly params: Readonly<Record<string, unknown>>;
}

export interface MastercardToken {
  readonly tokenId: string;
  readonly kind: MastercardTokenKind;
  /** Decimal-string cap; "0" means uncapped at this layer (KYA tier still applies). */
  readonly cap: string;
  readonly expiresAt: number;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface PaymentChallenge {
  /** Opaque challenge id the gateway echoes back. */
  readonly challengeId: string;
  /** Resource the challenge gates. */
  readonly resource: string;
  readonly amount: number;
  readonly asset: string;
  readonly protocol: string;
  /** Engine fields the wallet should not interpret. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface CreateChallengeRequest {
  readonly resource: string;
  readonly amount: number;
  /** Defaults to 'USDC' on the SDK side. */
  readonly asset?: string;
  /** Defaults to 'mpp' on the SDK side. */
  readonly protocol?: 'mpp' | 'x402' | 'ap2';
}

export interface PaymentRailsPort {
  createChallenge(req: CreateChallengeRequest): Promise<PaymentChallenge>;
  payMpp(req: PayMppRequest): Promise<PaymentReceipt>;
  payX402(req: PayX402Request): Promise<PaymentReceipt>;
  payAp2(req: PayAp2Request): Promise<PaymentReceipt>;
  payVisaTap(req: PayVisaTapRequest): Promise<PaymentReceipt>;
  payMastercard(req: PayMastercardRequest): Promise<PaymentReceipt>;
  getReceipt(receiptId: string): Promise<PaymentReceipt | null>;

  // ─── Credential issuance / signing (SDK-pending — see comments above) ───

  /**
   * Produce RFC 9421 message-signature headers for a Visa TAP request.
   * Throws "SDK pending" until `tenzro-sdk`'s PaymentClient exposes
   * `signVisaTap` (DESIGN.md §11.1).
   */
  signVisaTap(req: SignVisaTapRequest): Promise<VisaTapSignedRequest>;

  /**
   * Issue a Mastercard Agent Pay token for the given agent + kind. Throws
   * "SDK pending" until `tenzro-sdk`'s PaymentClient exposes
   * `issueMastercardToken` (DESIGN.md §11.1).
   */
  issueMastercardToken(req: IssueMastercardTokenRequest): Promise<MastercardToken>;
}
