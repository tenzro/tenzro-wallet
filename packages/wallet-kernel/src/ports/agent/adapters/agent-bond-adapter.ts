/**
 * AgentBondSdkAdapter — wraps `BondClient` so the kernel can drive the
 * Agent-Swarm Spec 9 bond primitive without owning the typed-tx encoding.
 *
 * Wire:
 *   post     → BondClient.postAgentBond(controller, agentDid, controllerDid, amount)
 *   increase → BondClient.increaseAgentBond(controller, agentDid, amount)
 *   withdraw → BondClient.withdrawAgentBond(controller, agentDid)
 *   get      → BondClient.getAgentBond(bondId)
 *   list     → BondClient.listAgentBondsByController(controllerDid)
 *
 * The SDK already handles `tenzro_signAndSendTransaction` routing for
 * hybrid (server-side MPC) signing, so we forward verbatim.
 */

import type { BondClient } from 'tenzro-sdk';
import type {
  AgentBondPort,
  AgentBondRecord,
  AgentBondStatus,
  IncreaseAgentBondRequest,
  PostAgentBondRequest,
  WithdrawAgentBondRequest,
} from '../agent-bond.ts';

/**
 * Slice of `BondClient` the adapter relies on, anchored to the SDK via
 * `Pick<>` so a method-rename in `tenzro-sdk` breaks the build.
 */
export type BondClientLike = Pick<
  BondClient,
  | 'postAgentBond'
  | 'increaseAgentBond'
  | 'withdrawAgentBond'
  | 'getAgentBond'
  | 'listAgentBondsByController'
>;

interface RawAgentBond {
  bond_id?: string;
  bondId?: string;
  agent_did?: string;
  agentDid?: string;
  controller_did?: string;
  controllerDid?: string;
  controller?: string;
  amount?: string | number;
  slashed_amount?: string | number;
  slashedAmount?: string | number;
  status?: string;
  posted_at?: number;
  postedAt?: number;
  withdraw_initiated_at?: number;
  withdrawInitiatedAt?: number;
  cooldown_ends_at?: number;
  cooldownEndsAt?: number;
}

export class AgentBondSdkAdapter implements AgentBondPort {
  constructor(private readonly client: BondClientLike) {}

  post(req: PostAgentBondRequest): Promise<string> {
    return this.client.postAgentBond(req.controller, req.agentDid, req.controllerDid, req.amount);
  }

  increase(req: IncreaseAgentBondRequest): Promise<string> {
    return this.client.increaseAgentBond(req.controller, req.agentDid, req.amount);
  }

  withdraw(req: WithdrawAgentBondRequest): Promise<string> {
    return this.client.withdrawAgentBond(req.controller, req.agentDid);
  }

  async get(bondId: string): Promise<AgentBondRecord | null> {
    const raw = (await this.client.getAgentBond(bondId)) as RawAgentBond | null;
    return raw === null || raw === undefined ? null : decodeBond(raw);
  }

  async listByController(controllerDid: string): Promise<AgentBondRecord[]> {
    const raws = (await this.client.listAgentBondsByController(controllerDid)) as
      | RawAgentBond[]
      | null
      | undefined;
    if (!Array.isArray(raws)) return [];
    const out: AgentBondRecord[] = [];
    for (const raw of raws) {
      const rec = decodeBond(raw);
      if (rec !== null) out.push(rec);
    }
    return out;
  }
}

function decodeBond(raw: RawAgentBond): AgentBondRecord | null {
  const bondId = raw.bond_id ?? raw.bondId;
  const agentDid = raw.agent_did ?? raw.agentDid;
  if (bondId === undefined || agentDid === undefined) return null;
  const withdrawInitiatedAt = raw.withdraw_initiated_at ?? raw.withdrawInitiatedAt;
  const cooldownEndsAt = raw.cooldown_ends_at ?? raw.cooldownEndsAt;
  return {
    bondId,
    agentDid,
    controllerDid: raw.controller_did ?? raw.controllerDid ?? '',
    controller: raw.controller ?? '',
    amount: raw.amount !== undefined ? BigInt(raw.amount) : 0n,
    slashedAmount:
      (raw.slashed_amount ?? raw.slashedAmount) !== undefined
        ? BigInt(raw.slashed_amount ?? raw.slashedAmount ?? 0)
        : 0n,
    status: normaliseStatus(raw.status),
    postedAt: raw.posted_at ?? raw.postedAt ?? 0,
    ...(withdrawInitiatedAt !== undefined ? { withdrawInitiatedAt } : {}),
    ...(cooldownEndsAt !== undefined ? { cooldownEndsAt } : {}),
  };
}

function normaliseStatus(raw: string | undefined): AgentBondStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'active':
      return 'active';
    case 'cooldown':
      return 'cooldown';
    case 'withdrawn':
      return 'withdrawn';
    case 'slashed':
      return 'slashed';
    default:
      return 'active';
  }
}
