/**
 * Ivms101Adapter — `Ivms101Port` backed by `tenzro-sdk` `Ivms101Client`.
 */

import type { Ivms101Client } from 'tenzro-sdk';
import type {
  Ivms101HashRequest,
  Ivms101HashResult,
  Ivms101Port,
} from './ivms101.ts';

export type Ivms101ClientLike = Pick<Ivms101Client, 'canonicalHash'>;

export class Ivms101Adapter implements Ivms101Port {
  constructor(private readonly client: Ivms101ClientLike) {}

  async canonicalHash(req: Ivms101HashRequest): Promise<Ivms101HashResult> {
    const r = await this.client.canonicalHash(req.payload);
    return {
      envelopeHashHex: r.envelope_hash_hex,
      specVersion: r.spec_version,
      originatingVaspDid: r.originating_vasp_did,
      beneficiaryVaspDid: r.beneficiary_vasp_did,
      assetCaip19: r.asset_caip19,
      amountSmallestUnit: r.amount_smallest_unit,
    };
  }
}
