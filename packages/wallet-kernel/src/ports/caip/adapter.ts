/**
 * CaipAdapter — `CaipPort` backed by `tenzro-sdk` `CaipClient`.
 */

import type { CaipClient } from 'tenzro-sdk';
import type { Caip10Info, Caip19Info, Caip19Request, Caip2Info, CaipPort } from './caip.ts';

export type CaipClientLike = Pick<CaipClient, 'caip2' | 'caip10' | 'caip19'>;

export class CaipAdapter implements CaipPort {
  constructor(private readonly client: CaipClientLike) {}

  caip2(): Promise<Caip2Info> {
    return this.client.caip2() as Promise<Caip2Info>;
  }
  caip10(address: string): Promise<Caip10Info> {
    return this.client.caip10(address) as Promise<Caip10Info>;
  }
  caip19(params: Caip19Request): Promise<Caip19Info> {
    return this.client.caip19(params as never) as Promise<Caip19Info>;
  }
}
