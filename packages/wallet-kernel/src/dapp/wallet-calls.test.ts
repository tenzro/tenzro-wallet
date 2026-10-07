import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  CALLS_VERSION,
  MAX_CALLS,
  WALLET_CALL_ERRORS,
  WalletCallError,
  agentOfContext,
  agentWalletAddress,
  callsStatus,
  grantedPermissions,
  parsePermissionRequest,
  parseSendCalls,
  permissionContext,
  permissionResponse,
  supportedExecutionPermissions,
} from './wallet-calls.ts';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const CHAIN = '0x539';
const ctx = { chainId: CHAIN, account: ACCOUNT };
const NOW = 1_800_000_000_000;

function code(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof WalletCallError ? e.code : undefined;
  }
  return undefined;
}

// ERC-5792 example shape (wallet_sendCalls params).
const sendCalls = (over: Record<string, unknown> = {}) => [
  {
    version: '2.0.0',
    chainId: '0x539',
    from: ACCOUNT,
    atomicRequired: true,
    calls: [
      { to: '0xd46e8dd67c5d32be8058bb8eb970870f07244567', value: '0x9184e72a', data: '0xd46e8dd6' },
      { to: '0xd46e8dd67c5d32be8058bb8eb970870f07244567', value: '0x182183', data: '0xfbadbaf0' },
    ],
    capabilities: { paymasterService: { url: 'https://example.com/pm', optional: true } },
    ...over,
  },
];

describe('ERC-5792 wallet_sendCalls', () => {
  it('turns a batch into the calls of one contract-call transaction', () => {
    const batch = parseSendCalls(sendCalls(), ctx);
    expect(batch.chainId).toBe(CHAIN);
    expect(batch.calls).toHaveLength(2);
    expect(batch.calls[0]).toEqual({
      vm: 'evm',
      to: Array.from(Buffer.from('d46e8dd67c5d32be8058bb8eb970870f07244567', 'hex')),
      value: 0x9184e72an,
      data: [0xd4, 0x6e, 0x8d, 0xd6],
    });
  });

  it('answers with the standard error codes', () => {
    expect(code(() => parseSendCalls(sendCalls({ chainId: '0x1' }), ctx))).toBe(
      WALLET_CALL_ERRORS.unsupportedChain,
    );
    expect(code(() => parseSendCalls(sendCalls({ from: `0x${'22'.repeat(20)}` }), ctx))).toBe(
      WALLET_CALL_ERRORS.unauthorized,
    );
    expect(
      code(() =>
        parseSendCalls(
          sendCalls({ capabilities: { paymasterService: { url: 'https://x' } } }),
          ctx,
        ),
      ),
    ).toBe(WALLET_CALL_ERRORS.unsupportedCapability);
    const many = Array.from({ length: MAX_CALLS + 1 }, () => ({ to: ACCOUNT }));
    expect(code(() => parseSendCalls(sendCalls({ calls: many }), ctx))).toBe(
      WALLET_CALL_ERRORS.bundleTooLarge,
    );
    expect(code(() => parseSendCalls(sendCalls({ version: '1.0' }), ctx))).toBe(
      WALLET_CALL_ERRORS.invalidParams,
    );
    expect(code(() => parseSendCalls(sendCalls({ calls: [{ data: '0x60' }] }), ctx))).toBe(
      WALLET_CALL_ERRORS.invalidParams,
    );
  });

  it('accepts the account in its 32-byte ledger form', () => {
    const batch = parseSendCalls(sendCalls({ from: `${ACCOUNT}${'00'.repeat(12)}` }), ctx);
    expect(batch.calls).toHaveLength(2);
  });

  it('reports status from the one transaction receipt, always atomic', () => {
    const id = `0x${'ab'.repeat(32)}`;
    expect(callsStatus(id, CHAIN, null)).toEqual({
      version: CALLS_VERSION,
      id,
      chainId: CHAIN,
      status: 100,
      atomic: true,
    });
    const done = callsStatus(id, CHAIN, {
      status: '0x1',
      logs: [],
      blockHash: '0x01',
      blockNumber: '0x2',
      gasUsed: '0x5208',
    });
    expect(done.status).toBe(200);
    expect(done.receipts?.[0]?.transactionHash).toBe(id);
    expect(callsStatus(id, CHAIN, { status: '0x0' }).status).toBe(500);
  });
});

describe('ERC-7715 permissions', () => {
  const agentDid = 'did:tenzro:human:abc/agent:shop';
  const request = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
    chainId: CHAIN,
    from: ACCOUNT,
    to: `0x${'33'.repeat(20)}`,
    permission: {
      type: 'native-token-periodic',
      isAdjustmentAllowed: false,
      data: {
        periodAmount: '0x2386f26fc10000',
        periodDuration: 86400,
        justification: 'daily budget',
        ...data,
      },
    },
    rules: [{ type: 'expiry', data: { timestamp: NOW / 1000 + 3600 } }],
    ...over,
  });

  it('grants a daily or hourly limit with the expiry', () => {
    const g = parsePermissionRequest(request(), { ...ctx, nowMs: NOW });
    expect(g.window).toBe('day');
    expect(g.amountWei).toBe(10_000_000_000_000_000n);
    expect(g.expiresAtMs).toBe(NOW + 3_600_000);
    expect(
      parsePermissionRequest(request({}, { periodDuration: 3600 }), { ...ctx, nowMs: NOW }).window,
    ).toBe('hour');
  });

  it('scales another period down only when adjustment is allowed', () => {
    const week = request({}, { periodDuration: 7 * 86400, periodAmount: '0x7' });
    expect(code(() => parsePermissionRequest(week, { ...ctx, nowMs: NOW }))).toBe(
      WALLET_CALL_ERRORS.invalidParams,
    );
    const adjustable = { ...week, permission: { ...week.permission, isAdjustmentAllowed: true } };
    const g = parsePermissionRequest(adjustable, { ...ctx, nowMs: NOW });
    expect(g.window).toBe('day');
    expect(g.amountWei).toBe(1n);
    expect((g.granted.permission as { data: { periodDuration: number } }).data.periodDuration).toBe(
      86400,
    );
  });

  it('refuses what Terms cannot hold', () => {
    const c = { ...ctx, nowMs: NOW };
    expect(
      code(() =>
        parsePermissionRequest(
          request({ permission: { type: 'erc20-token-periodic', data: {} } }),
          c,
        ),
      ),
    ).toBe(WALLET_CALL_ERRORS.invalidParams);
    expect(
      code(() =>
        parsePermissionRequest(request({ rules: [{ type: 'expiry', data: { timestamp: 1 } }] }), c),
      ),
    ).toBe(WALLET_CALL_ERRORS.invalidParams);
    expect(code(() => parsePermissionRequest(request({ chainId: '0x1' }), c))).toBe(
      WALLET_CALL_ERRORS.unsupportedChain,
    );
  });

  it('answers with a context naming the agent and no delegation contract', () => {
    const g = parsePermissionRequest(request(), { ...ctx, nowMs: NOW });
    const res = permissionResponse(g, agentDid);
    expect(agentOfContext(res.context)).toBe(agentDid);
    expect(res.delegationManager).toBe(`0x${'00'.repeat(20)}`);
    expect(res.dependencies).toEqual([]);
    expect(permissionContext(agentDid)).toBe(`0x${Buffer.from(agentDid).toString('hex')}`);
  });

  it('derives the agent wallet address as the network does', async () => {
    const expected = createHash('sha256')
      .update('tenzro/agent-wallet')
      .update(agentDid)
      .digest()
      .subarray(0, 20);
    expect(await agentWalletAddress(agentDid)).toBe(`0x${expected.toString('hex')}`);
  });

  it('lists the limits agents hold', async () => {
    const list = await grantedPermissions(
      [
        {
          agent_did: agentDid,
          terms: {
            expires_at_ms: NOW,
            delegation_scope: { max_daily_spend: '100', max_hourly_spend: null },
          },
        },
      ],
      ctx,
    );
    expect(list).toHaveLength(1);
    expect((list[0]?.permission as { data: { periodAmount: string } }).data.periodAmount).toBe(
      '0x64',
    );
    expect(supportedExecutionPermissions('1337')).toEqual({
      'native-token-periodic': { chainIds: ['0x539'], ruleTypes: ['expiry'] },
    });
  });
});
