/**
 * Permit2Adapter — `Permit2Port` backed by `tenzro-sdk` `Permit2Client`.
 */

import type { Permit2Client } from 'tenzro-sdk';
import type {
  Permit2Digest,
  Permit2DigestRequest,
  Permit2DomainSeparator,
  Permit2NonceUsed,
  Permit2Port,
  Permit2VerifyAndConsumeRequest,
  Permit2VerifyAndConsumeResult,
} from './permit2.ts';

export type Permit2ClientLike = Pick<
  Permit2Client,
  'domainSeparator' | 'digest' | 'verifyAndConsume' | 'nonceUsed'
>;

export class Permit2Adapter implements Permit2Port {
  constructor(private readonly client: Permit2ClientLike) {}

  domainSeparator(chainId: number): Promise<Permit2DomainSeparator> {
    return this.client.domainSeparator(chainId) as Promise<Permit2DomainSeparator>;
  }
  digest(req: Permit2DigestRequest): Promise<Permit2Digest> {
    return this.client.digest(req as never) as Promise<Permit2Digest>;
  }
  verifyAndConsume(
    req: Permit2VerifyAndConsumeRequest,
  ): Promise<Permit2VerifyAndConsumeResult> {
    return this.client.verifyAndConsume(req as never) as Promise<Permit2VerifyAndConsumeResult>;
  }
  nonceUsed(owner: string, nonce: string): Promise<Permit2NonceUsed> {
    return this.client.nonceUsed(owner, nonce) as Promise<Permit2NonceUsed>;
  }
}
