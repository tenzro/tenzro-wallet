/**
 * Ivms101Port — FATF Travel Rule IVMS101 v1.1.0 canonical envelope.
 *
 * Wallet usage: cross-border transfers that fall under the FATF Travel
 * Rule (typically >$1000 equivalent crossing VASP boundaries) require an
 * IVMS101 KYC payload attached to the transfer. The wallet computes the
 * canonical hash of the payload, binds it to the transfer envelope,
 * and surfaces the hash to the user before signing.
 */

export interface Ivms101HashRequest {
  /** Canonical IVMS101 v1.1.0 JSON payload (envelope shape). */
  readonly payload: Record<string, unknown>;
}

export interface Ivms101HashResult {
  readonly envelopeHashHex: string;
  readonly specVersion: string;
  readonly originatingVaspDid: string | null;
  readonly beneficiaryVaspDid: string | null;
  readonly assetCaip19: string;
  readonly amountSmallestUnit: string;
}

export interface Ivms101Port {
  canonicalHash(req: Ivms101HashRequest): Promise<Ivms101HashResult>;
}
