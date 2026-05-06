/**
 * LifecyclePort — read access to agent lifecycle state and the
 * kill-switch audit trail (Agent-Swarm Spec 1).
 *
 * The kill-switch records every `PauseAgent` / `QuarantineAgent` /
 * `TerminateAgent` precompile fire as a `KillSwitchReceipt`, indexed by
 * both `agent_did` and `controller_did`. Receipt id derivation is
 * deterministic:
 * `id = SHA-256("tenzro/killswitch/receipt" || action || agent_did ||
 *  controller_did || block_height_le)`.
 *
 * `AgentLifecycleInfo` is the runtime FSM state (Created → Initializing
 * → Active → Suspended | Paused | Quarantined → Terminated). Read-only
 * here; mutations flow through `TerminateAgent` etc. typed transactions.
 */

export type AgentState =
  | 'created'
  | 'initializing'
  | 'active'
  | 'suspended'
  | 'paused'
  | 'quarantined'
  | 'terminated';

export type KillSwitchAction = 'pause' | 'quarantine' | 'terminate';

export interface AgentLifecycleRecord {
  readonly agentId: string;
  readonly state: AgentState;
  /** ISO-8601 last state-change timestamp. */
  readonly lastStateChange: string;
  /** ISO-8601 last heartbeat, when the agent has reported one. */
  readonly lastHeartbeat?: string;
  /** Ordered list of `(state, isoTimestamp)` for the agent's history. */
  readonly stateHistory: ReadonlyArray<{
    readonly state: AgentState;
    readonly at: string;
  }>;
}

export interface KillSwitchReceiptRecord {
  /** 32-byte deterministic receipt id (lowercase hex). */
  readonly receiptId: string;
  readonly action: KillSwitchAction;
  /** DID of the agent the action targeted. */
  readonly agentDid: string;
  /** DID of the controller / committee that authorised the action. */
  readonly controllerDid: string;
  /** Canonical reason code (see kill-switch spec §"Reason codes"). */
  readonly reasonCode: number;
  /** Free-form reason text, capped 256 bytes by the tx validator. */
  readonly reasonText?: string;
  /** Optional 32-byte SHA-256 hex commitment to off-chain evidence. */
  readonly evidenceHash?: string;
  /** Set only on `terminate` — basis points of stake slashed. */
  readonly slashBps?: number;
  /** Set only on `terminate` — whether descendants were cascaded. */
  readonly cascade?: boolean;
  /** Set only on `pause` — auto-resume deadline (unix seconds). */
  readonly pauseUntil?: number;
  /** Block height at which the action was finalised. */
  readonly frozenAtBlock: bigint;
  /** Wall-clock timestamp of finalisation, unix-ms. */
  readonly timestamp: number;
}

export interface LifecyclePort {
  /**
   * Returns the current `AgentLifecycleRecord` (state, transitions,
   * heartbeat). Returns null for unknown agents.
   */
  getLifecycle(agentId: string): Promise<AgentLifecycleRecord | null>;

  /** Inspect a single kill-switch receipt by id. Returns null if unknown. */
  getKillSwitchReceipt(receiptId: string): Promise<KillSwitchReceiptRecord | null>;

  /** Every kill-switch receipt whose target is `agentId`. */
  listKillSwitchByAgent(agentId: string): Promise<KillSwitchReceiptRecord[]>;

  /** Every kill-switch receipt authored by `controllerDid`. */
  listKillSwitchByController(controllerDid: string): Promise<KillSwitchReceiptRecord[]>;
}
