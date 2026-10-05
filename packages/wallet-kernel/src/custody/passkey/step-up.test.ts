/**
 * Step-up digests against the node's own vectors (tenzro-types
 * `AgentAction::digest`, copied from sdk/fixtures/agent_terms/vectors.json).
 */

import { describe, expect, it } from 'vitest';

import vectors from '../../ports/agent/fixtures/agent-actions.json' with { type: 'json' };
import { toHex } from './bytes.ts';
import {
  type AgentActionWire,
  agentActionDigest,
  checkStepUp,
  parseStepUpRequest,
} from './step-up.ts';
import { PasskeyError } from './webauthn.ts';

const cases = vectors.cases as unknown as {
  name: string;
  action: AgentActionWire;
  digest: string;
}[];
const unshowable = (a: AgentActionWire) => a.escrow != null || a.remote_grant != null;

describe('agentActionDigest', () => {
  it.each(cases.filter((c) => !unshowable(c.action)).map((c) => [c.name, c] as const))(
    'matches the node for "%s"',
    (_name, c) => {
      expect(toHex(agentActionDigest(c.action))).toBe(c.digest);
    },
  );

  it('covers payments, contract calls, assets, ballots and veto signals', () => {
    const shown = cases.filter((c) => !unshowable(c.action)).map((c) => c.action);
    expect(shown.some((a) => a.payment)).toBe(true);
    expect(shown.some((a) => (a.calls ?? []).length > 0)).toBe(true);
    expect(shown.some((a) => a.asset)).toBe(true);
    expect(shown.some((a) => a.ballot)).toBe(true);
    expect(shown.some((a) => a.veto_signal)).toBe(true);
    expect(shown.some((a) => a.tainted)).toBe(true);
  });

  it('refuses a JSON number that lost precision', () => {
    const big = cases.find((c) => c.name === 'amount beyond 2^53 at the limit')!.action;
    expect(() => agentActionDigest({ ...big, nonce: Number(big.nonce) })).toThrow(PasskeyError);
  });

  it('refuses escrow and remote-grant actions rather than sign them unseen', () => {
    const hidden = cases.filter((c) => unshowable(c.action));
    expect(hidden.length).toBeGreaterThan(0);
    for (const c of hidden) expect(() => agentActionDigest(c.action)).toThrow(PasskeyError);
  });
});

describe('checkStepUp', () => {
  const action = cases[0]!.action;

  it('refuses a challenge that is not an agent step-up', () => {
    const step_up = {
      controller_operation: 'update_agent_terms',
      account: '00'.repeat(32),
      nonce: '00'.repeat(16),
      target: '00'.repeat(32),
      challenge_hex: '00'.repeat(32),
      action_nonce: 7,
    };
    expect(() => checkStepUp({ action, step_up })).toThrow(PasskeyError);
  });

  it('parses the step_up error data as the node returns it, nested or not', () => {
    const step_up = {
      controller_operation: 'agent_step_up',
      account: 'aa',
      nonce: 'bb',
      target: 'cc',
      challenge_hex: 'dd',
      action_nonce: 7,
    };
    expect(parseStepUpRequest({ action, step_up: { step_up } }).step_up).toEqual(step_up);
    expect(parseStepUpRequest(JSON.stringify({ action, step_up })).step_up).toEqual(step_up);
    expect(() => parseStepUpRequest({ step_up })).toThrow(PasskeyError);
    // The node's data carries the held action itself: nothing else is needed.
    const held = parseStepUpRequest({ step_up: { step_up: { ...step_up, action } } });
    expect(held.action).toEqual(action);
  });
});
