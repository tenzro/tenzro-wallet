/**
 * AgentBondPort — TNZO bonds posted by a controller against a specific
 * agent DID (Agent-Swarm Spec 9).
 *
 * A bond locks TNZO into a deterministically-derived vault address
 * (`Address(SHA-256("tenzro/agent-bond/vault" || agent_did))`) and,
 * while Active and ≥ `bond_min_for_promotion`, promotes the bonded
 * agent to the Delegated admission lane. Withdrawal initiates a
 * cooldown timer; finalisation happens off-VM via the node-side
 * `BondManager` once `cooldown_ms` has elapsed.
 *
 * Per `reference_tenzro_architecture.md` and SDK `bond.ts`:
 *
 *   • PostAgentBond     selector 0x01000020, ~75k gas
 *   • IncreaseAgentBond selector 0x01000021, ~60k gas
 *   • WithdrawAgentBond selector 0x01000022, ~50k gas
 *
 * The wallet wraps the SDK's `BondClient`; the SDK already owns the
 * canonical typed-tx encoding and routes through
 * `tenzro_signAndSendTransaction` for hybrid signing.
 */

export type AgentBondStatus = 'active' | 'cooldown' | 'withdrawn' | 'slashed';

export interface AgentBondRecord {
  /** 32-byte bond identifier (lowercase hex). */
  readonly bondId: string;
  /** DID of the bonded agent. */
  readonly agentDid: string;
  /** DID of the controller that posted the bond. */
  readonly controllerDid: string;
  /** Controller wallet address (the original `tx.from`). */
  readonly controller: string;
  /** Current bonded amount, in TNZO base units. */
  readonly amount: bigint;
  /** Total slashed-from-this-bond, in TNZO base units. */
  readonly slashedAmount: bigint;
  readonly status: AgentBondStatus;
  /** Unix-ms when the bond was first posted. */
  readonly postedAt: number;
  /**
   * Unix-ms when withdraw was initiated; only set when
   * `status === 'cooldown'`. Funds release after this + cooldown_ms.
   */
  readonly withdrawInitiatedAt?: number;
  /** Unix-ms when funds become withdrawable; only set when status === 'cooldown'. */
  readonly cooldownEndsAt?: number;
}

export interface PostAgentBondRequest {
  /** Controller wallet address (signer / `tx.from`). */
  readonly controller: string;
  /** DID of the agent being bonded. */
  readonly agentDid: string;
  /** DID of the controller posting the bond. */
  readonly controllerDid: string;
  /** TNZO base units to lock. */
  readonly amount: bigint;
}

export interface IncreaseAgentBondRequest {
  readonly controller: string;
  readonly agentDid: string;
  readonly amount: bigint;
}

export interface WithdrawAgentBondRequest {
  readonly controller: string;
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
  get(bondId: string): Promise<AgentBondRecord | null>;

  /** Enumerate every bond posted by a controller DID. */
  listByController(controllerDid: string): Promise<AgentBondRecord[]>;
}
