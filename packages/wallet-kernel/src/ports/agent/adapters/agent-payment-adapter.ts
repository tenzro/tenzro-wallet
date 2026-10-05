/**
 * AgentPaymentSdkAdapter: `AgentPaymentClient.getTerms` for the Terms and spend, and
 * `AuthClient.updateAgentTerms` for limits.
 *
 * Before the passkey signs a terms change, the adapter checks that the terms
 * the node completed are the ones requested: the node may only fill in the
 * serving nodes' certified keys. Equal custody targets, with the completed
 * serving nodes substituted into the request, prove nothing else moved.
 */

import type { AgentPaymentClient, AuthClient } from 'tenzro-sdk';
import { fromHex, toHex } from '../../../custody/passkey/bytes.ts';
import { type CustodyAuthorization, custodyChallengeDigest } from '../../../custody/passkey/gate.ts';
import type { RawAgentTermsView } from '../../../custody/passkey/machines.ts';
import type {
  AgentPaymentPort,
  AgentTermsState,
  AgentTermsUpdated,
  UpdateAgentTermsRequest,
} from '../agent-payment.ts';
import { type AgentTermsWire, agentTermsTarget } from '../agent-terms.ts';

interface RawChallenge {
  challenge_id: string;
  challenge_hex: string;
  account_address: string;
  /** The 16-byte nonce and the target the digest binds, `0x` hex. */
  nonce_hex: string;
  target_hex: string;
  expires_in_secs: number;
  delegation?: Record<string, unknown>;
}

interface RawTermsUpdate {
  agent_did: string;
  delegation: Record<string, unknown>;
  tokens_revoked?: number;
}

export interface AgentPaymentClientLike {
  getTerms(agentDid: string): Promise<RawAgentTermsView | null>;
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

  async getTerms(agentDid: string): Promise<AgentTermsState | null> {
    const raw = await this.spend.getTerms(agentDid);
    if (!raw) return null;
    const s = raw.spent;
    return {
      agentDid: raw.agent_did,
      rootKind: raw.root_kind,
      status: raw.status,
      version: raw.version,
      terms: raw.terms as unknown as AgentTermsWire,
      spentToday: BigInt(s.today),
      spentThisHour: BigInt(s.this_hour),
      actionsToday: s.actions_today,
      actionsThisHour: s.actions_this_hour,
      remainingToday: big(s.remaining_today),
      remainingThisHour: big(s.remaining_this_hour),
      assets: s.assets.map((a) => ({
        asset: a.asset,
        spentToday: BigInt(a.spent_today),
        remainingToday: big(a.remaining_today),
      })),
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
        const strip = (h: string) => h.replace(/^0x/, '').toLowerCase();
        const nonce = fromHex(challenge.nonce_hex ?? '');
        const digest = custodyChallengeDigest(
          fromHex(req.accountAddress),
          'update_agent_terms',
          fromHex(targetHex),
          nonce,
        );
        if (
          nonce.length !== 16 ||
          strip(challenge.target_hex ?? '') !== strip(targetHex) ||
          strip(challenge.challenge_hex) !== toHex(digest)
        ) {
          throw new Error('The node issued a challenge for different terms than the ones checked; nothing was signed.');
        }
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
