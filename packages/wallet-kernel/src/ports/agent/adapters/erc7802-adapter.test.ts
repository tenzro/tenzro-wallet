/**
 * Pin the Erc7802SdkAdapter against `tenzro-sdk@0.1.0` `Erc7802Client`:
 *   - throws "SDK pending" when the client lacks the method
 *   - forwards positional args
 *   - decodes snake_case (`tx_hash`, `source_chain`, `target_chain`,
 *     `total_supply`, `chain_supplies`) → camelCase at the adapter boundary
 */

import { describe, expect, it } from 'vitest';
import {
  Erc7802SdkAdapter,
  type Erc7802ClientLike,
} from './erc7802-adapter.ts';

const TOKEN = '0xabc0000000000000000000000000000000000000';
const TO = '0xdef0000000000000000000000000000000000000';
const FROM = '0xfee0000000000000000000000000000000000000';

describe('Erc7802SdkAdapter — SDK-pending paths', () => {
  it('crosschainMint throws when client.crosschainMint absent', async () => {
    const adapter = new Erc7802SdkAdapter({});
    await expect(
      adapter.crosschainMint({
        token: TOKEN,
        recipient: TO,
        amount: '1000',
        sourceChain: 'optimism',
      }),
    ).rejects.toThrow(/SDK pending.*crosschainMint/);
  });

  it('crosschainBurn throws when client.crosschainBurn absent', async () => {
    const adapter = new Erc7802SdkAdapter({});
    await expect(
      adapter.crosschainBurn({
        token: TOKEN,
        from: FROM,
        amount: '1000',
        targetChain: 'tenzro',
      }),
    ).rejects.toThrow(/SDK pending.*crosschainBurn/);
  });

  it('getCrossChainSupply throws when client.getCrossChainSupply absent', async () => {
    const adapter = new Erc7802SdkAdapter({});
    await expect(adapter.getCrossChainSupply(TOKEN)).rejects.toThrow(
      /SDK pending.*getCrossChainSupply/,
    );
  });
});

describe('Erc7802SdkAdapter — present paths', () => {
  it('crosschainMint forwards positional args + decodes snake_case', async () => {
    let captured: {
      token: string;
      recipient: string;
      amount: string;
      sourceChain: string;
    } | null = null;
    const client: Erc7802ClientLike = {
      async crosschainMint(token, recipient, amount, sourceChain) {
        captured = { token, recipient, amount, sourceChain };
        return {
          tx_hash: '0xmint',
          token,
          recipient,
          amount,
          source_chain: sourceChain,
          status: 'finalized',
        };
      },
    };
    const adapter = new Erc7802SdkAdapter(client);
    const r = await adapter.crosschainMint({
      token: TOKEN,
      recipient: TO,
      amount: '5000',
      sourceChain: 'optimism',
    });
    expect(r.txHash).toBe('0xmint');
    expect(r.sourceChain).toBe('optimism');
    expect(captured).not.toBeNull();
    expect(captured!.amount).toBe('5000');
  });

  it('crosschainBurn forwards positional args + decodes snake_case', async () => {
    const client: Erc7802ClientLike = {
      async crosschainBurn(token, from, amount, targetChain) {
        return {
          tx_hash: '0xburn',
          token,
          from,
          amount,
          target_chain: targetChain,
          status: 'finalized',
        };
      },
    };
    const adapter = new Erc7802SdkAdapter(client);
    const r = await adapter.crosschainBurn({
      token: TOKEN,
      from: FROM,
      amount: '7',
      targetChain: 'tenzro',
    });
    expect(r.txHash).toBe('0xburn');
    expect(r.targetChain).toBe('tenzro');
    expect(r.amount).toBe('7');
  });

  it('getCrossChainSupply decodes total_supply + chain_supplies', async () => {
    const client: Erc7802ClientLike = {
      async getCrossChainSupply(token: string) {
        return {
          token,
          total_supply: '1000000000',
          chain_supplies: { tenzro: '600000000', optimism: '400000000' },
        };
      },
    };
    const adapter = new Erc7802SdkAdapter(client);
    const r = await adapter.getCrossChainSupply(TOKEN);
    expect(r.totalSupply).toBe('1000000000');
    expect(r.chainSupplies['tenzro']).toBe('600000000');
    expect(r.chainSupplies['optimism']).toBe('400000000');
  });

  it('partial client (mint only) keeps burn in SDK pending', async () => {
    const client: Erc7802ClientLike = {
      async crosschainMint(token, recipient, amount, sourceChain) {
        return {
          tx_hash: '0xa',
          token,
          recipient,
          amount,
          source_chain: sourceChain,
          status: 'finalized',
        };
      },
    };
    const adapter = new Erc7802SdkAdapter(client);
    await expect(
      adapter.crosschainMint({
        token: TOKEN,
        recipient: TO,
        amount: '1',
        sourceChain: 'optimism',
      }),
    ).resolves.toBeDefined();
    await expect(
      adapter.crosschainBurn({
        token: TOKEN,
        from: FROM,
        amount: '1',
        targetChain: 'tenzro',
      }),
    ).rejects.toThrow(/SDK pending.*crosschainBurn/);
  });
});
