/**
 * AgentBondSdkAdapter — wraps `BondClient` so the kernel can drive the
 * Agent-Swarm Spec 9 bond primitive without owning the typed-tx encoding.
 *
 * Writes are typed transactions the controller signs:
 *   post     → PostAgentBond { agent_did, controller_did, amount }
 *   increase → IncreaseAgentBond { agent_did, amount }
 *   withdraw → WithdrawAgentBond { agent_did }
 * Reads: BondClient.getAgentBond(agentDid), listAgentBondsByController(controllerDid),
 * the bond records in chain state.
 */

import type { AgentBond, BondClient, HybridSigner } from 'tenzro-sdk';
import type {
  AgentBondPort,
  AgentBondRecord,
  AgentBondState,
  IncreaseAgentBondRequest,
  PostAgentBondRequest,
  WithdrawAgentBondRequest,
} from '../agent-bond.ts';
import { type TypedTxSender, txHash, u128 } from './typed-tx.ts';

/**
 * Slice of `BondClient` the adapter relies on, anchored to the SDK via
 * `Pick<>` so a method-rename in `tenzro-sdk` breaks the build.
 */
export type BondClientLike = Pick<BondClient, 'getAgentBond' | 'listAgentBondsByController'>;

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

  async get(agentDid: string): Promise<AgentBondRecord | null> {
    const raw = await this.client.getAgentBond(agentDid);
    return raw ? decodeBond(raw) : null;
  }

  async listByController(controllerDid: string): Promise<AgentBondRecord[]> {
    const list = await this.client.listAgentBondsByController(controllerDid);
    return list.bonds.map(decodeBond);
  }
}

const STATE: Record<AgentBond['state'], AgentBondState> = {
  Active: 'active',
  Cooldown: 'cooldown',
  Slashed: 'slashed',
  Returned: 'returned',
  Burned: 'burned',
};

function decodeBond(raw: AgentBond): AgentBondRecord {
  return {
    agentDid: raw.agent_did,
    controllerDid: raw.controller_did,
    amount: BigInt(raw.amount),
    state: STATE[raw.state],
    cooldownUntilMs: raw.cooldown_until_ms,
    vault: raw.vault,
  };
}
