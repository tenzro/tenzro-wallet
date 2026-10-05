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

/** A delegated agent's Terms as consensus holds them, and its spend against them. */
export interface AgentTermsState {
  readonly agentDid: string;
  /** What approved the Terms: a person's passkey or a machine's TPM / Secure Enclave key. */
  readonly rootKind: 'passkey' | 'machine';
  readonly status: 'active' | 'quarantined' | 'revoked' | 'expired';
  /** Increments with every approved change. */
  readonly version: number;
  readonly terms: AgentTermsWire;
  /** Spent today and this clock hour, wei. */
  readonly spentToday: bigint;
  readonly spentThisHour: bigint;
  readonly actionsToday: number;
  readonly actionsThisHour: number;
  /** What the daily and hourly limits leave, when the Terms set them. */
  readonly remainingToday: bigint | null;
  readonly remainingThisHour: bigint | null;
  /** Per limited asset, in its base units. */
  readonly assets: readonly { asset: string; spentToday: bigint; remainingToday: bigint | null }[];
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
  getTerms(agentDid: string): Promise<AgentTermsState | null>;
  updateAgentTerms(req: UpdateAgentTermsRequest): Promise<AgentTermsUpdated>;
}
