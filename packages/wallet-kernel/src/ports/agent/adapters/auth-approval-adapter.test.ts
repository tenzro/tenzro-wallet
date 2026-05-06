/**
 * Pin the AuthApproval adapter wire-shape — pending records flow through
 * opaquely, decisions normalise to typed status.
 */

import { describe, expect, it } from 'vitest';
import { AuthApprovalSdkAdapter, type AuthClientLike } from './auth-approval-adapter.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeClient(overrides: Partial<AuthClientLike> = {}): {
  client: AuthClientLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client: AuthClientLike = {
    listPendingApprovals: async (approverDid) => {
      calls.push({ method: 'listPendingApprovals', args: [approverDid] });
      return {
        count: 2,
        pending: [
          { approval_id: 'ap-1', kind: 'spend-over-limit' },
          { approval_id: 'ap-2', kind: 'new-delegate' },
        ],
      };
    },
    decideApproval: async (approvalId, decision, approverDid) => {
      calls.push({
        method: 'decideApproval',
        args: [approvalId, decision, approverDid],
      });
      return {
        status: decision === 'approved' ? 'Approved' : 'Denied',
        approval_id: approvalId,
      };
    },
    ...overrides,
  };
  return { client, calls };
}

describe('AuthApprovalSdkAdapter', () => {
  it('listPending preserves opaque record shape and reports count', async () => {
    const { client } = fakeClient();
    const adapter = new AuthApprovalSdkAdapter(client);
    const list = await adapter.listPending('did:tenzro:human:alice');
    expect(list.count).toBe(2);
    expect(list.pending).toHaveLength(2);
    expect((list.pending[0] as { approval_id?: string }).approval_id).toBe('ap-1');
  });

  it('listPending falls back to pending.length when count is missing', async () => {
    const { client } = fakeClient({
      listPendingApprovals: async () => ({ pending: [{}, {}, {}] }),
    });
    const adapter = new AuthApprovalSdkAdapter(client);
    const list = await adapter.listPending('did:tenzro:human:alice');
    expect(list.count).toBe(3);
  });

  it('decide forwards positional args and normalises status', async () => {
    const { client, calls } = fakeClient();
    const adapter = new AuthApprovalSdkAdapter(client);
    const r = await adapter.decide('ap-1', 'approved', 'did:tenzro:human:alice');
    expect(calls[0]?.args).toEqual(['ap-1', 'approved', 'did:tenzro:human:alice']);
    expect(r.status).toBe('Approved');
    expect(r.approvalId).toBe('ap-1');
  });

  it('decide normalises odd engine status to the requested decision', async () => {
    const { client } = fakeClient({
      decideApproval: async (approvalId) => ({
        status: 'something-weird',
        approval_id: approvalId,
      }),
    });
    const adapter = new AuthApprovalSdkAdapter(client);
    expect((await adapter.decide('ap-1', 'denied', 'did:x')).status).toBe('Denied');
    expect((await adapter.decide('ap-2', 'approved', 'did:x')).status).toBe('Approved');
  });

  it('decide preserves approvalId fallback when engine omits it', async () => {
    const { client } = fakeClient({
      decideApproval: async () => ({ status: 'Approved' }),
    });
    const adapter = new AuthApprovalSdkAdapter(client);
    expect((await adapter.decide('ap-7', 'approved', 'did:x')).approvalId).toBe('ap-7');
  });
});
