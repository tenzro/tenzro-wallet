/**
 * LifecycleSdkAdapter — wraps `LifecycleClient` so the kernel can read
 * agent lifecycle state and the kill-switch audit trail without owning
 * the RPC field shape.
 *
 * Wire:
 *   getLifecycle              → LifecycleClient.getAgentLifecycle(agentId)
 *   getKillSwitchReceipt      → LifecycleClient.getKillSwitchReceipt(receiptId)
 *   listKillSwitchByAgent     → LifecycleClient.listKillSwitchByAgent(agentId)
 *   listKillSwitchByController → LifecycleClient.listKillSwitchByController(controllerDid)
 *
 * All four are read-only; mutations land via `TerminateAgent` etc. typed
 * transactions and are out of scope for this port.
 */

import type { LifecycleClient } from 'tenzro-sdk';
import type {
  AgentLifecycleRecord,
  AgentState,
  KillSwitchAction,
  KillSwitchReceiptRecord,
  LifecyclePort,
} from '../lifecycle.ts';

export type LifecycleClientLike = Pick<
  LifecycleClient,
  | 'getAgentLifecycle'
  | 'getKillSwitchReceipt'
  | 'listKillSwitchByAgent'
  | 'listKillSwitchByController'
>;

interface RawLifecycle {
  agent_id?: string;
  agentId?: string;
  state?: string;
  last_state_change?: string;
  lastStateChange?: string;
  last_heartbeat?: string | null;
  lastHeartbeat?: string | null;
  state_history?: Array<[string, string] | { state?: string; at?: string }>;
  stateHistory?: Array<[string, string] | { state?: string; at?: string }>;
}

interface RawReceipt {
  receipt_id?: string;
  receiptId?: string;
  action?: string;
  agent_did?: string;
  agentDid?: string;
  controller_did?: string;
  controllerDid?: string;
  reason_code?: number;
  reasonCode?: number;
  reason_text?: string | null;
  reasonText?: string | null;
  evidence_hash?: string | null;
  evidenceHash?: string | null;
  slash_bps?: number | null;
  slashBps?: number | null;
  cascade?: boolean | null;
  pause_until?: number | null;
  pauseUntil?: number | null;
  frozen_at_block?: string | number;
  frozenAtBlock?: string | number;
  timestamp?: number;
}

export class LifecycleSdkAdapter implements LifecyclePort {
  constructor(private readonly client: LifecycleClientLike) {}

  async getLifecycle(agentId: string): Promise<AgentLifecycleRecord | null> {
    const raw = (await this.client.getAgentLifecycle(agentId)) as RawLifecycle | null;
    return raw === null || raw === undefined ? null : decodeLifecycle(raw);
  }

  async getKillSwitchReceipt(receiptId: string): Promise<KillSwitchReceiptRecord | null> {
    const raw = (await this.client.getKillSwitchReceipt(receiptId)) as RawReceipt | null;
    return raw === null || raw === undefined ? null : decodeReceipt(raw);
  }

  async listKillSwitchByAgent(agentId: string): Promise<KillSwitchReceiptRecord[]> {
    const raws = (await this.client.listKillSwitchByAgent(agentId)) as
      | RawReceipt[]
      | null
      | undefined;
    return decodeReceiptList(raws);
  }

  async listKillSwitchByController(controllerDid: string): Promise<KillSwitchReceiptRecord[]> {
    const raws = (await this.client.listKillSwitchByController(controllerDid)) as
      | RawReceipt[]
      | null
      | undefined;
    return decodeReceiptList(raws);
  }
}

function decodeLifecycle(raw: RawLifecycle): AgentLifecycleRecord | null {
  const agentId = raw.agent_id ?? raw.agentId;
  if (agentId === undefined) return null;
  const lastChange = raw.last_state_change ?? raw.lastStateChange ?? '';
  const heartbeat = raw.last_heartbeat ?? raw.lastHeartbeat;
  const historyRaw = raw.state_history ?? raw.stateHistory ?? [];
  const stateHistory: { state: AgentState; at: string }[] = [];
  for (const entry of historyRaw) {
    if (Array.isArray(entry)) {
      stateHistory.push({ state: normaliseState(entry[0]), at: entry[1] ?? '' });
    } else {
      stateHistory.push({ state: normaliseState(entry.state), at: entry.at ?? '' });
    }
  }
  const lastHeartbeat = heartbeat === null ? undefined : heartbeat;
  return {
    agentId,
    state: normaliseState(raw.state),
    lastStateChange: lastChange,
    ...(lastHeartbeat !== undefined ? { lastHeartbeat } : {}),
    stateHistory: Object.freeze(stateHistory),
  };
}

function decodeReceiptList(raws: RawReceipt[] | null | undefined): KillSwitchReceiptRecord[] {
  if (!Array.isArray(raws)) return [];
  const out: KillSwitchReceiptRecord[] = [];
  for (const raw of raws) {
    const rec = decodeReceipt(raw);
    if (rec !== null) out.push(rec);
  }
  return out;
}

function decodeReceipt(raw: RawReceipt): KillSwitchReceiptRecord | null {
  const receiptId = raw.receipt_id ?? raw.receiptId;
  const action = normaliseAction(raw.action);
  if (receiptId === undefined || action === null) return null;
  const reasonTextRaw = raw.reason_text ?? raw.reasonText;
  const evidenceHashRaw = raw.evidence_hash ?? raw.evidenceHash;
  const slashBpsRaw = raw.slash_bps ?? raw.slashBps;
  const cascadeRaw = raw.cascade;
  const pauseUntilRaw = raw.pause_until ?? raw.pauseUntil;
  const frozenAtRaw = raw.frozen_at_block ?? raw.frozenAtBlock;
  const reasonText = reasonTextRaw === null ? undefined : reasonTextRaw;
  const evidenceHash = evidenceHashRaw === null ? undefined : evidenceHashRaw;
  const slashBps = slashBpsRaw === null || slashBpsRaw === undefined ? undefined : slashBpsRaw;
  const cascade = cascadeRaw === null || cascadeRaw === undefined ? undefined : cascadeRaw;
  const pauseUntil =
    pauseUntilRaw === null || pauseUntilRaw === undefined ? undefined : pauseUntilRaw;
  return {
    receiptId,
    action,
    agentDid: raw.agent_did ?? raw.agentDid ?? '',
    controllerDid: raw.controller_did ?? raw.controllerDid ?? '',
    reasonCode: raw.reason_code ?? raw.reasonCode ?? 0,
    ...(reasonText !== undefined ? { reasonText } : {}),
    ...(evidenceHash !== undefined ? { evidenceHash } : {}),
    ...(slashBps !== undefined ? { slashBps } : {}),
    ...(cascade !== undefined ? { cascade } : {}),
    ...(pauseUntil !== undefined ? { pauseUntil } : {}),
    frozenAtBlock: frozenAtRaw !== undefined ? BigInt(frozenAtRaw) : 0n,
    timestamp: raw.timestamp ?? 0,
  };
}

function normaliseState(raw: string | undefined): AgentState {
  switch ((raw ?? '').toLowerCase()) {
    case 'created':
      return 'created';
    case 'initializing':
      return 'initializing';
    case 'active':
      return 'active';
    case 'suspended':
      return 'suspended';
    case 'paused':
      return 'paused';
    case 'quarantined':
      return 'quarantined';
    case 'terminated':
      return 'terminated';
    default:
      return 'created';
  }
}

function normaliseAction(raw: string | undefined): KillSwitchAction | null {
  switch ((raw ?? '').toLowerCase()) {
    case 'pause':
      return 'pause';
    case 'quarantine':
      return 'quarantine';
    case 'terminate':
      return 'terminate';
    default:
      return null;
  }
}
