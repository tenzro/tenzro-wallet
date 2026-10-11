/**
 * Agents act for a person under terms that person's passkey approves:
 * spending limits, the counterparties they may pay, and an expiry. An agent
 * is always delegated by a human passkey; there is no other way to make one
 * here.
 */

import { type AgentTerms, AuthClient, type DelegatedAgent, type RpcClient } from 'tenzro-sdk';

import { type Wallet, authorize, signerOf } from './account';
import { isAccount, parseTnzo } from './bytes';

export interface AgentForm {
  readonly name: string;
  /** TNZO, decimal text. */
  readonly maxPerTransaction: string;
  /** TNZO, decimal text. */
  readonly maxPerDay: string;
  /** Accounts the agent may pay, one per line or comma-separated; empty for none. */
  readonly allowList: string;
  /** The node that serves the agent: its machine DID and its operator's DID. */
  readonly machineDid: string;
  readonly operatorDid: string;
  readonly days: number;
}

/** The terms the person approves, checked before any passkey is asked. */
export function agentTerms(controllerDid: string, form: AgentForm, nowMs: number): AgentTerms {
  const name = form.name.trim();
  if (!name) throw new Error('Name the agent.');
  const perTx = parseTnzo(form.maxPerTransaction);
  const perDay = parseTnzo(form.maxPerDay);
  if (perTx === 0n || perDay === 0n) throw new Error('Limits must be above zero.');
  if (perTx > perDay) throw new Error('The per-transaction limit cannot exceed the daily limit.');
  const allowed = form.allowList
    .split(/[\s,]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  const bad = allowed.find((a) => !isAccount(a));
  if (bad) throw new Error(`Not an account: ${bad}`);
  if (!form.machineDid.startsWith('did:') || !form.operatorDid.startsWith('did:')) {
    throw new Error('Name the serving node by its machine DID and its operator DID.');
  }
  if (!Number.isInteger(form.days) || form.days < 1 || form.days > 365) {
    throw new Error('Choose between 1 and 365 days.');
  }
  return {
    controller_did: controllerDid,
    agent_name: name,
    delegation_scope: {
      max_transaction_value: perTx.toString(),
      max_daily_spend: perDay.toString(),
      ...(allowed.length ? { allowed_counterparties: allowed.map((a) => a.toLowerCase()) } : {}),
    },
    serving_nodes: [{ machine_did: form.machineDid.trim(), operator_did: form.operatorDid.trim() }],
    min_distinct_operators: 1,
    expires_at_ms: nowMs + form.days * 86_400_000,
  };
}

/**
 * The node completes the terms (each serving node's key) and returns them in
 * the challenge the passkey signs. The wallet signs only when what came back
 * says exactly what the person approved: same controller, agent, limits,
 * counterparties, serving nodes and expiry.
 */
export function checkCompletedTerms(asked: AgentTerms, completed: unknown): void {
  const c = completed as Partial<AgentTerms> | undefined;
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  const nodes = (n: AgentTerms['serving_nodes'] | undefined) =>
    (n ?? []).map((x) => ({ machine_did: x.machine_did, operator_did: x.operator_did }));
  if (
    !c ||
    c.controller_did !== asked.controller_did ||
    c.agent_name !== asked.agent_name ||
    !same(c.delegation_scope, asked.delegation_scope) ||
    !same(nodes(c.serving_nodes), nodes(asked.serving_nodes)) ||
    c.expires_at_ms !== asked.expires_at_ms
  ) {
    throw new Error('The node returned different terms than you approved. Nothing was signed.');
  }
}

/** JSON with sorted keys, where an absent, null or empty value reads the same. */
function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.length ? x.map(norm) : undefined;
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(x).sort()) {
        const n = norm((x as Record<string, unknown>)[k]);
        if (n !== undefined && n !== null) out[k] = n;
      }
      return out;
    }
    return x ?? undefined;
  };
  return JSON.stringify(norm(v) ?? null);
}

/** The person's passkey approves the terms; the node issues the agent. */
export function delegate(
  rpc: RpcClient,
  wallet: Wallet,
  terms: AgentTerms,
): Promise<DelegatedAgent> {
  const signer = signerOf(wallet);
  return new AuthClient(rpc).delegateAgent(wallet.account, terms, (challenge) => {
    checkCompletedTerms(terms, challenge.delegation);
    return authorize(wallet, challenge, signer);
  });
}

export function revoke(rpc: RpcClient, wallet: Wallet, agentDid: string) {
  const signer = signerOf(wallet);
  return new AuthClient(rpc).revokeDelegatedAgent(wallet.account, agentDid, (challenge) =>
    authorize(wallet, challenge, signer),
  );
}

export interface AgentRecord {
  readonly did: string;
  readonly name: string;
  readonly address: string;
  readonly expiresAtMs: number | null;
}

const AGENTS_KEY = 'agents';

export function loadAgents(): AgentRecord[] {
  try {
    return JSON.parse(localStorage.getItem(AGENTS_KEY) ?? '[]') as AgentRecord[];
  } catch {
    return [];
  }
}

export function saveAgents(agents: AgentRecord[]): void {
  try {
    localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
  } catch {
    // Remembering the list is a convenience; the chain holds the agents.
  }
}
