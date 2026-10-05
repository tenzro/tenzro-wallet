/**
 * AgentBondPort: the TNZO bond a controller posts against one agent.
 *
 * An agent's Terms require a bond of at least the network's share of their
 * spend ceiling; a bond withdrawn below that stops the agent. The bond is
 * locked in a vault derived from the agent DID and read from chain state.
 * Writes are PostAgentBond / IncreaseAgentBond / WithdrawAgentBond typed
 * transactions the controller signs; reads go through the SDK's `BondClient`.
 */

/** A bond's state in chain state. */
export type AgentBondState = 'active' | 'cooldown' | 'slashed' | 'returned' | 'burned';

/** One agent bond as chain state holds it; one bond per agent. */
export interface AgentBondRecord {
  readonly agentDid: string;
  readonly controllerDid: string;
  /** Wei the bond holds. */
  readonly amount: bigint;
  readonly state: AgentBondState;
  /** When a withdrawal's cooldown ends, ms; null when none is running. */
  readonly cooldownUntilMs: number | null;
  /** The bond vault, hex. */
  readonly vault: string;
}

export interface PostAgentBondRequest {
  /** DID of the agent being bonded. */
  readonly agentDid: string;
  /** DID of the controller posting the bond. */
  readonly controllerDid: string;
  /** TNZO base units to lock. */
  readonly amount: bigint;
}

export interface IncreaseAgentBondRequest {
  readonly agentDid: string;
  readonly amount: bigint;
}

export interface WithdrawAgentBondRequest {
  readonly agentDid: string;
}

export interface AgentBondPort {
  /** Lock funds and (when ≥ promotion threshold) lift the agent to the
   *  Delegated lane. Returns the submission tx hash. */
  post(req: PostAgentBondRequest): Promise<string>;

  /** Top up an existing Active bond. Returns the submission tx hash. */
  increase(req: IncreaseAgentBondRequest): Promise<string>;

  /** Initiate the withdrawal cooldown. Returns the submission tx hash.
   *  Funds are released off-VM via `BondManager` after `cooldown_ms`. */
  withdraw(req: WithdrawAgentBondRequest): Promise<string>;

  /** Inspect a bond by its 32-byte id. Returns null if unknown. */
  get(agentDid: string): Promise<AgentBondRecord | null>;

  /** Enumerate every bond posted by a controller DID. */
  listByController(controllerDid: string): Promise<AgentBondRecord[]>;
}
