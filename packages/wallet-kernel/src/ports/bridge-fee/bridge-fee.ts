/**
 * BridgeFeePort — destination-native bridge fees paid in TNZO.
 *
 * Wallet usage:
 *  1. Quote: ask the node for the TNZO-denominated cost of a
 *     destination-native bridge fee, surface it to the signer.
 *  2. Sponsor: debit TNZO from the user, credit the per-adapter
 *     sponsorship-pool vault.
 *  3. Analytics: subject self-read of CU consumption + counters.
 *
 * Admin paths (`setRate`, `setRefillThreshold`, `listAnalytics`) are
 * operator-only and gated by `X-Tenzro-Admin-Token` at the node layer.
 */

export interface QuoteBridgeFeeRequest {
  readonly adapter: string;
  readonly destChain: string;
  readonly nativeFeeSmallestUnit: string;
}

export interface BridgeFeeQuote {
  readonly adapter: string;
  readonly destChain: string;
  readonly nativeFeeSmallestUnit: string;
  readonly tnzoAmountWei: string;
  readonly oracleBacking: string;
}

export interface BridgeSponsorshipPool {
  readonly adapter: string;
  readonly vaultAddressHex: string;
  readonly tnzoBalanceWei: string;
  readonly nativeOutstandingSmallestUnit: string;
  readonly refillThresholdBps?: number;
}

export interface SetBridgeFeeRateRequest {
  readonly adapter: string;
  readonly destChain: string;
  readonly rateQ18: string;
  readonly markupBps: number;
  readonly validWindowMs: number;
}

export interface SponsorBridgeFeeRequest {
  readonly quoteIdHex: string;
  readonly adapter: string;
  readonly destChain: string;
  readonly nativeFeeSmallestUnit: string;
  readonly tnzoAmountWei: string;
  readonly rateQ18Hex: string;
  readonly issuedAtMs: number;
  readonly validUntilMs: number;
  readonly oracleBacking?: string;
  readonly payerDid: string;
}

export interface BridgeSponsorshipReceipt {
  readonly sponsorshipIdHex: string;
  readonly quoteIdHex: string;
  readonly adapter: string;
  readonly destChain: string;
  readonly payerDid: string;
  readonly tnzoPaidWei: string;
  readonly nativeCommittedSmallestUnit: string;
  readonly sponsoredAtMs: number;
  readonly poolAddressHex: string;
}

export interface BridgeKeyAnalytics {
  readonly keyId: string;
  readonly callsTotal: number;
  readonly errorsTotal: number;
  readonly callsByMethod: Readonly<Record<string, number>>;
  readonly errorsByMethod: Readonly<Record<string, number>>;
  /** Compute Units consumed (sum of per-method weights on success). */
  readonly cuConsumedTotal: number;
  readonly firstSeenAt?: number;
  readonly lastCalledAt?: number;
  readonly rateLimitRejections: number;
}

export interface BridgeFeePort {
  quote(req: QuoteBridgeFeeRequest): Promise<BridgeFeeQuote>;
  listSponsorshipPools(): Promise<readonly BridgeSponsorshipPool[]>;
  sponsor(req: SponsorBridgeFeeRequest): Promise<BridgeSponsorshipReceipt>;
  /** Subject self-read of the caller's own analytics. */
  getAnalytics(): Promise<BridgeKeyAnalytics>;
  /** Admin-token-gated. */
  setRate(req: SetBridgeFeeRateRequest): Promise<unknown>;
  setRefillThreshold(adapter: string, refillThresholdBps: number): Promise<unknown>;
  /** Admin-token-gated cross-tenant read. */
  listAnalytics(keyId?: string): Promise<readonly BridgeKeyAnalytics[]>;
}
