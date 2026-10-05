/**
 * The agents and machines this identity roots, and the passkey approvals that
 * change them. Every approval is signed by the passkey the identity derives
 * from; the kernel checks what the node asks it to sign before it does.
 */

import { AuthClient, RpcClient } from 'tenzro-sdk';
import type { AgentTermsWire } from 'tenzro-wallet';
import type { AgentStepUp, RawAgentTermsView, StepUpRequest } from 'tenzro-wallet/custody';

import { TENZRO_RPC_URL } from './config';
import { rpcCall } from './rpc';
import { type StoredWallet, custody } from './wallet';

/** A machine registered under this identity that is not an agent with Terms. */
export interface RootedMachine {
  readonly did: string;
  readonly status: string;
  readonly displayName: string | null;
}

export interface RootedIdentities {
  readonly agents: RawAgentTermsView[];
  readonly machines: RootedMachine[];
}

/**
 * Everything `controllerDid` roots (`tenzro_resolveIdentity` with the record):
 * agents with their consensus Terms (`tenzro_getAgentTerms`), and the other
 * machines it controls.
 */
export async function listRootedIdentities(controllerDid: string): Promise<RootedIdentities> {
  const res = await rpcCall<{
    record?: { identity_data?: { Human?: { controlled_machines?: string[] } } };
  }>('tenzro_resolveIdentity', { did: controllerDid, include_record: true });
  const dids = res.record?.identity_data?.Human?.controlled_machines ?? [];
  const rows = await Promise.all(
    dids.map(async (did) => {
      const terms = await rpcCall<RawAgentTermsView | null>('tenzro_getAgentTerms', {
        agent_did: did,
      });
      if (terms) return { agent: terms } as const;
      const id = await rpcCall<{ status?: string; display_name?: string | null }>(
        'tenzro_resolveIdentity',
        {
          did,
        },
      );
      return {
        machine: { did, status: id.status ?? 'unknown', displayName: id.display_name ?? null },
      } as const;
    }),
  );
  return {
    agents: rows.flatMap((r) => ('agent' in r ? [r.agent] : [])),
    machines: rows.flatMap((r) => ('machine' in r ? [r.machine] : [])),
  };
}

/** An agent's bond in chain state (`tenzro_getAgentBond`), null when none is posted. */
export interface AgentBondView {
  readonly amount: string;
  readonly state: 'Active' | 'Cooldown' | 'Slashed' | 'Returned' | 'Burned';
  readonly cooldown_until_ms: number | null;
}

export function getAgentBond(agentDid: string): Promise<AgentBondView | null> {
  return rpcCall('tenzro_getAgentBond', { agent_did: agentDid });
}

/** Spend limits in wei; null removes the limit. */
export interface SpendLimits {
  readonly perPayment: string | null;
  readonly perHour: string | null;
  readonly perDay: string | null;
}

/**
 * Replaces an agent's spend limits, everything else in its Terms unchanged.
 * The node completes the new Terms and issues the challenge; the passkey
 * approves only those Terms, and the node records them in consensus.
 */
export async function updateAgentLimits(
  wallet: StoredWallet,
  view: RawAgentTermsView,
  limits: SpendLimits,
): Promise<unknown> {
  const current = view.terms as unknown as AgentTermsWire;
  const terms: AgentTermsWire = {
    ...current,
    delegation_scope: {
      ...(current.delegation_scope ?? {}),
      max_transaction_value: limits.perPayment,
      max_hourly_spend: limits.perHour,
      max_daily_spend: limits.perDay,
    },
  };
  const auth = new AuthClient(new RpcClient(TENZRO_RPC_URL));
  return auth.updateAgentTerms(
    wallet.account,
    view.agent_did,
    terms as never,
    false,
    async (challenge) =>
      custody().approveAgentTerms(wallet, {
        operation: 'update_agent_terms',
        terms,
        rotateTokens: false,
        challenge: challenge as never,
      }) as never,
  );
}

/** Approves a held action with the identity's passkey; returns the `step_up` the agent sends. */
export function approveStepUp(wallet: StoredWallet, request: StepUpRequest): Promise<AgentStepUp> {
  return custody().approveAgentStepUp(wallet, request);
}
