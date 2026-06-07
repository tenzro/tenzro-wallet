import { describe, expect, it } from 'vitest';
import { CapitalIntentAdapter, type CapitalClientLike } from './adapter.ts';

function fakeClient(): { client: CapitalClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    open: record('open'),
    quote: record('quote'),
    assign: record('assign'),
    execute: record('execute'),
    verify: record('verify'),
    compensate: record('compensate'),
    settle: record('settle'),
    get: record('get'),
    submitReserveAttestation: record('submitReserveAttestation'),
    getReserve: record('getReserve'),
    attestedMint: record('attestedMint'),
  } as unknown as CapitalClientLike;
  return { client, calls };
}

describe('CapitalIntentAdapter', () => {
  it('forwards lifecycle calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new CapitalIntentAdapter(client);

    await adapter.open({ intent_id: '0xabc' });
    await adapter.quote('0xabc', 'did:tenzro:machine:solver1', 'plan-a', 100, 60);
    await adapter.assign('0xabc', { auto: true });
    await adapter.execute('0xabc', { leg: 0 });
    await adapter.verify('0xabc');
    await adapter.compensate('0xabc');
    await adapter.settle('0xabc', '0xpayee');
    await adapter.getIntent('0xabc');
    await adapter.submitReserveAttestation({ asset_id: '0xdef', reserve: '1000' });
    await adapter.getReserve('0xdef');
    await adapter.attestedMint('0xdef', '0xto', '100', '0xcaller');

    expect(calls.map(([m]) => m)).toEqual([
      'open',
      'quote',
      'assign',
      'execute',
      'verify',
      'compensate',
      'settle',
      'get',
      'submitReserveAttestation',
      'getReserve',
      'attestedMint',
    ]);
    // assign opts carried through
    const assignArgs = calls[2]?.[1] as unknown[] | undefined;
    expect(assignArgs?.[1]).toEqual({ auto: true });
    // settle payee carried through
    const settleArgs = calls[6]?.[1] as unknown[] | undefined;
    expect(settleArgs?.[1]).toBe('0xpayee');
  });
});
