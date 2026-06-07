import { describe, expect, it } from 'vitest';
import { Eip7702Adapter, type Eip7702ClientLike } from './adapter.ts';

function fakeClient(): { client: Eip7702ClientLike; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push([name, args]);
    return { ok: true, method: name } as never;
  };
  const client = {
    signingHash: record('signingHash'),
    buildDesignator: record('buildDesignator'),
    parseDesignator: record('parseDesignator'),
    protocolInfo: record('protocolInfo'),
  } as unknown as Eip7702ClientLike;
  return { client, calls };
}

describe('Eip7702Adapter', () => {
  it('forwards helper calls to the SDK client', async () => {
    const { client, calls } = fakeClient();
    const adapter = new Eip7702Adapter(client);

    await adapter.signingHash(1337, '0xdelegate', 0);
    await adapter.buildDesignator('0xdelegate');
    await adapter.parseDesignator('0xef0100...');
    await adapter.protocolInfo();

    expect(calls.map(([m]) => m)).toEqual([
      'signingHash',
      'buildDesignator',
      'parseDesignator',
      'protocolInfo',
    ]);
    expect(calls[0]?.[1]).toEqual([1337, '0xdelegate', 0]);
  });
});
