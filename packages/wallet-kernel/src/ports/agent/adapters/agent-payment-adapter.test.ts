import { describe, expect, it } from 'vitest';
import { toHex } from '../../../custody/passkey/bytes.ts';
import { fromHex } from '../../../custody/passkey/bytes.ts';
import {
  type CustodyAuthorization,
  custodyChallengeDigest,
} from '../../../custody/passkey/gate.ts';
import type { AgentTermsChallenge } from '../agent-payment.ts';
import { type AgentTermsWire, agentTermsTarget } from '../agent-terms.ts';
import vectors from '../fixtures/agent-terms-targets.json' with { type: 'json' };
import {
  type AgentPaymentClientLike,
  AgentPaymentSdkAdapter,
  type AgentTermsClientLike,
} from './agent-payment-adapter.ts';

const cases = vectors.cases as unknown as {
  name: string;
  terms: AgentTermsWire;
  target: { delegate: string; update: string; update_rotate: string };
}[];

describe('agentTermsTarget matches the node', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(toHex(agentTermsTarget(c.terms))).toBe(c.target.delegate);
      expect(toHex(agentTermsTarget(c.terms, false))).toBe(c.target.update);
      expect(toHex(agentTermsTarget(c.terms, true))).toBe(c.target.update_rotate);
    });
  }
});

const base = cases[0]!.terms;
const requested: AgentTermsWire = {
  ...base,
  serving_nodes: base.serving_nodes.map((n) => ({ ...n, dpop_public_key: '', dpop_jkt: '' })),
  delegation_scope: { ...base.delegation_scope, max_daily_spend: '7000' },
};
const completed: AgentTermsWire = {
  ...requested,
  serving_nodes: requested.serving_nodes.map((n) => ({
    ...n,
    dpop_public_key: 'ab',
    dpop_jkt: 'cd',
  })),
};
const auth: CustodyAuthorization = {
  challenge_id: 'c1',
  credential_id_hex: '0x01',
  assertion: {} as CustodyAuthorization['assertion'],
};

function termsClient(returned: AgentTermsWire, seen: AgentTermsChallenge[]): AgentTermsClientLike {
  return {
    async updateAgentTerms(account, agentDid, _terms, rotate, authorize) {
      const target = agentTermsTarget(returned, rotate);
      const nonce = new Uint8Array(16).fill(7);
      const a = await authorize({
        challenge_id: 'c1',
        challenge_hex: toHex(
          custodyChallengeDigest(fromHex(account), 'update_agent_terms', target, nonce),
          true,
        ),
        nonce_hex: toHex(nonce, true),
        target_hex: toHex(target, true),
        account_address: account,
        expires_in_secs: 60,
        delegation: returned as unknown as Record<string, unknown>,
      });
      expect(a).toBe(auth);
      expect(rotate).toBe(true);
      return {
        agent_did: agentDid,
        delegation: returned as unknown as Record<string, unknown>,
        tokens_revoked: 2,
      };
    },
  };
}

const noSpend: AgentPaymentClientLike = { getTerms: async () => null };

describe('AgentPaymentSdkAdapter', () => {
  it('maps the Terms and spend; null when the agent has no terms', async () => {
    const a = new AgentPaymentSdkAdapter(
      {
        getTerms: async (did) => ({
          agent_did: did,
          root_kind: 'machine',
          status: 'active',
          version: 3,
          approval_digest: 'ab',
          updated_at_ms: 1,
          terms: { controller_did: 'did:tenzro:machine:m', agent_name: 'a', serving_nodes: [] },
          spent: {
            today: '40',
            this_hour: '5',
            actions_today: 2,
            actions_this_hour: 1,
            remaining_today: '60',
            remaining_this_hour: null,
            assets: [{ asset: '0x22', spent_today: '7', remaining_today: '3' }],
          },
        }),
      },
      termsClient(completed, []),
    );
    const view = await a.getTerms('did:a');
    expect(view).toMatchObject({
      agentDid: 'did:a',
      rootKind: 'machine',
      version: 3,
      spentToday: 40n,
      spentThisHour: 5n,
      remainingToday: 60n,
      remainingThisHour: null,
      assets: [{ asset: '0x22', spentToday: 7n, remainingToday: 3n }],
    });
    expect(
      await new AgentPaymentSdkAdapter(noSpend, termsClient(completed, [])).getTerms('x'),
    ).toBeNull();
  });

  it('signs a terms update only after the completed terms check out', async () => {
    const seen: AgentTermsChallenge[] = [];
    const a = new AgentPaymentSdkAdapter(noSpend, termsClient(completed, seen));
    const r = await a.updateAgentTerms({
      accountAddress: '0xaa',
      agentDid: 'did:tenzro:agent:example',
      terms: requested,
      rotateTokens: true,
      authorize: async (c) => {
        seen.push(c);
        return auth;
      },
    });
    expect(r.tokensRevoked).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.targetHex).toBe(toHex(agentTermsTarget(completed, true)));
  });

  it('refuses to sign when the node altered the limits', async () => {
    const altered: AgentTermsWire = {
      ...completed,
      delegation_scope: { ...completed.delegation_scope, max_daily_spend: '9000000' },
    };
    let asked = false;
    const a = new AgentPaymentSdkAdapter(noSpend, termsClient(altered, []));
    await expect(
      a.updateAgentTerms({
        accountAddress: '0xaa',
        agentDid: 'did:tenzro:agent:example',
        terms: requested,
        rotateTokens: true,
        authorize: async () => {
          asked = true;
          return auth;
        },
      }),
    ).rejects.toThrow(/differ from the ones requested/);
    expect(asked).toBe(false);
  });
});
