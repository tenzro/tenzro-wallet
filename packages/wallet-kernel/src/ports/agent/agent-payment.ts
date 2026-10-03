/**
 * AgentPaymentPort: a delegated agent's limits and its spend.
 *
 * An agent's limits are its terms in consensus. The controller changes them
 * with `tenzro_updateAgentTerms`, approved by a passkey on the account; the
 * node enforces them on every action. The wallet reads the spend and
 * originates the change; it never decides a limit itself.
 */

import type { CustodyAuthorization } from '../../custody/passkey/gate.ts';
import type { AgentTermsWire } from './agent-terms.ts';

export interface DailySpend {
  readonly agentDid: string;
  /** Spent today, wei. */
  readonly spentToday: bigint;
  /** The terms' daily limit, when they set one. */
  readonly dailyLimit: bigint | null;
  /** What the daily limit leaves, when the terms set one. */
  readonly remaining: bigint | null;
}

/** The challenge a terms change asks the passkey to sign. */
export interface AgentTermsChallenge {
  readonly challenge_id: string;
  readonly challenge_hex: string;
  readonly account_address: string;
  readonly expires_in_secs: number;
  /** The terms as the node completed them (serving nodes certified). */
  readonly delegation: AgentTermsWire;
  /** `agentTermsTarget(delegation, rotateTokens)`, hex: what the approval binds. */
  readonly targetHex: string;
}

export interface UpdateAgentTermsRequest {
  /** The controller's account. */
  readonly accountAddress: string;
  readonly agentDid: string;
  /** The full new terms. */
  readonly terms: AgentTermsWire;
  /** Also withdraw the agent's live access tokens. */
  readonly rotateTokens: boolean;
  /** Signs the challenge with a passkey on the account. */
  readonly authorize: (challenge: AgentTermsChallenge) => Promise<CustodyAuthorization>;
}

export interface AgentTermsUpdated {
  readonly agentDid: string;
  readonly delegation: AgentTermsWire;
  readonly tokensRevoked: number;
}

export interface AgentPaymentPort {
  getDailySpend(agentDid: string): Promise<DailySpend | null>;
  updateAgentTerms(req: UpdateAgentTermsRequest): Promise<AgentTermsUpdated>;
}
