import { describe, expect, it } from 'vitest';
import { WorkflowAdapter, type WorkflowClientLike } from './adapter.ts';

function fakeClient(): { client: WorkflowClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    open: record('open'),
    stepExecute: record('stepExecute'),
    stepVerify: record('stepVerify'),
    stepCompensate: record('stepCompensate'),
    finalize: record('finalize'),
    get: record('get'),
    getSaga: record('getSaga'),
    getLifecycle: record('getLifecycle'),
    getReceipt: record('getReceipt'),
    getOperationalMetrics: record('getOperationalMetrics'),
    listReceipts: record('listReceipts'),
    listByCreator: record('listByCreator'),
    listByParticipant: record('listByParticipant'),
    listByStatus: record('listByStatus'),
    mirrorToCanton: record('mirrorToCanton'),
    verifyDidEnvelope: record('verifyDidEnvelope'),
  } as unknown as WorkflowClientLike;
  return { client, calls };
}

describe('WorkflowAdapter', () => {
  it('forwards lifecycle calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new WorkflowAdapter(client);

    await adapter.open({ workflow_id: '0xwf' });
    await adapter.stepExecute('0xwf', 's1', 100n);
    await adapter.stepVerify('0xwf', 's1');
    await adapter.stepCompensate('0xwf', 's1');
    await adapter.finalize('0xwf');
    await adapter.getWorkflow('0xwf');
    await adapter.getSaga('0xwf');
    await adapter.getLifecycle('0xwf');
    await adapter.getReceipt('0xwf');
    await adapter.getOperationalMetrics('0xwf');
    await adapter.listReceipts(50);
    await adapter.listByCreator('did:tenzro:human:alice');
    await adapter.listByParticipant('did:tenzro:machine:agent');
    await adapter.listByStatus('finalized');
    await adapter.mirrorToCanton('0xwf');
    await adapter.verifyDidEnvelope({ did: 'did:tenzro:human:alice' });

    expect(calls.map(([m]) => m)).toEqual([
      'open',
      'stepExecute',
      'stepVerify',
      'stepCompensate',
      'finalize',
      'get',
      'getSaga',
      'getLifecycle',
      'getReceipt',
      'getOperationalMetrics',
      'listReceipts',
      'listByCreator',
      'listByParticipant',
      'listByStatus',
      'mirrorToCanton',
      'verifyDidEnvelope',
    ]);
  });
});
