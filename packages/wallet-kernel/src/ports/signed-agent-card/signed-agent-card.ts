/**
 * SignedAgentCardPort — A2A v1.0 Signed Agent Card.
 *
 * Wallet usage: when an agent publishes its Agent Card under a domain
 * the agent owns, it signs the canonical SHA-256 hash of the card with
 * its JWS key. Relying parties recompute the hash and verify the
 * signature before trusting the card's claims (skills, endpoints,
 * identity).
 */

export interface AgentCard {
  readonly name: string;
  readonly description?: string;
  readonly version?: string;
  readonly url?: string;
  readonly skills?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface CanonicalHashResult {
  readonly canonicalHashHex: string;
  readonly agentCardName: string;
  readonly agentCardUrl: string;
  readonly protocolVersion: string;
  readonly skillsCount: number;
}

export interface SignedAgentCardPort {
  canonicalHash(card: AgentCard): Promise<CanonicalHashResult>;
}
