/**
 * PrincipalChainSdkAdapter — wraps `PrincipalChainClient` for read-only
 * access to receipt principal-chains (Spec 5) and controller activity
 * aggregates.
 *
 * Wire:
 *   getReceiptPrincipalChain  → PrincipalChainClient.getReceiptPrincipalChain(receiptId)
 *   listReceiptsByActor       → PrincipalChainClient.listReceiptsByActor(actorDid)
 *   listReceiptsByController  → PrincipalChainClient.listReceiptsByController(controllerDid)
 *   summarizeController       → PrincipalChainClient.summarizeController(controllerDid)
 */

import type { PrincipalChainClient } from 'tenzro-sdk';
import type {
  ControllerActivitySummaryRecord,
  IdentityType,
  PrincipalChainPort,
  PrincipalChainRecord,
  PrincipalChainSummaryRecord,
  PrincipalLink,
  PrincipalRole,
} from '../principal-chain.ts';

export type PrincipalChainClientLike = Pick<
  PrincipalChainClient,
  | 'getReceiptPrincipalChain'
  | 'listReceiptsByActor'
  | 'listReceiptsByController'
  | 'summarizeController'
>;

interface RawLink {
  did?: string;
  identity_type?: string;
  identityType?: string;
  delegation_scope_id?: string | null;
  delegationScopeId?: string | null;
  role?: string;
  tombstone?: boolean;
}

interface RawChain {
  actor?: string;
  chain?: RawLink[];
  controller?: RawLink;
  controller_kyc_tier?: number;
  controllerKycTier?: number;
  controller_bond?: string | number | null;
  controllerBond?: string | number | null;
  actor_bond?: string | number | null;
  actorBond?: string | number | null;
  controller_bond_aggregate?: string | number | null;
  controllerBondAggregate?: string | number | null;
  delegation_depth?: number;
  delegationDepth?: number;
  frozen_at_block?: string | number;
  frozenAtBlock?: string | number;
}

interface RawSummary {
  actor?: string;
  controller?: string;
  controller_kyc_tier?: number;
  controllerKycTier?: number;
  controller_bond?: string | number | null;
  controllerBond?: string | number | null;
  actor_bond?: string | number | null;
  actorBond?: string | number | null;
  controller_bond_aggregate?: string | number | null;
  controllerBondAggregate?: string | number | null;
  delegation_depth?: number;
  delegationDepth?: number;
  has_tombstone?: boolean;
  hasTombstone?: boolean;
  frozen_at_block?: string | number;
  frozenAtBlock?: string | number;
}

interface RawControllerSummary {
  controller_did?: string;
  controllerDid?: string;
  receipt_count?: string | number;
  receiptCount?: string | number;
  total_value_tnzo?: string | number;
  totalValueTnzo?: string | number;
  agents_acted_under?: string[];
  agentsActedUnder?: string[];
  kill_switch_events?: number;
  killSwitchEvents?: number;
  kyc_tier_at_oldest?: number;
  kycTierAtOldest?: number;
  kyc_tier_at_newest?: number;
  kycTierAtNewest?: number;
  bond_min?: string | number;
  bondMin?: string | number;
  bond_max?: string | number;
  bondMax?: string | number;
  since?: number | null;
  until?: number | null;
}

export class PrincipalChainSdkAdapter implements PrincipalChainPort {
  constructor(private readonly client: PrincipalChainClientLike) {}

  async getReceiptPrincipalChain(receiptId: string): Promise<PrincipalChainRecord | null> {
    const raw = (await this.client.getReceiptPrincipalChain(receiptId)) as RawChain | null;
    return raw === null || raw === undefined ? null : decodeChain(raw);
  }

  async listReceiptsByActor(actorDid: string): Promise<PrincipalChainSummaryRecord[]> {
    const raws = (await this.client.listReceiptsByActor(actorDid)) as
      | RawSummary[]
      | null
      | undefined;
    return decodeSummaryList(raws);
  }

  async listReceiptsByController(controllerDid: string): Promise<PrincipalChainSummaryRecord[]> {
    const raws = (await this.client.listReceiptsByController(controllerDid)) as
      | RawSummary[]
      | null
      | undefined;
    return decodeSummaryList(raws);
  }

  async summarizeController(
    controllerDid: string,
  ): Promise<ControllerActivitySummaryRecord | null> {
    const raw = (await this.client.summarizeController(
      controllerDid,
    )) as RawControllerSummary | null;
    return raw === null || raw === undefined ? null : decodeControllerSummary(raw);
  }
}

function decodeChain(raw: RawChain): PrincipalChainRecord | null {
  const actor = raw.actor;
  const controllerRaw = raw.controller;
  if (actor === undefined || controllerRaw === undefined) return null;
  const controller = decodeLink(controllerRaw);
  if (controller === null) return null;
  const chainRaws = raw.chain ?? [];
  const chain: PrincipalLink[] = [];
  for (const lr of chainRaws) {
    const link = decodeLink(lr);
    if (link !== null) chain.push(link);
  }
  const controllerBond = optBig(raw.controller_bond ?? raw.controllerBond);
  const actorBond = optBig(raw.actor_bond ?? raw.actorBond);
  const controllerBondAggregate = optBig(
    raw.controller_bond_aggregate ?? raw.controllerBondAggregate,
  );
  return {
    actor,
    chain: Object.freeze(chain),
    controller,
    controllerKycTier: raw.controller_kyc_tier ?? raw.controllerKycTier ?? 0,
    ...(controllerBond !== undefined ? { controllerBond } : {}),
    ...(actorBond !== undefined ? { actorBond } : {}),
    ...(controllerBondAggregate !== undefined ? { controllerBondAggregate } : {}),
    delegationDepth: raw.delegation_depth ?? raw.delegationDepth ?? 0,
    frozenAtBlock: BigInt(raw.frozen_at_block ?? raw.frozenAtBlock ?? 0),
  };
}

function decodeLink(raw: RawLink): PrincipalLink | null {
  if (raw.did === undefined) return null;
  const scopeRaw = raw.delegation_scope_id ?? raw.delegationScopeId;
  const delegationScopeId = scopeRaw === null ? undefined : scopeRaw;
  return {
    did: raw.did,
    identityType: normaliseIdentityType(raw.identity_type ?? raw.identityType),
    ...(delegationScopeId !== undefined ? { delegationScopeId } : {}),
    role: normaliseRole(raw.role),
    tombstone: raw.tombstone ?? false,
  };
}

function decodeSummaryList(raws: RawSummary[] | null | undefined): PrincipalChainSummaryRecord[] {
  if (!Array.isArray(raws)) return [];
  const out: PrincipalChainSummaryRecord[] = [];
  for (const raw of raws) {
    const rec = decodeSummary(raw);
    if (rec !== null) out.push(rec);
  }
  return out;
}

function decodeSummary(raw: RawSummary): PrincipalChainSummaryRecord | null {
  if (raw.actor === undefined || raw.controller === undefined) return null;
  const controllerBond = optBig(raw.controller_bond ?? raw.controllerBond);
  const actorBond = optBig(raw.actor_bond ?? raw.actorBond);
  const controllerBondAggregate = optBig(
    raw.controller_bond_aggregate ?? raw.controllerBondAggregate,
  );
  return {
    actor: raw.actor,
    controller: raw.controller,
    controllerKycTier: raw.controller_kyc_tier ?? raw.controllerKycTier ?? 0,
    ...(controllerBond !== undefined ? { controllerBond } : {}),
    ...(actorBond !== undefined ? { actorBond } : {}),
    ...(controllerBondAggregate !== undefined ? { controllerBondAggregate } : {}),
    delegationDepth: raw.delegation_depth ?? raw.delegationDepth ?? 0,
    hasTombstone: raw.has_tombstone ?? raw.hasTombstone ?? false,
    frozenAtBlock: BigInt(raw.frozen_at_block ?? raw.frozenAtBlock ?? 0),
  };
}

function decodeControllerSummary(
  raw: RawControllerSummary,
): ControllerActivitySummaryRecord | null {
  const controllerDid = raw.controller_did ?? raw.controllerDid;
  if (controllerDid === undefined) return null;
  const agents = raw.agents_acted_under ?? raw.agentsActedUnder ?? [];
  const since = raw.since === null || raw.since === undefined ? undefined : raw.since;
  const until = raw.until === null || raw.until === undefined ? undefined : raw.until;
  return {
    controllerDid,
    receiptCount: BigInt(raw.receipt_count ?? raw.receiptCount ?? 0),
    totalValueTnzo: BigInt(raw.total_value_tnzo ?? raw.totalValueTnzo ?? 0),
    agentsActedUnder: Object.freeze([...agents]),
    killSwitchEvents: raw.kill_switch_events ?? raw.killSwitchEvents ?? 0,
    kycTierAtOldest: raw.kyc_tier_at_oldest ?? raw.kycTierAtOldest ?? 0,
    kycTierAtNewest: raw.kyc_tier_at_newest ?? raw.kycTierAtNewest ?? 0,
    bondMin: BigInt(raw.bond_min ?? raw.bondMin ?? 0),
    bondMax: BigInt(raw.bond_max ?? raw.bondMax ?? 0),
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
  };
}

function optBig(v: string | number | null | undefined): bigint | undefined {
  if (v === null || v === undefined) return undefined;
  return BigInt(v);
}

function normaliseRole(raw: string | undefined): PrincipalRole {
  switch ((raw ?? '').toLowerCase()) {
    case 'controller':
      return 'controller';
    case 'delegatedagent':
    case 'delegated_agent':
      return 'delegated_agent';
    case 'autonomousagent':
    case 'autonomous_agent':
      return 'autonomous_agent';
    default:
      return 'controller';
  }
}

function normaliseIdentityType(raw: string | undefined): IdentityType {
  switch ((raw ?? '').toLowerCase()) {
    case 'human':
      return 'human';
    case 'machine':
      return 'machine';
    default:
      return 'machine';
  }
}
