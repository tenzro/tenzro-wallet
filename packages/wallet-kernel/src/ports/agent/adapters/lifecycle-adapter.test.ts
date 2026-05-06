/**
 * Pin Lifecycle adapter — read-only kill-switch + lifecycle queries.
 * Both snake_case and camelCase RPC field shapes decode; unknown
 * action/state strings fall through; tuple-form state_history entries
 * are accepted alongside object-form.
 */

import { describe, expect, it } from 'vitest';
import { type LifecycleClientLike, LifecycleSdkAdapter } from './lifecycle-adapter.ts';

function fakeClient(overrides: Partial<LifecycleClientLike> = {}): {
  client: LifecycleClientLike;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: LifecycleClientLike = {
    getAgentLifecycle: async (id) => {
      calls.push({ method: 'getAgentLifecycle', args: [id] });
      return null;
    },
    getKillSwitchReceipt: async (id) => {
      calls.push({ method: 'getKillSwitchReceipt', args: [id] });
      return null;
    },
    listKillSwitchByAgent: async (id) => {
      calls.push({ method: 'listKillSwitchByAgent', args: [id] });
      return [];
    },
    listKillSwitchByController: async (did) => {
      calls.push({ method: 'listKillSwitchByController', args: [did] });
      return [];
    },
    ...overrides,
  };
  return { client, calls };
}

describe('LifecycleSdkAdapter.getLifecycle', () => {
  it('returns null on unknown agent', async () => {
    const { client } = fakeClient();
    const adapter = new LifecycleSdkAdapter(client);
    expect(await adapter.getLifecycle('did:tenzro:machine:0xc:a')).toBeNull();
  });

  it('decodes snake_case with tuple state_history', async () => {
    const { client } = fakeClient({
      getAgentLifecycle: async () => ({
        agent_id: 'did:tenzro:machine:0xc:a',
        state: 'Active',
        last_state_change: '2026-05-04T10:00:00Z',
        last_heartbeat: '2026-05-04T10:05:00Z',
        state_history: [
          ['Created', '2026-05-04T09:55:00Z'],
          ['Initializing', '2026-05-04T09:56:00Z'],
          ['Active', '2026-05-04T10:00:00Z'],
        ],
      }),
    });
    const adapter = new LifecycleSdkAdapter(client);
    const rec = await adapter.getLifecycle('did:tenzro:machine:0xc:a');
    expect(rec?.agentId).toBe('did:tenzro:machine:0xc:a');
    expect(rec?.state).toBe('active');
    expect(rec?.lastHeartbeat).toBe('2026-05-04T10:05:00Z');
    expect(rec?.stateHistory).toEqual([
      { state: 'created', at: '2026-05-04T09:55:00Z' },
      { state: 'initializing', at: '2026-05-04T09:56:00Z' },
      { state: 'active', at: '2026-05-04T10:00:00Z' },
    ]);
  });

  it('decodes object-form state_history entries', async () => {
    const { client } = fakeClient({
      getAgentLifecycle: async () => ({
        agent_id: 'did:tenzro:machine:0xc:a',
        state: 'Quarantined',
        last_state_change: '2026-05-04T10:00:00Z',
        last_heartbeat: null,
        state_history: [
          { state: 'Active', at: '2026-05-04T09:00:00Z' },
          { state: 'Quarantined', at: '2026-05-04T10:00:00Z' },
        ],
      }),
    });
    const adapter = new LifecycleSdkAdapter(client);
    const rec = await adapter.getLifecycle('did:tenzro:machine:0xc:a');
    expect(rec?.state).toBe('quarantined');
    expect(rec?.lastHeartbeat).toBeUndefined();
    expect(rec?.stateHistory[1]?.state).toBe('quarantined');
  });
});

describe('LifecycleSdkAdapter.getKillSwitchReceipt', () => {
  it('returns null on unknown receipt', async () => {
    const { client } = fakeClient();
    const adapter = new LifecycleSdkAdapter(client);
    expect(await adapter.getKillSwitchReceipt('0xnope')).toBeNull();
  });

  it('decodes a Terminate receipt with slash + cascade', async () => {
    const { client } = fakeClient({
      getKillSwitchReceipt: async () => ({
        receipt_id: '0xrec',
        action: 'Terminate',
        agent_did: 'did:tenzro:machine:0xc:a',
        controller_did: 'did:tenzro:human:xyz',
        reason_code: 1004,
        reason_text: 'misbehaviour: receipt forgery',
        evidence_hash: '0xevidence',
        slash_bps: 1000,
        cascade: true,
        frozen_at_block: '12345',
        timestamp: 1700000000,
      }),
    });
    const adapter = new LifecycleSdkAdapter(client);
    const rec = await adapter.getKillSwitchReceipt('0xrec');
    expect(rec?.action).toBe('terminate');
    expect(rec?.reasonCode).toBe(1004);
    expect(rec?.slashBps).toBe(1000);
    expect(rec?.cascade).toBe(true);
    expect(rec?.frozenAtBlock).toBe(12345n);
    expect(rec?.pauseUntil).toBeUndefined();
  });

  it('decodes a Pause receipt with auto-resume deadline (pause_until)', async () => {
    const { client } = fakeClient({
      getKillSwitchReceipt: async () => ({
        receipt_id: '0xpause',
        action: 'Pause',
        agent_did: 'did:tenzro:machine:0xc:a',
        controller_did: 'did:tenzro:human:xyz',
        reason_code: 200,
        pause_until: 1700001234,
        frozen_at_block: '99',
        timestamp: 1700000000,
      }),
    });
    const adapter = new LifecycleSdkAdapter(client);
    const rec = await adapter.getKillSwitchReceipt('0xpause');
    expect(rec?.action).toBe('pause');
    expect(rec?.pauseUntil).toBe(1700001234);
  });

  it('returns null when action is unrecognised', async () => {
    const { client } = fakeClient({
      getKillSwitchReceipt: async () => ({
        receipt_id: '0xrec',
        action: 'Liquidate', // not a kill-switch action
        agent_did: 'did:tenzro:machine:0xc:a',
        controller_did: 'did:tenzro:human:xyz',
        reason_code: 0,
        frozen_at_block: 1,
        timestamp: 1,
      }),
    });
    const adapter = new LifecycleSdkAdapter(client);
    expect(await adapter.getKillSwitchReceipt('0xrec')).toBeNull();
  });
});

describe('LifecycleSdkAdapter.listKillSwitchByAgent', () => {
  it('returns [] for null/undefined response', async () => {
    const { client } = fakeClient({
      listKillSwitchByAgent: async () => null as unknown as never[],
    });
    const adapter = new LifecycleSdkAdapter(client);
    expect(await adapter.listKillSwitchByAgent('did:tenzro:machine:0xc:a')).toEqual([]);
  });

  it('drops rows with unknown action', async () => {
    const { client } = fakeClient({
      listKillSwitchByAgent: async () => [
        {
          receipt_id: '0xa',
          action: 'Pause',
          agent_did: 'd',
          controller_did: 'c',
          reason_code: 1,
          frozen_at_block: 1,
          timestamp: 1,
        },
        {
          receipt_id: '0xb',
          action: 'NotARealAction',
          agent_did: 'd',
          controller_did: 'c',
          reason_code: 1,
          frozen_at_block: 1,
          timestamp: 1,
        },
      ],
    });
    const adapter = new LifecycleSdkAdapter(client);
    const list = await adapter.listKillSwitchByAgent('d');
    expect(list.length).toBe(1);
    expect(list[0]?.action).toBe('pause');
  });
});

describe('LifecycleSdkAdapter.listKillSwitchByController', () => {
  it('forwards controllerDid', async () => {
    const { client, calls } = fakeClient();
    const adapter = new LifecycleSdkAdapter(client);
    await adapter.listKillSwitchByController('did:tenzro:human:xyz');
    expect(calls[0]).toEqual({
      method: 'listKillSwitchByController',
      args: ['did:tenzro:human:xyz'],
    });
  });
});
