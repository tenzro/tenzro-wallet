/**
 * AgentBondSdkAdapter — wraps `BondClient` so the kernel can drive the
 * Agent-Swarm Spec 9 bond primitive without owning the typed-tx encoding.
 *
 * Writes are typed transactions the controller signs:
 *   post     → PostAgentBond { agent_did, controller_did, amount }
 *   increase → IncreaseAgentBond { agent_did, amount }
 *   withdraw → WithdrawAgentBond { agent_did }
 * Reads: BondClient.getAgentBond(bondId), listAgentBondsByController(controllerDid).
 */

import type { BondClient, HybridSigner } from 'tenzro-sdk';
import type {
  AgentBondPort,
  AgentBondRecord,
  AgentBondStatus,
  IncreaseAgentBondRequest,
  PostAgentBondRequest,
  WithdrawAgentBondRequest,
} from '../agent-bond.ts';
import { type TypedTxSender, txHash, u128 } from './typed-tx.ts';

/**
 * Slice of `BondClient` the adapter relies on, anchored to the SDK via
 * `Pick<>` so a method-rename in `tenzro-sdk` breaks the build.
 */
export type BondClientLike = Pick<
  BondClient,
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
  constructor(
    private readonly client: BondClientLike,
    private readonly tx: TypedTxSender,
    private readonly signer: HybridSigner,
  ) {}

  async post(req: PostAgentBondRequest): Promise<string> {
    return txHash(
      await this.tx.send(this.signer, {
        kind: 'PostAgentBond',
        fields: {
          agent_did: req.agentDid,
          controller_did: req.controllerDid,
          amount: u128(req.amount, 'amount'),
        },
      }),
    );
  }

  async increase(req: IncreaseAgentBondRequest): Promise<string> {
    return txHash(
      await this.tx.send(this.signer, {
        kind: 'IncreaseAgentBond',
        fields: { agent_did: req.agentDid, amount: u128(req.amount, 'amount') },
      }),
    );
  }

  async withdraw(req: WithdrawAgentBondRequest): Promise<string> {
    return txHash(
      await this.tx.send(this.signer, {
        kind: 'WithdrawAgentBond',
        fields: { agent_did: req.agentDid },
      }),
    );
  }

  async get(bondId: string): Promise<AgentBondRecord | null> {
    const raw = (await this.client.getAgentBond(bondId)) as RawAgentBond | null;
    return raw === null || raw === undefined ? null : decodeBond(raw);
  }

  async listByController(controllerDid: string): Promise<AgentBondRecord[]> {
    const wrapped = await this.client.listAgentBondsByController(controllerDid);
    const raws = (wrapped?.bonds ?? []) as RawAgentBond[];
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
