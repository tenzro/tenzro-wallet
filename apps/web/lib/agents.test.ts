import { describe, expect, it } from 'vitest';

import { type AgentForm, agentTerms, checkCompletedTerms } from './agents';
import { parseTnzo } from './bytes';

const FORM: AgentForm = {
  name: 'Groceries',
  maxPerTransaction: '2.5',
  maxPerDay: '10',
  allowList: `0x${'ab'.repeat(20)}\n0x${'CD'.repeat(20)}`,
  machineDid: 'did:tenzro:machine:node1',
  operatorDid: 'did:tenzro:human:op',
  days: 30,
};

describe('agent terms', () => {
  it('turns the form into limits in base units, an allow-list and an expiry', () => {
    const t = agentTerms('did:tenzro:human:alex', FORM, 1000);
    expect(t.controller_did).toBe('did:tenzro:human:alex');
    expect(t.delegation_scope?.max_transaction_value).toBe('2500000000000000000');
    expect(t.delegation_scope?.max_daily_spend).toBe('10000000000000000000');
    expect(t.delegation_scope?.allowed_counterparties).toEqual([
      `0x${'ab'.repeat(20)}`,
      `0x${'cd'.repeat(20)}`,
    ]);
    expect(t.serving_nodes).toEqual([
      { machine_did: 'did:tenzro:machine:node1', operator_did: 'did:tenzro:human:op' },
    ]);
    expect(t.expires_at_ms).toBe(1000 + 30 * 86_400_000);
  });

  it('refuses terms a person should not approve by mistake', () => {
    const bad: Partial<AgentForm>[] = [
      { name: ' ' },
      { maxPerTransaction: '11' },
      { maxPerDay: '0' },
      { allowList: 'not-an-account' },
      { machineDid: 'node1' },
      { days: 0 },
    ];
    for (const patch of bad) {
      expect(() => agentTerms('did:x', { ...FORM, ...patch }, 0)).toThrow();
    }
  });

  it('leaves the allow-list out when none is given', () => {
    const t = agentTerms('did:x', { ...FORM, allowList: '' }, 0);
    expect(t.delegation_scope).not.toHaveProperty('allowed_counterparties');
  });

  it('signs only terms the node completed without changing them', () => {
    const asked = agentTerms('did:x', FORM, 0);
    const completed = {
      ...asked,
      serving_nodes: asked.serving_nodes.map((n) => ({ ...n, dpop_jkt: 'jkt' })),
      delegation_scope: { ...asked.delegation_scope, allowed_chains: [] },
    };
    expect(() => checkCompletedTerms(asked, completed)).not.toThrow();
    expect(() =>
      checkCompletedTerms(asked, {
        ...completed,
        delegation_scope: { ...asked.delegation_scope, max_daily_spend: '99999999999999999999' },
      }),
    ).toThrow(/different terms/);
    expect(() => checkCompletedTerms(asked, { ...completed, controller_did: 'did:y' })).toThrow();
    expect(() => checkCompletedTerms(asked, undefined)).toThrow();
  });
});

describe('amounts', () => {
  it('parses TNZO to base units', () => {
    expect(parseTnzo('1')).toBe(10n ** 18n);
    expect(parseTnzo('0.000000000000000001')).toBe(1n);
    expect(() => parseTnzo('1.2.3')).toThrow();
    expect(() => parseTnzo('-1')).toThrow();
  });
});
