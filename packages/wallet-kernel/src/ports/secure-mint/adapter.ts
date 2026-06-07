/**
 * SecureMintAdapter — `SecureMintPort` backed by `tenzro-sdk`
 * `SecureMintClient`. The SDK exposes `client.secureMint.check / apply`;
 * the wallet port renames them to `checkMint / applyMint` to disambiguate
 * in a flat interface that also has policy ops.
 */

import type { SecureMintClient } from 'tenzro-sdk';
import type {
  SecureMintApply,
  SecureMintCheck,
  SecureMintPolicy,
  SecureMintPort,
} from './secure-mint.ts';

export type SecureMintClientLike = Pick<
  SecureMintClient,
  'setPolicy' | 'getPolicy' | 'clearPolicy' | 'check' | 'apply' | 'recordBurn'
>;

export class SecureMintAdapter implements SecureMintPort {
  constructor(private readonly client: SecureMintClientLike) {}

  setPolicy(policy: SecureMintPolicy): Promise<SecureMintPolicy> {
    return this.client.setPolicy(policy as never) as Promise<SecureMintPolicy>;
  }
  getPolicy(assetId: string): Promise<SecureMintPolicy | null> {
    return this.client.getPolicy(assetId) as Promise<SecureMintPolicy | null>;
  }
  clearPolicy(assetId: string): Promise<unknown> {
    return this.client.clearPolicy(assetId);
  }
  checkMint(assetId: string, amount: string): Promise<SecureMintCheck> {
    return this.client.check(assetId, amount) as Promise<SecureMintCheck>;
  }
  applyMint(assetId: string, amount: string): Promise<SecureMintApply> {
    return this.client.apply(assetId, amount) as Promise<SecureMintApply>;
  }
  recordBurn(assetId: string, amount: string): Promise<SecureMintApply> {
    return this.client.recordBurn(assetId, amount) as Promise<SecureMintApply>;
  }
}
