/**
 * Eip7702Adapter — `Eip7702Port` backed by the `tenzro-sdk`
 * `Eip7702Client`. Only file in the kernel allowed to import
 * `tenzro-sdk` for EIP-7702 helpers.
 */

import type { Eip7702Client } from 'tenzro-sdk';
import type {
  Eip7702Designator,
  Eip7702ParsedDesignator,
  Eip7702Port,
  Eip7702ProtocolInfo,
  Eip7702SigningHash,
} from './eip7702.ts';

export type Eip7702ClientLike = Pick<
  Eip7702Client,
  'signingHash' | 'buildDesignator' | 'parseDesignator' | 'protocolInfo'
>;

export class Eip7702Adapter implements Eip7702Port {
  constructor(private readonly client: Eip7702ClientLike) {}

  signingHash(
    chainId: number,
    delegateAddress: string,
    nonce: number,
  ): Promise<Eip7702SigningHash> {
    return this.client.signingHash(chainId, delegateAddress, nonce) as Promise<Eip7702SigningHash>;
  }
  buildDesignator(delegateAddress: string): Promise<Eip7702Designator> {
    return this.client.buildDesignator(delegateAddress) as Promise<Eip7702Designator>;
  }
  parseDesignator(code: string): Promise<Eip7702ParsedDesignator> {
    return this.client.parseDesignator(code) as Promise<Eip7702ParsedDesignator>;
  }
  protocolInfo(): Promise<Eip7702ProtocolInfo> {
    return this.client.protocolInfo() as Promise<Eip7702ProtocolInfo>;
  }
}
