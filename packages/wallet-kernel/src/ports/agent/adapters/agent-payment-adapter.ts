/**
 * AgentPaymentSdkAdapter: `AgentPaymentClient.getDailySpend` for the spend and
 * `AuthClient.updateAgentTerms` for limits.
 *
 * Before the passkey signs a terms change, the adapter checks that the terms
 * the node completed are the ones requested: the node may only fill in the
 * serving nodes' certified keys. Equal custody targets, with the completed
 * serving nodes substituted into the request, prove nothing else moved.
 */

import type { AgentPaymentClient, AuthClient } from 'tenzro-sdk';
import { toHex } from '../../../custody/passkey/bytes.ts';
import type { CustodyAuthorization } from '../../../custody/passkey/gate.ts';
import type {
  AgentPaymentPort,
  AgentTermsUpdated,
  DailySpend,
  UpdateAgentTermsRequest,
} from '../agent-payment.ts';
import { type AgentTermsWire, agentTermsTarget } from '../agent-terms.ts';

interface RawDailySpend {
  agent_did: string;
  current_daily_spend: string;
  max_daily_spend: string | null;
  remaining: string | null;
}

interface RawChallenge {
  challenge_id: string;
  challenge_hex: string;
  account_address: string;
  expires_in_secs: number;
  delegation?: Record<string, unknown>;
}

interface RawTermsUpdate {
  agent_did: string;
  delegation: Record<string, unknown>;
  tokens_revoked?: number;
}

export interface AgentPaymentClientLike {
  getDailySpend(agentDid: string): Promise<RawDailySpend | null>;
}

export interface AgentTermsClientLike {
  updateAgentTerms(
    accountAddress: string,
    agentDid: string,
    terms: AgentTermsWire,
    rotateTokens: boolean,
    authorize: (challenge: RawChallenge) => Promise<CustodyAuthorization>,
  ): Promise<RawTermsUpdate>;
}

const big = (v: string | null): bigint | null => (v === null ? null : BigInt(v));

/** Refuses completed terms that differ from `requested` in anything but serving-node keys. */
export function checkCompletedTerms(
  requested: AgentTermsWire,
  completed: AgentTermsWire,
  rotateTokens: boolean,
): string {
  const target = toHex(agentTermsTarget(completed, rotateTokens));
  const expected = toHex(
    agentTermsTarget({ ...requested, serving_nodes: completed.serving_nodes }, rotateTokens),
  );
  if (target !== expected) {
    throw new Error('The node returned terms that differ from the ones requested; nothing was signed.');
  }
  const ids = (t: AgentTermsWire) =>
    t.serving_nodes.map((n) => `${n.machine_did}|${n.operator_did}`).join(',');
  if (ids(requested) !== ids(completed)) {
    throw new Error('The node changed the serving nodes; nothing was signed.');
  }
  return target;
}

export class AgentPaymentSdkAdapter implements AgentPaymentPort {
  constructor(
    private readonly spend: AgentPaymentClientLike,
    private readonly terms: AgentTermsClientLike,
  ) {}

  static fromClients(spend: AgentPaymentClient, auth: AuthClient): AgentPaymentSdkAdapter {
    return new AgentPaymentSdkAdapter(
      spend as unknown as AgentPaymentClientLike,
      auth as unknown as AgentTermsClientLike,
    );
  }

  async getDailySpend(agentDid: string): Promise<DailySpend | null> {
    const raw = await this.spend.getDailySpend(agentDid);
    if (!raw) return null;
    return {
      agentDid: raw.agent_did,
      spentToday: BigInt(raw.current_daily_spend),
      dailyLimit: big(raw.max_daily_spend),
      remaining: big(raw.remaining),
    };
  }

  async updateAgentTerms(req: UpdateAgentTermsRequest): Promise<AgentTermsUpdated> {
    const raw = await this.terms.updateAgentTerms(
      req.accountAddress,
      req.agentDid,
      req.terms,
      req.rotateTokens,
      async (challenge) => {
        if (!challenge.delegation) {
          throw new Error('The node returned no completed terms; nothing was signed.');
        }
        const delegation = challenge.delegation as unknown as AgentTermsWire;
        const targetHex = checkCompletedTerms(req.terms, delegation, req.rotateTokens);
        return req.authorize({
          challenge_id: challenge.challenge_id,
          challenge_hex: challenge.challenge_hex,
          account_address: challenge.account_address,
          expires_in_secs: challenge.expires_in_secs,
          delegation,
          targetHex,
        });
      },
    );
    return {
      agentDid: raw.agent_did,
      delegation: raw.delegation as unknown as AgentTermsWire,
      tokensRevoked: raw.tokens_revoked ?? 0,
    };
  }
}
