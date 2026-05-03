/**
 * AcpPort — buyer-side OpenAI Agentic Commerce Protocol (ACP).
 *
 * ACP went live with ChatGPT Instant Checkout on 2026-02-16 (Etsy /
 * Shopify / PayPal). Per `reference_agentic_payments_2026.md`, Tenzro's
 * adopt-don't-rebuild stance is: implement the *buyer* side so a Tenzro
 * agent can complete a ChatGPT-initiated purchase.
 *
 * The wallet is the buyer agent. It receives an ACP `CheckoutSession`
 * from the merchant (typically through ChatGPT), confirms with the user
 * via the standard consent flow, and submits a `CheckoutAuthorization`
 * back. Settlement happens on the merchant side; the wallet does not
 * transfer funds directly through ACP — it provides authorisation that
 * the merchant redeems via their PSP (Stripe is the typical processor).
 *
 * SDK status (2026-05): `tenzro-sdk` does NOT yet expose an ACP client.
 * This port is declared so the kernel surface is stable; `AcpSdkAdapter`
 * lands when the SDK ships `AcpClient` (tracked as DESIGN.md §11 SDK gap).
 *
 * Wire shape follows the public ACP v1 spec:
 *   • CheckoutSession: { id, merchant, line_items[], total, currency,
 *                        psp, expires_at }
 *   • CheckoutAuthorization: { session_id, buyer, payment_method,
 *                              authorisation_proof, signature }
 */

export interface AcpLineItem {
  readonly sku: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: string; // decimal
}

export interface AcpCheckoutSession {
  readonly sessionId: string;
  readonly merchant: string;
  readonly lineItems: readonly AcpLineItem[];
  readonly total: string; // decimal
  readonly currency: string;
  /** Payment service provider (e.g. "stripe", "adyen"). */
  readonly psp: string;
  readonly expiresAt: number;
}

export interface AcpAuthorizeRequest {
  readonly sessionId: string;
  /** Buyer DID — the agent / human authorising the purchase. */
  readonly buyer: string;
  /**
   * Payment method handle issued by the buyer's PSP. ACP carries the
   * handle, not raw card data.
   */
  readonly paymentMethod: string;
}

export interface AcpAuthorizationResult {
  readonly sessionId: string;
  readonly authorizationId: string;
  readonly status: 'authorised' | 'declined' | 'pending';
  readonly reason?: string;
}

export interface AcpPort {
  /** Fetch a checkout session by id (typically issued by the merchant). */
  getSession(sessionId: string): Promise<AcpCheckoutSession>;

  /** Authorise a checkout session. The wallet runs its consent flow first. */
  authorize(req: AcpAuthorizeRequest): Promise<AcpAuthorizationResult>;

  /** Cancel a session before authorisation. */
  cancel(sessionId: string): Promise<void>;
}
