/**
 * Pin the ERC-8004 adapter's wire-shape mapping. Encoding/decoding is done
 * by the SDK; the adapter only renames snake_case → camelCase and brands
 * the hex values. These tests assert the rename + brand round-trips
 * correctly so the EVM surface receives well-formed calldata.
 */

import { describe, expect, it } from 'vitest';
import { type Erc8004ClientLike, Erc8004SdkAdapter } from './erc8004-adapter.ts';

function fakeClient(overrides: Partial<Erc8004ClientLike> = {}): Erc8004ClientLike {
  return {
    deriveAgentId: async (owner, salt) => ({
      agent_id: '0x' + 'aa'.repeat(32),
      owner,
      salt,
    }),
    encodeRegister: async () => ({
      selector: '0x12345678',
      calldata: '0x12345678abcd',
    }),
    encodeGetAgent: async () => ({
      selector: '0xabcdef00',
      calldata: '0xabcdef00ee',
    }),
    decodeGetAgent: async () => ({
      registration_data_uri: 'ipfs://QmAgent',
      owner: '0x' + '11'.repeat(20),
    }),
    encodeFeedback: async () => ({ selector: '0xfeed0001', calldata: '0xfeed0001ff' }),
    encodeRequestValidation: async () => ({
      selector: '0xfeed0002',
      calldata: '0xfeed000222',
    }),
    encodeSubmitValidation: async () => ({
      selector: '0xfeed0003',
      calldata: '0xfeed000333',
    }),
    ...overrides,
  };
}

describe('Erc8004SdkAdapter', () => {
  it('deriveAgentId maps snake_case + brands hex', async () => {
    const adapter = new Erc8004SdkAdapter(fakeClient());
    const owner: `0x${string}` = ('0x' + '11'.repeat(20)) as `0x${string}`;
    const salt: `0x${string}` = ('0x' + '22'.repeat(32)) as `0x${string}`;
    const result = await adapter.deriveAgentId(owner, salt);
    expect(result.agentId.startsWith('0x')).toBe(true);
    expect(result.agentId).toHaveLength(2 + 64);
    expect(result.owner).toBe(owner);
    expect(result.salt).toBe(salt);
  });

  it('encodeRegister returns Erc8004Calldata with branded hex', async () => {
    const adapter = new Erc8004SdkAdapter(fakeClient());
    const r = await adapter.encodeRegister(
      ('0x' + 'aa'.repeat(32)) as `0x${string}`,
      'ipfs://QmAgent',
      ('0x' + '11'.repeat(20)) as `0x${string}`,
    );
    expect(r.selector).toBe('0x12345678');
    expect(r.calldata).toBe('0x12345678abcd');
  });

  it('decodeGetAgent maps registration_data_uri → registrationDataUri', async () => {
    const adapter = new Erc8004SdkAdapter(fakeClient());
    const decoded = await adapter.decodeGetAgent('0xabcdef' as `0x${string}`);
    expect(decoded.registrationDataUri).toBe('ipfs://QmAgent');
    expect(decoded.owner).toBe('0x' + '11'.repeat(20));
  });

  it('forwards positional args to encodeFeedback', async () => {
    let captured: unknown[] = [];
    const client = fakeClient({
      encodeFeedback: async (...args) => {
        captured = args;
        return { selector: '0x', calldata: '0x' };
      },
    });
    const adapter = new Erc8004SdkAdapter(client);
    await adapter.encodeFeedback(
      ('0x' + 'cc'.repeat(32)) as `0x${string}`,
      85,
      'auth-id-1',
      'ipfs://QmFb',
    );
    expect(captured).toEqual(['0x' + 'cc'.repeat(32), 85, 'auth-id-1', 'ipfs://QmFb']);
  });
});
