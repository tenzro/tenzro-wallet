/**
 * AcpSdkAdapter — buyer-side OpenAI Agentic Commerce Protocol (ACP) wrapper.
 *
 * **SDK status (2026-05):** `tenzro-sdk` does NOT yet expose an `AcpClient`.
 * This adapter therefore depends on a structural `AcpClientLike` interface
 * the kernel defines itself, mirroring the public ACP v1 wire shape. When
 * the SDK ships `AcpClient`, swap `AcpClientLike` for the SDK type and
 * delete the structural definition — the wire mapping below is already
 * the one we'll need.
 *
 * Wire shape pinned to the public ACP spec:
 *   GET  /sessions/{id}                  → AcpCheckoutSession (snake_case)
 *   POST /sessions/{id}/authorize        → AcpAuthorizationResult
 *   POST /sessions/{id}/cancel           → 204
 *
 * Field-mapping rules, identical to the rest of the agent-port adapter set:
 *   - snake_case on the wire ↔ camelCase on the port.
 *   - decimal-string amounts on the wire (ACP carries no bigint over the
 *     wire — all amounts are "1234.56" strings — so we forward verbatim).
 *   - missing optional fields use the conditional-spread idiom required
 *     by the kernel's `exactOptionalPropertyTypes: true`.
 */

import type {
  AcpAuthorizationResult,
  AcpAuthorizeRequest,
  AcpCheckoutSession,
  AcpLineItem,
  AcpPort,
} from '../acp.ts';

interface RawLineItem {
  readonly sku: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit_price: string;
}

interface RawCheckoutSession {
  readonly session_id: string;
  readonly merchant: string;
  readonly line_items: ReadonlyArray<RawLineItem>;
  readonly total: string;
  readonly currency: string;
  readonly psp: string;
  readonly expires_at: number;
}

interface RawAuthorizationResult {
  readonly session_id: string;
  readonly authorization_id: string;
  readonly status: 'authorised' | 'declined' | 'pending';
  readonly reason?: string;
}

/**
 * Structural shape the adapter expects from the SDK client. When `tenzro-sdk`
 * exposes `AcpClient`, this becomes `import type { AcpClient } from 'tenzro-sdk'`
 * and the structural type goes away.
 */
export interface AcpClientLike {
  getSession(sessionId: string): Promise<RawCheckoutSession>;
  authorize(req: {
    session_id: string;
    buyer: string;
    payment_method: string;
  }): Promise<RawAuthorizationResult>;
  cancel(sessionId: string): Promise<void>;
}

function mapLineItem(raw: RawLineItem): AcpLineItem {
  return {
    sku: raw.sku,
    description: raw.description,
    quantity: raw.quantity,
    unitPrice: raw.unit_price,
  };
}

function mapSession(raw: RawCheckoutSession): AcpCheckoutSession {
  return {
    sessionId: raw.session_id,
    merchant: raw.merchant,
    lineItems: raw.line_items.map(mapLineItem),
    total: raw.total,
    currency: raw.currency,
    psp: raw.psp,
    expiresAt: raw.expires_at,
  };
}

function mapAuthorizationResult(
  raw: RawAuthorizationResult,
): AcpAuthorizationResult {
  return {
    sessionId: raw.session_id,
    authorizationId: raw.authorization_id,
    status: raw.status,
    ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
  };
}

export class AcpSdkAdapter implements AcpPort {
  constructor(private readonly client: AcpClientLike) {}

  async getSession(sessionId: string): Promise<AcpCheckoutSession> {
    return mapSession(await this.client.getSession(sessionId));
  }

  async authorize(req: AcpAuthorizeRequest): Promise<AcpAuthorizationResult> {
    const raw = await this.client.authorize({
      session_id: req.sessionId,
      buyer: req.buyer,
      payment_method: req.paymentMethod,
    });
    return mapAuthorizationResult(raw);
  }

  async cancel(sessionId: string): Promise<void> {
    await this.client.cancel(sessionId);
  }
}
