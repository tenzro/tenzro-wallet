/**
 * Pin SessionKey adapter — onboardDelegatedAgent shape, list fallback,
 * revoke jti vs did.
 */

import { describe, expect, it } from 'vitest';
import {
  SessionKeySdkAdapter,
  type SessionKeyClientLike,
} from './session-key-adapter.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeClient(
  overrides: Partial<SessionKeyClientLike> = {},
): { client: SessionKeyClientLike; calls: Call[] } {
  const calls: Call[] = [];
  const client: SessionKeyClientLike = {
    onboardDelegatedAgent: async (controllerDid, caps, scope, jkt) => {
      calls.push({
        method: 'onboardDelegatedAgent',
        args: [controllerDid, caps, scope, jkt],
      });
      return {
        identity: { did: 'did:tenzro:machine:alice:agent-1' },
        wallet: { id: 'w-1' },
        access_token: 'jwt-abc',
        refresh_token: 'rt-xyz',
        expires_in: 3600,
      };
    },
    revokeJwt: async (jti, reason) => {
      calls.push({ method: 'revokeJwt', args: [jti, reason] });
      return { status: 'Revoked' };
    },
    revokeDid: async (did, reason) => {
      calls.push({ method: 'revokeDid', args: [did, reason] });
      return { status: 'Revoked' };
    },
    ...overrides,
  };
  return { client, calls };
}

describe('SessionKeySdkAdapter.create', () => {
  it('forwards delegationScope verbatim and unwraps engine response', async () => {
    const { client, calls } = fakeClient();
    const adapter = new SessionKeySdkAdapter(client);
    const r = await adapter.create({
      controllerDid: 'did:tenzro:human:alice',
      scope: {
        label: 'inference budget',
        capabilities: ['inference', 'rpc-call'],
        delegationScope: { max_per_tx: '1000000', daily_cap: '10000000' },
      },
    });
    expect(r.agentDid).toBe('did:tenzro:machine:alice:agent-1');
    expect(r.accessToken).toBe('jwt-abc');
    expect(r.refreshToken).toBe('rt-xyz');
    // expiresAt is derived from expires_in (3600s) → Date.now() + 3600s.
    expect(r.expiresAt).toBeGreaterThan(Date.now());

    expect(calls[0]?.method).toBe('onboardDelegatedAgent');
    expect(calls[0]?.args[0]).toBe('did:tenzro:human:alice');
    expect(calls[0]?.args[1]).toEqual(['inference', 'rpc-call']);
    expect(calls[0]?.args[2]).toEqual({
      max_per_tx: '1000000',
      daily_cap: '10000000',
    });
  });

  it('derives expiresAt from expires_in', async () => {
    const { client } = fakeClient({
      onboardDelegatedAgent: async () => ({
        identity: { did: 'did:tenzro:machine:alice:agent-1' },
        wallet: { id: 'w-1' },
        access_token: 'jwt',
        expires_in: 3600,
      }),
    });
    const adapter = new SessionKeySdkAdapter(client);
    const before = Date.now();
    const r = await adapter.create({
      controllerDid: 'did:tenzro:human:alice',
      scope: { label: 'x', capabilities: [], delegationScope: {} },
    });
    expect(r.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 1000);
    expect('refreshToken' in r).toBe(false);
  });
});

describe('SessionKeySdkAdapter.list', () => {
  it('throws when engine has no listSessions endpoint', async () => {
    const { client } = fakeClient();
    const adapter = new SessionKeySdkAdapter(client);
    await expect(adapter.list('did:tenzro:human:alice')).rejects.toThrow(
      /listSessions/,
    );
  });

  it('maps snake_case session records', async () => {
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [
          {
            agent_did: 'did:tenzro:machine:alice:agent-1',
            controller_did: 'did:tenzro:human:alice',
            capabilities: ['inference'],
            delegation_scope: { max_per_tx: '1000000' },
            issued_at: 1,
            expires_at: 2,
            status: 'active',
          },
        ],
      }),
    });
    const adapter = new SessionKeySdkAdapter(client);
    const list = await adapter.list('did:tenzro:human:alice');
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('active');
    expect(list[0]?.delegationScope).toEqual({ max_per_tx: '1000000' });
  });
});

describe('SessionKeySdkAdapter.revoke', () => {
  it('routes jti to revokeJwt', async () => {
    const { client, calls } = fakeClient();
    const adapter = new SessionKeySdkAdapter(client);
    const r = await adapter.revoke({
      target: { kind: 'jti', jti: 'jti-1' },
      reason: 'compromised',
    });
    expect(r.target).toBe('jti-1');
    expect(r.status).toBe('Revoked');
    expect(calls[0]?.method).toBe('revokeJwt');
    expect(calls[0]?.args).toEqual(['jti-1', 'compromised']);
  });

  it('routes did to revokeDid', async () => {
    const { client, calls } = fakeClient();
    const adapter = new SessionKeySdkAdapter(client);
    const r = await adapter.revoke({
      target: { kind: 'did', did: 'did:tenzro:machine:alice:agent-1' },
    });
    expect(r.target).toBe('did:tenzro:machine:alice:agent-1');
    expect(calls[0]?.method).toBe('revokeDid');
  });
});
