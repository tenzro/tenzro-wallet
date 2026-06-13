/**
 * SecureMintAdapter — `SecureMintPort` backed by `tenzro-sdk`
 * `SecureMintClient`.
 *
 * Wire:
 *   setPolicy   → SecureMintClient.setPolicy(policy)    [→ {installed, policy}]
 *   getPolicy   → SecureMintClient.getPolicy(token)     [→ {found, policy?}]
 *   clearPolicy → SecureMintClient.clearPolicy(token)   [→ {cleared}]
 *   checkMint   → SecureMintClient.check(token, amount)  [→ {allowed, ...}]
 *   applyMint   → SecureMintClient.apply(token, amount)  [→ {applied, policy}]
 *   recordBurn  → SecureMintClient.recordBurn(...)       [→ {recorded, policy}]
 *
 * The SDK keys every method on the token's 20-byte EVM address and wraps
 * results in `{flag, token, ...}` envelopes; we serialise our typed
 * `SecureMintPolicy` (camelCase, bigint amounts) to the snake_case /
 * string-amount shape the RPC expects and decode the envelopes back.
 */

import type { SecureMintClient, SecureMintPolicy as SdkPolicy } from 'tenzro-sdk';
import type {
  SecureMintApply,
  SecureMintCheck,
  SecureMintPolicy,
  SecureMintPort,
} from './secure-mint.ts';

/**
 * Slice of `SecureMintClient` the adapter relies on, anchored to the SDK
 * via `Pick<>` so a method-rename in `tenzro-sdk` breaks the build.
 */
export type SecureMintClientLike = Pick<
  SecureMintClient,
  'setPolicy' | 'getPolicy' | 'clearPolicy' | 'check' | 'apply' | 'recordBurn'
>;

export class SecureMintAdapter implements SecureMintPort {
  constructor(private readonly client: SecureMintClientLike) {}

  async setPolicy(policy: SecureMintPolicy): Promise<SecureMintPolicy> {
    const res = await this.client.setPolicy(encodePolicy(policy));
    return decodePolicy(res.policy);
  }

  async getPolicy(token: string): Promise<SecureMintPolicy | null> {
    const res = await this.client.getPolicy(token);
    return res.found && res.policy ? decodePolicy(res.policy) : null;
  }

  async clearPolicy(token: string): Promise<boolean> {
    const res = await this.client.clearPolicy(token);
    return res.cleared;
  }

  async checkMint(token: string, amount: bigint): Promise<SecureMintCheck> {
    const res = await this.client.check(token, amount.toString());
    return {
      allowed: res.allowed,
      token: res.token,
      amount: BigInt(res.amount),
      now: res.now,
      ...(res.reason !== undefined ? { reason: res.reason } : {}),
    };
  }

  async applyMint(token: string, amount: bigint): Promise<SecureMintApply> {
    const res = await this.client.apply(token, amount.toString());
    return {
      applied: res.applied,
      token: res.token,
      amount: BigInt(res.amount),
      policy: decodePolicy(res.policy),
    };
  }

  async recordBurn(token: string, amount: bigint): Promise<SecureMintApply> {
    const res = await this.client.recordBurn(token, amount.toString());
    return {
      applied: res.recorded,
      token: res.token,
      amount: BigInt(res.amount),
      policy: decodePolicy(res.policy),
    };
  }
}

function encodePolicy(policy: SecureMintPolicy): SdkPolicy {
  return {
    token: policy.token,
    asset_id: policy.assetId,
    reserve: policy.reserve.toString(),
    ...(policy.circulating !== undefined
      ? { circulating: policy.circulating.toString() }
      : {}),
    por_feed_id: policy.porFeedId,
    attester_did: policy.attesterDid,
    attestation_hash: policy.attestationHash,
    attested_at: policy.attestedAt,
    ttl_secs: policy.ttlSecs,
  };
}

function decodePolicy(raw: SdkPolicy): SecureMintPolicy {
  return {
    token: raw.token,
    assetId: raw.asset_id,
    reserve: BigInt(raw.reserve),
    ...(raw.circulating !== undefined ? { circulating: BigInt(raw.circulating) } : {}),
    porFeedId: raw.por_feed_id,
    attesterDid: raw.attester_did,
    attestationHash: raw.attestation_hash,
    attestedAt: raw.attested_at,
    ttlSecs: raw.ttl_secs,
  };
}
