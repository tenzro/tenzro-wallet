/**
 * BridgeFeeAdapter — `BridgeFeePort` backed by `tenzro-sdk` `BridgeFeeClient`.
 */

import type { BridgeFeeClient } from 'tenzro-sdk';
import type {
  BridgeFeePort,
  BridgeFeeQuote,
  BridgeKeyAnalytics,
  BridgeSponsorshipPool,
  BridgeSponsorshipReceipt,
  QuoteBridgeFeeRequest,
  SetBridgeFeeRateRequest,
  SponsorBridgeFeeRequest,
} from './bridge-fee.ts';

export type BridgeFeeClientLike = Pick<
  BridgeFeeClient,
  | 'quote'
  | 'listSponsorshipPools'
  | 'sponsor'
  | 'getAnalytics'
  | 'setRate'
  | 'setRefillThreshold'
  | 'listAnalytics'
>;

function toAnalytics(o: {
  key_id: string;
  calls_total: number;
  errors_total: number;
  calls_by_method: Record<string, number>;
  errors_by_method: Record<string, number>;
  cu_consumed_total: number;
  first_seen_at?: number;
  last_called_at?: number;
  rate_limit_rejections: number;
}): BridgeKeyAnalytics {
  return {
    keyId: o.key_id,
    callsTotal: o.calls_total,
    errorsTotal: o.errors_total,
    callsByMethod: o.calls_by_method,
    errorsByMethod: o.errors_by_method,
    cuConsumedTotal: o.cu_consumed_total,
    ...(o.first_seen_at !== undefined ? { firstSeenAt: o.first_seen_at } : {}),
    ...(o.last_called_at !== undefined ? { lastCalledAt: o.last_called_at } : {}),
    rateLimitRejections: o.rate_limit_rejections,
  };
}

export class BridgeFeeAdapter implements BridgeFeePort {
  constructor(private readonly client: BridgeFeeClientLike) {}

  async quote(req: QuoteBridgeFeeRequest): Promise<BridgeFeeQuote> {
    const r = await this.client.quote({
      adapter: req.adapter,
      dest_chain: req.destChain,
      native_fee_smallest_unit: req.nativeFeeSmallestUnit,
    });
    return {
      adapter: r.adapter,
      destChain: r.dest_chain,
      nativeFeeSmallestUnit: r.native_fee_smallest_unit,
      tnzoAmountWei: r.tnzo_amount_wei,
      oracleBacking: r.oracle_backing,
    };
  }

  async listSponsorshipPools(): Promise<readonly BridgeSponsorshipPool[]> {
    const r = await this.client.listSponsorshipPools();
    return r.pools.map<BridgeSponsorshipPool>((p) => ({
      adapter: p.adapter,
      vaultAddressHex: p.vault_address_hex,
      tnzoBalanceWei: p.tnzo_balance_wei,
      nativeOutstandingSmallestUnit: p.native_outstanding_smallest_unit,
      ...(p.refill_threshold_bps !== undefined
        ? { refillThresholdBps: p.refill_threshold_bps }
        : {}),
    }));
  }

  async sponsor(req: SponsorBridgeFeeRequest): Promise<BridgeSponsorshipReceipt> {
    const r = await this.client.sponsor({
      quote_id_hex: req.quoteIdHex,
      adapter: req.adapter,
      dest_chain: req.destChain,
      native_fee_smallest_unit: req.nativeFeeSmallestUnit,
      tnzo_amount_wei: req.tnzoAmountWei,
      rate_q18_hex: req.rateQ18Hex,
      issued_at_ms: req.issuedAtMs,
      valid_until_ms: req.validUntilMs,
      ...(req.oracleBacking !== undefined ? { oracle_backing: req.oracleBacking } : {}),
      payer_did: req.payerDid,
    });
    return {
      sponsorshipIdHex: r.sponsorship_id_hex,
      quoteIdHex: r.quote_id_hex,
      adapter: r.adapter,
      destChain: r.dest_chain,
      payerDid: r.payer_did,
      tnzoPaidWei: r.tnzo_paid_wei,
      nativeCommittedSmallestUnit: r.native_committed_smallest_unit,
      sponsoredAtMs: r.sponsored_at_ms,
      poolAddressHex: r.pool_address_hex,
    };
  }

  async getAnalytics(): Promise<BridgeKeyAnalytics> {
    const r = await this.client.getAnalytics();
    return toAnalytics(r);
  }

  setRate(req: SetBridgeFeeRateRequest): Promise<unknown> {
    return this.client.setRate({
      adapter: req.adapter,
      dest_chain: req.destChain,
      rate_q18: req.rateQ18,
      markup_bps: req.markupBps,
      valid_window_ms: req.validWindowMs,
    });
  }

  setRefillThreshold(
    adapter: string,
    refillThresholdBps: number,
  ): Promise<unknown> {
    return this.client.setRefillThreshold(adapter, refillThresholdBps);
  }

  async listAnalytics(_keyId?: string): Promise<readonly BridgeKeyAnalytics[]> {
    const r = await this.client.listAnalytics();
    return r.analytics.map(toAnalytics);
  }
}
