/**
 * The agents and machines this identity roots, and the passkey approvals that
 * change them. Every approval is signed by the passkey the identity derives
 * from; the kernel checks what the node asks it to sign before it does.
 */

import { AuthClient } from 'tenzro-sdk';
import { type AgentTermsWire, type SpendGrant, agentWalletAddress } from 'tenzro-wallet';
import type { AgentStepUp, RawAgentTermsView, StepUpRequest } from 'tenzro-wallet/custody';
import { increaseAgentBond, postAgentBond, requiredAgentBondWei } from './native-tx';

import { rpcCall, sdkRpc } from './rpc';
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

/** The spend ceiling that sizes an agent's bond: its daily limit, else its per-payment one. */
export function spendCeilingWei(scope: {
  max_daily_spend?: string | null;
  max_transaction_value?: string | null;
}): bigint | null {
  const v = scope.max_daily_spend ?? scope.max_transaction_value;
  return v && /^\d+$/.test(v) ? BigInt(v) : null;
}

/**
 * Makes sure an agent's bond covers Terms with `scope`: posts one when none is
 * active, or tops up the difference, from the wallet's account and signed by
 * this device's passkey. The network refuses Terms its bond does not cover,
 * so this runs before the Terms are approved. Returns what was added.
 */
export async function ensureAgentBond(
  wallet: StoredWallet,
  agentDid: string,
  scope: { max_daily_spend?: string | null; max_transaction_value?: string | null },
): Promise<bigint> {
  const ceiling = spendCeilingWei(scope);
  if (ceiling === null) return 0n;
  const required = requiredAgentBondWei(ceiling);
  const bond = await getAgentBond(agentDid);
  const held = bond && bond.state === 'Active' ? BigInt(bond.amount) : 0n;
  if (held >= required) return 0n;
  const missing = required - held;
  if (bond && bond.state === 'Active') await increaseAgentBond(wallet, agentDid, missing);
  else await postAgentBond(wallet, agentDid, missing);
  return missing;
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
  return replaceTerms(wallet, view.agent_did, terms);
}

/** Approves a held action with the identity's passkey; returns the `step_up` the agent sends. */
export function approveStepUp(wallet: StoredWallet, request: StepUpRequest): Promise<AgentStepUp> {
  return custody().approveAgentStepUp(wallet, request);
}

/** The agent this identity roots whose wallet is `address`, with its Terms, or null. */
export async function findAgentByWallet(
  controllerDid: string,
  address: string,
): Promise<RawAgentTermsView | null> {
  const { agents } = await listRootedIdentities(controllerDid);
  for (const view of agents) {
    if ((await agentWalletAddress(view.agent_did)) === address.toLowerCase()) return view;
  }
  return null;
}

/** Replaces an agent's Terms with `next`, approved by this device's passkey and recorded in consensus. */
async function replaceTerms(
  wallet: StoredWallet,
  agentDid: string,
  terms: AgentTermsWire,
): Promise<unknown> {
  await ensureAgentBond(wallet, agentDid, terms.delegation_scope ?? {});
  const auth = new AuthClient(sdkRpc());
  return auth.updateAgentTerms(
    wallet.account,
    agentDid,
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

/**
 * Grants an agent an ERC-7715 spend limit: its hourly or daily ceiling in its
 * Terms, and their expiry. Everything else in the Terms stays.
 */
export function grantSpendLimit(
  wallet: StoredWallet,
  view: RawAgentTermsView,
  grant: SpendGrant,
): Promise<unknown> {
  const current = view.terms as unknown as AgentTermsWire;
  const terms: AgentTermsWire = {
    ...current,
    delegation_scope: {
      ...(current.delegation_scope ?? {}),
      ...(grant.window === 'hour'
        ? { max_hourly_spend: grant.amountWei.toString() }
        : { max_daily_spend: grant.amountWei.toString() }),
    },
    ...(grant.expiresAtMs !== null ? { expires_at_ms: grant.expiresAtMs } : {}),
  };
  return replaceTerms(wallet, view.agent_did, terms);
}

/** Withdraws an agent's ERC-7715 spend permission: its spend limits become zero. */
export function revokeSpendLimits(wallet: StoredWallet, view: RawAgentTermsView): Promise<unknown> {
  const current = view.terms as unknown as AgentTermsWire;
  return replaceTerms(wallet, view.agent_did, {
    ...current,
    delegation_scope: {
      ...(current.delegation_scope ?? {}),
      max_transaction_value: '0',
      max_hourly_spend: '0',
      max_daily_spend: '0',
    },
  });
}
