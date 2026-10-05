/**
 * Agents rooted in this identity: their consensus Terms, root kind, status
 * and spend, as `tenzro_getAgentTerms` reports them. Agents are created and
 * their Terms changed by the identity passkey's approval of a node-issued
 * challenge (`PasskeyCustody.approveAgentTerms`).
 */

import type { JsonRpcTransport } from './rpc.ts';

/** `tenzro_getAgentTerms`: the agent's Terms, root kind, status and spend so far; null without Terms. */
export async function getAgentTerms(
  rpc: JsonRpcTransport,
  agentDid: string,
): Promise<RawAgentTermsView | null> {
  return rpc.call('tenzro_getAgentTerms', { agent_did: agentDid });
}

/** The node's answer to `tenzro_getAgentTerms`; amounts are decimal strings. */
export interface RawAgentTermsView {
  readonly agent_did: string;
  readonly root_kind: 'passkey' | 'machine';
  readonly status: 'active' | 'quarantined' | 'revoked' | 'expired';
  readonly version: number;
  readonly approval_digest: string;
  readonly updated_at_ms: number;
  readonly terms: Record<string, unknown>;
  readonly spent: {
    readonly today: string;
    readonly this_hour: string;
    readonly actions_today: number;
    readonly actions_this_hour: number;
    readonly remaining_today: string | null;
    readonly remaining_this_hour: string | null;
    readonly assets: readonly {
      asset: string;
      spent_today: string;
      remaining_today: string | null;
    }[];
  };
}
