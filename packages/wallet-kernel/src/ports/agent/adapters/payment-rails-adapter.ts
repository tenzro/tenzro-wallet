/**
 * PaymentRailsSdkAdapter — wraps `PaymentClient` (MPP / x402 / AP2 /
 * Visa TAP / Mastercard) behind one port. Each method maps 1:1 to an
 * RPC the SDK already exposes.
 *
 * The SDK currently types Visa TAP and Mastercard return values as `any`
 * because the gateway's response shape is rail-specific and still
 * stabilising. The adapter normalises into the common `PaymentReceipt`
 * shape: receipt id + status + tx hash + opaque meta.
 */

import type { PaymentClient } from 'tenzro-sdk';
import type {
  CreateChallengeRequest,
  IssueMastercardTokenRequest,
  MastercardToken,
  PayAp2Request,
  PayMastercardRequest,
  PayMppRequest,
  PayVisaTapRequest,
  PayX402Request,
  PaymentChallenge,
  PaymentRailsPort,
  PaymentReceipt,
  SignVisaTapRequest,
  VisaTapSignedRequest,
} from '../payment-rails.ts';

interface RawVisaTapSigned {
  headers?: Readonly<Record<string, string>>;
  url?: string;
  method?: string;
  [k: string]: unknown;
}

interface RawMastercardToken {
  token_id?: string;
  tokenId?: string;
  kind?: string;
  cap?: string;
  expires_at?: number;
  expiresAt?: number;
  [k: string]: unknown;
}

/**
 * Slice of `PaymentClient` the adapter relies on. Anchored to the SDK
 * via `Pick<>` for the methods that ship; `signVisaTap` and
 * `issueMastercardToken` are SDK-pending and use detect-via-presence.
 */
export type PaymentClientLike = Pick<
  PaymentClient,
  | 'createChallenge'
  | 'payMpp'
  | 'payX402'
  | 'payAp2'
  | 'payVisaTap'
  | 'payMastercard'
  | 'getReceipt'
> & {
  /**
   * SDK-pending. Present in `PaymentClientLike` so adapters can detect support
   * via `'signVisaTap' in client`. The current SDK build doesn't expose it;
   * the adapter's wrapper throws "SDK pending" until it does.
   */
  signVisaTap?(body: {
    method: string;
    url: string;
    headers: Readonly<Record<string, string>>;
    body?: string;
    agent_did: string;
  }): Promise<RawVisaTapSigned>;

  /** SDK-pending. Same detect-via-presence pattern as `signVisaTap`. */
  issueMastercardToken?(body: {
    agent_did: string;
    kind: string;
    params: Readonly<Record<string, unknown>>;
  }): Promise<RawMastercardToken>;
};

export class PaymentRailsSdkAdapter implements PaymentRailsPort {
  constructor(private readonly client: PaymentClientLike) {}

  async createChallenge(req: CreateChallengeRequest): Promise<PaymentChallenge> {
    const raw = await this.client.createChallenge(
      req.resource,
      req.amount,
      req.asset,
      req.protocol,
    );
    return {
      challengeId: raw.challengeId,
      resource: raw.resource,
      amount: raw.amount,
      asset: raw.asset,
      protocol: raw.protocol,
      raw: raw as unknown as Readonly<Record<string, unknown>>,
    };
  }

  async payMpp(req: PayMppRequest): Promise<PaymentReceipt> {
    return normaliseReceipt(await this.client.payMpp(req.url, req.payerDid));
  }

  async payX402(req: PayX402Request): Promise<PaymentReceipt> {
    return normaliseReceipt(await this.client.payX402(req.url, req.payerDid));
  }

  async payAp2(req: PayAp2Request): Promise<PaymentReceipt> {
    return normaliseReceipt(await this.client.payAp2(req.agentDid, req.url, req.amount));
  }

  async payVisaTap(req: PayVisaTapRequest): Promise<PaymentReceipt> {
    return normaliseReceipt(await this.client.payVisaTap(req.credential));
  }

  async payMastercard(req: PayMastercardRequest): Promise<PaymentReceipt> {
    return normaliseReceipt(await this.client.payMastercard(req.credential));
  }

  async getReceipt(receiptId: string): Promise<PaymentReceipt | null> {
    try {
      const raw = await this.client.getReceipt(receiptId);
      if (raw === null || raw === undefined) return null;
      return normaliseReceipt(raw);
    } catch {
      // SDK throws on 404; the port semantics return null instead.
      return null;
    }
  }

  async signVisaTap(req: SignVisaTapRequest): Promise<VisaTapSignedRequest> {
    if (!this.client.signVisaTap) {
      throw new Error(
        'PaymentRailsSdkAdapter.signVisaTap: SDK pending — tenzro-sdk PaymentClient does not yet expose signVisaTap (DESIGN.md §11.1)',
      );
    }
    const raw = await this.client.signVisaTap({
      method: req.request.method,
      url: req.request.url,
      headers: req.request.headers,
      ...(req.request.body !== undefined ? { body: req.request.body } : {}),
      agent_did: req.agentDid,
    });
    return {
      headers: raw.headers ?? req.request.headers,
      url: raw.url ?? req.request.url,
      method: raw.method ?? req.request.method,
    };
  }

  async issueMastercardToken(req: IssueMastercardTokenRequest): Promise<MastercardToken> {
    if (!this.client.issueMastercardToken) {
      throw new Error(
        'PaymentRailsSdkAdapter.issueMastercardToken: SDK pending — tenzro-sdk PaymentClient does not yet expose issueMastercardToken (DESIGN.md §11.1)',
      );
    }
    const raw = await this.client.issueMastercardToken({
      agent_did: req.agentDid,
      kind: req.kind,
      params: req.params,
    });
    const kind = (raw.kind as MastercardToken['kind']) ?? req.kind;
    return {
      tokenId: raw.token_id ?? raw.tokenId ?? '',
      kind,
      cap: raw.cap ?? '0',
      expiresAt: raw.expires_at ?? raw.expiresAt ?? 0,
      raw,
    };
  }
}

function normaliseReceipt(raw: unknown): PaymentReceipt {
  // Real SDK PaymentReceipt is camelCase + decimal `amount`. Visa/Mastercard
  // are typed `any` server-side and may include `txHash` / `tx_hash` on the
  // gateway path; we accept both.
  const r = (raw ?? {}) as {
    receiptId?: string;
    receipt_id?: string;
    id?: string;
    status?: string;
    state?: string;
    txHash?: string;
    tx_hash?: string;
    transaction_hash?: string;
    [k: string]: unknown;
  };
  return {
    receiptId: r.receiptId ?? r.receipt_id ?? r.id ?? '',
    status: r.status ?? r.state ?? 'unknown',
    ...(r.txHash !== undefined
      ? { txHash: r.txHash }
      : r.tx_hash !== undefined
        ? { txHash: r.tx_hash }
        : r.transaction_hash !== undefined
          ? { txHash: r.transaction_hash }
          : {}),
    meta: r,
  };
}
