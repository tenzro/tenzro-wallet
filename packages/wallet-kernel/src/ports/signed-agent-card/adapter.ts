/**
 * SignedAgentCardAdapter — `SignedAgentCardPort` backed by `tenzro-sdk`
 * `SignedAgentCardClient`.
 */

import type { SignedAgentCardClient } from 'tenzro-sdk';
import type {
  AgentCard,
  CanonicalHashResult,
  SignedAgentCardPort,
} from './signed-agent-card.ts';

export type SignedAgentCardClientLike = Pick<
  SignedAgentCardClient,
  'canonicalHash'
>;

export class SignedAgentCardAdapter implements SignedAgentCardPort {
  constructor(private readonly client: SignedAgentCardClientLike) {}

  async canonicalHash(card: AgentCard): Promise<CanonicalHashResult> {
    const r = await this.client.canonicalHash(card);
    return {
      canonicalHashHex: r.canonical_hash_hex,
      agentCardName: r.agent_card_name,
      agentCardUrl: r.agent_card_url,
      protocolVersion: r.protocol_version,
      skillsCount: r.skills_count,
    };
  }
}
