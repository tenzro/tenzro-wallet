/**
 * Agent terms and their custody target.
 *
 * `agentTermsTarget` is the digest the node binds a `delegate_agent` or
 * `update_agent_terms` approval to: SHA-256 over the terms, each field
 * length-prefixed (u32 big-endian) in a fixed order, with optional sections
 * appended only when set. It must match the node byte for byte; the vectors in
 * `fixtures/agent-terms-targets.json` pin it.
 */

import { sha256 } from '@noble/hashes/sha2.js';

const TERMS_DOMAIN = 'tenzro/delegate-agent/terms';

export interface ServingNodeTerms {
  readonly machine_did: string;
  readonly operator_did: string;
  readonly dpop_public_key?: string;
  readonly dpop_jkt?: string;
  readonly key_certification?: string;
  readonly sealing_public_key?: string;
}

export interface RemoteLimitTerms {
  readonly caip19: string;
  readonly max_per_day: string;
}

export interface AssetLimitTerms {
  readonly asset: string;
  readonly max_per_tx?: string | null;
  readonly max_per_day: string;
}

export interface ContractTerms {
  readonly code_hash: string;
  readonly selectors?: readonly string[];
}

export interface GovernanceTerms {
  readonly domains?: readonly string[];
  readonly may_vote?: boolean;
  readonly may_veto_signal?: boolean;
  readonly may_originate?: boolean;
  readonly max_weight_bps?: number;
  readonly policy_hash?: string;
}

/** What a delegated agent may do. Amounts are wei, canonical decimal. */
export interface TermsScope {
  readonly max_transaction_value?: string | null;
  readonly max_daily_spend?: string | null;
  readonly allowed_operations?: readonly string[];
  readonly allowed_payment_protocols?: readonly string[];
  readonly allowed_chains?: readonly string[];
  readonly allowed_models?: readonly string[];
  readonly allowed_counterparties?: readonly string[];
  readonly max_hourly_spend?: string | null;
  readonly max_actions_per_hour?: number | null;
  readonly max_actions_per_day?: number | null;
  readonly allowed_hours_utc?: readonly [number, number] | null;
  readonly step_up_above?: string | null;
  readonly step_up_new_counterparty?: boolean;
  readonly tainted_value_limit?: string | null;
  readonly remote_grant_ttl_ms?: number | null;
  readonly remote_limits?: readonly RemoteLimitTerms[];
  readonly cosign_above?: string | null;
  readonly asset_limits?: readonly AssetLimitTerms[];
  readonly min_contract_assurance?: number;
  readonly allowed_contracts?: readonly ContractTerms[];
  readonly governance?: GovernanceTerms | null;
}

/** A delegated agent's terms, in the node's JSON shape. */
export interface AgentTermsWire {
  readonly controller_did: string;
  readonly agent_name: string;
  readonly delegation_scope?: TermsScope;
  readonly capabilities?: readonly string[];
  readonly serving_nodes: readonly ServingNodeTerms[];
  readonly min_distinct_operators?: number;
  readonly expires_at_ms?: number | null;
  readonly trifecta_exception?: boolean;
}

const enc = new TextEncoder();

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

type Hasher = ReturnType<typeof sha256.create>;

function put(h: Hasher, value: string | Uint8Array): void {
  const bytes = typeof value === 'string' ? enc.encode(value) : value;
  h.update(u32(bytes.length));
  h.update(bytes);
}

function putList(h: Hasher, items: readonly string[] | undefined): void {
  const list = items ?? [];
  h.update(u32(list.length));
  for (const item of list) put(h, item);
}

const opt = (v: string | null | undefined): string => v ?? '';
const count = (v: number | null | undefined): string => (v == null ? '' : String(v));
const some = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/**
 * The custody target of `terms`. `rotate` is omitted for `delegate_agent`, and
 * is the token-rotation flag for `update_agent_terms`.
 */
export function agentTermsTarget(terms: AgentTermsWire, rotate?: boolean): Uint8Array {
  const s: TermsScope = terms.delegation_scope ?? {};
  const h = sha256.create();
  h.update(enc.encode(TERMS_DOMAIN));
  put(h, terms.controller_did);
  put(h, terms.agent_name);
  put(h, opt(s.max_transaction_value));
  put(h, opt(s.max_daily_spend));
  putList(h, s.allowed_operations);
  putList(h, s.allowed_payment_protocols);
  putList(h, s.allowed_chains);
  putList(h, terms.capabilities);
  h.update(u32(terms.serving_nodes.length));
  for (const n of terms.serving_nodes) {
    put(h, n.machine_did);
    put(h, n.operator_did);
    put(h, n.dpop_public_key ?? '');
    put(h, n.dpop_jkt ?? '');
    put(h, n.key_certification ?? '');
  }
  put(h, String(terms.min_distinct_operators ?? 1));
  put(h, count(terms.expires_at_ms));
  if (rotate !== undefined) put(h, rotate ? 'rotate' : '');
  const models = s.allowed_models ?? [];
  const counterparties = s.allowed_counterparties ?? [];
  if (models.length > 0 || counterparties.length > 0) {
    put(h, 'ext');
    putList(h, models);
    putList(h, counterparties);
  }
  if (
    some(s.max_hourly_spend) ||
    some(s.max_actions_per_hour) ||
    some(s.max_actions_per_day) ||
    some(s.allowed_hours_utc)
  ) {
    put(h, 'velocity');
    put(h, opt(s.max_hourly_spend));
    put(h, count(s.max_actions_per_hour));
    put(h, count(s.max_actions_per_day));
    put(h, s.allowed_hours_utc ? `${s.allowed_hours_utc[0]}-${s.allowed_hours_utc[1]}` : '');
  }
  if (some(s.step_up_above) || s.step_up_new_counterparty) {
    put(h, 'step-up');
    put(h, opt(s.step_up_above));
    put(h, s.step_up_new_counterparty ? 'new-counterparty' : '');
  }
  if (terms.trifecta_exception) put(h, 'trifecta-exception');
  if (some(s.tainted_value_limit)) {
    put(h, 'tainted-value-limit');
    put(h, s.tainted_value_limit);
  }
  const remote = s.remote_limits ?? [];
  if (some(s.remote_grant_ttl_ms) || remote.length > 0 || some(s.cosign_above)) {
    put(h, 'remote');
    put(h, count(s.remote_grant_ttl_ms));
    h.update(u32(remote.length));
    for (const l of remote) {
      put(h, l.caip19);
      put(h, l.max_per_day);
    }
    put(h, opt(s.cosign_above));
  }
  const assets = s.asset_limits ?? [];
  if (assets.length > 0) {
    put(h, 'assets');
    h.update(u32(assets.length));
    for (const l of assets) {
      put(h, l.asset);
      put(h, opt(l.max_per_tx));
      put(h, l.max_per_day);
    }
  }
  const contracts = s.allowed_contracts ?? [];
  if ((s.min_contract_assurance ?? 0) !== 0 || contracts.length > 0) {
    put(h, 'contracts');
    put(h, String(s.min_contract_assurance ?? 0));
    h.update(u32(contracts.length));
    for (const c of contracts) {
      put(h, c.code_hash);
      putList(h, c.selectors);
    }
  }
  if (s.governance) {
    const g = s.governance;
    put(h, 'governance');
    putList(h, g.domains);
    h.update(new Uint8Array([g.may_vote ? 1 : 0, g.may_veto_signal ? 1 : 0, g.may_originate ? 1 : 0]));
    const bps = new Uint8Array(2);
    new DataView(bps.buffer).setUint16(0, g.max_weight_bps ?? 0, false);
    h.update(bps);
    put(h, g.policy_hash ?? '');
  }
  return h.digest();
}
