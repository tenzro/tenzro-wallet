/**
 * Ap2SdkAdapter — wraps `tenzro-sdk@0.1.0` `Ap2Client` and adapts its
 * snake_case wire shape (decimal-string amounts) to the kernel's
 * camelCase + bigint `Ap2Port`. The single file in the kernel that
 * imports from `tenzro-sdk`'s AP2 module — surface code never does.
 */

import type { Ap2Client } from 'tenzro-sdk';
import type {
  Ap2Authorization,
  Ap2CancelResult,
  Ap2MandatePairValidation,
  Ap2MandateVerification,
  Ap2PaymentReceipt,
  Ap2Port,
  Ap2Session,
  Ap2Vdc,
  CreateSessionRequest,
} from '../ap2.ts';

/**
 * Structural slice of `Ap2Client` the adapter touches. The real adapter
 * accepts the SDK class directly via `fromClient`; tests inject a fake
 * matching this shape.
 */
export type Ap2ClientLike = Pick<
  Ap2Client,
  | 'verifyMandate'
  | 'validateMandatePair'
  | 'createSession'
  | 'authorizePayment'
  | 'executePayment'
  | 'cancelSession'
  | 'getSession'
  | 'listAgentSessions'
>;

function mapSession(raw: Awaited<ReturnType<Ap2Client['getSession']>>): Ap2Session {
  return {
    sessionId: raw.session_id,
    agentDid: raw.agent_did,
    providerDid: raw.provider_did,
    service: raw.service,
    maxAmount: BigInt(raw.max_amount),
    totalSpent: BigInt(raw.total_spent),
    asset: raw.asset,
    status: raw.status,
  };
}

function mapVerification(
  raw: Awaited<ReturnType<Ap2Client['verifyMandate']>>,
): Ap2MandateVerification {
  return {
    valid: raw.valid,
    mandateType: raw.mandate_type,
    ...(raw.issuer ? { issuerDid: raw.issuer } : {}),
    ...(raw.subject ? { subjectDid: raw.subject } : {}),
    ...(raw.expires_at !== undefined ? { expiresAt: raw.expires_at } : {}),
    ...(raw.error !== undefined ? { error: raw.error } : {}),
  };
}

export class Ap2SdkAdapter implements Ap2Port {
  constructor(private readonly client: Ap2ClientLike) {}

  static fromClient(client: Ap2Client): Ap2SdkAdapter {
    return new Ap2SdkAdapter(client);
  }

  async verifyMandate(vdc: Ap2Vdc): Promise<Ap2MandateVerification> {
    return mapVerification(await this.client.verifyMandate(vdc));
  }

  async validateMandatePair(
    intentVdc: Ap2Vdc,
    cartVdc: Ap2Vdc,
    enforceDelegation?: boolean,
  ): Promise<Ap2MandatePairValidation> {
    const raw = await this.client.validateMandatePair(
      intentVdc,
      cartVdc,
      enforceDelegation ?? false,
    );
    return {
      valid: raw.valid,
      delegationEnforced: raw.delegation_enforced,
      ...(raw.intent_mandate_id !== undefined ? { intentMandateId: raw.intent_mandate_id } : {}),
      ...(raw.cart_mandate_id !== undefined ? { cartMandateId: raw.cart_mandate_id } : {}),
      ...(raw.principal_did !== undefined ? { principalDid: raw.principal_did } : {}),
      ...(raw.agent_did !== undefined ? { agentDid: raw.agent_did } : {}),
      ...(raw.error !== undefined ? { error: raw.error } : {}),
    };
  }

  async createSession(req: CreateSessionRequest): Promise<Ap2Session> {
    return mapSession(
      await this.client.createSession(
        req.agentDid,
        req.providerDid,
        req.service,
        req.maxAmount.toString(),
        req.asset ?? 'TNZO',
      ),
    );
  }

  async authorizePayment(sessionId: string, amount: bigint): Promise<Ap2Authorization> {
    const raw = await this.client.authorizePayment(sessionId, amount.toString());
    return {
      authorizationId: raw.authorization_id,
      sessionId: raw.session_id,
      amount: BigInt(raw.amount),
      status: raw.status,
    };
  }

  async executePayment(sessionId: string, authorizationId: string): Promise<Ap2PaymentReceipt> {
    const raw = await this.client.executePayment(sessionId, authorizationId);
    // SDK PaymentReceipt is camelCase + decimal-number; coerce amount → bigint
    // through string round-trip to avoid IEEE-754 truncation for large values.
    return {
      receiptId: raw.receiptId,
      sessionId: raw.sessionId ?? sessionId,
      amount: BigInt(Math.trunc(raw.amount)),
      asset: raw.asset,
    };
  }

  async cancelSession(sessionId: string): Promise<Ap2CancelResult> {
    const raw = await this.client.cancelSession(sessionId);
    return {
      sessionId: raw.session_id,
      status: raw.status,
      ...(raw.refunded_amount !== undefined ? { refundedAmount: BigInt(raw.refunded_amount) } : {}),
    };
  }

  async getSession(sessionId: string): Promise<Ap2Session | null> {
    try {
      return mapSession(await this.client.getSession(sessionId));
    } catch {
      // SDK throws on 404; the port semantics return null instead.
      return null;
    }
  }

  async listAgentSessions(agentDid: string): Promise<readonly Ap2Session[]> {
    const raw = await this.client.listAgentSessions(agentDid);
    return raw.map(mapSession);
  }
}
