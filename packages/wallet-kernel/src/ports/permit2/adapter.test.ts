import { describe, expect, it } from 'vitest';
import { Permit2Adapter, type Permit2ClientLike } from './adapter.ts';

function fakeClient(): { client: Permit2ClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    domainSeparator: record('domainSeparator'),
    digest: record('digest'),
    verifyAndConsume: record('verifyAndConsume'),
    nonceUsed: record('nonceUsed'),
  } as unknown as Permit2ClientLike;
  return { client, calls };
}

describe('Permit2Adapter', () => {
  it('forwards calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new Permit2Adapter(client);

    await adapter.domainSeparator(1337);
    await adapter.digest({
      chain_id: 1337,
      owner: '0xowner',
      token: '0xtoken',
      amount: '1000',
      spender: '0xspender',
      nonce: '0',
      deadline: 1,
    });
    await adapter.verifyAndConsume({
      chain_id: 1337,
      owner: '0xowner',
      token: '0xtoken',
      amount: '1000',
      spender: '0xspender',
      nonce: '0',
      deadline: 1,
      signature: '0xsig',
    });
    await adapter.nonceUsed('0xowner', '0');

    expect(calls.map(([m]) => m)).toEqual([
      'domainSeparator',
      'digest',
      'verifyAndConsume',
      'nonceUsed',
    ]);
  });
});
