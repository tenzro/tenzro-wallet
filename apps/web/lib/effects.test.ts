import { describe, expect, it } from 'vitest';

import { EffectsUnavailable, balanceDelta, checkedEffects, unsignedTransaction } from './effects';
import { transfer } from './send';
import { scriptedRpc } from './testing';

const FROM = `0x${'ab'.repeat(20)}`;
const TO = `0x${'cd'.repeat(20)}`;

function effects(digest: string, block = '0xb1') {
  return {
    height: 7,
    block_hash: block,
    outcome: 'applied',
    error: null,
    gas_used: 21000,
    balance_changes: [
      { account: `${FROM}${'00'.repeat(12)}`, before: '1000', after: '400' },
      { account: `${TO}${'00'.repeat(12)}`, before: '0', after: '500' },
    ],
    logs: [],
    digest,
  };
}

describe('effects', () => {
  it('builds the unsigned transaction the node executes', async () => {
    const { rpc } = scriptedRpc({
      tenzro_getNonce: () => '0x5',
      eth_chainId: () => '0x3444',
      eth_gasPrice: () => '0x3b9aca00',
    });
    const tx = await unsignedTransaction(rpc, { ...transfer(TO, 500n), from: FROM }, 1000);
    expect(tx.chain_id).toBe(0x3444);
    expect(tx.nonce).toBe(5);
    expect(tx.from).toHaveLength(32);
    expect(tx.to).toHaveLength(32);
    expect(tx.tx_type).toEqual({ Transfer: { amount: 500 } });
    expect(tx.valid_until).toBe(1000 + 300_000);
  });

  it('shows effects only when a second operator reproduces them at the same block', async () => {
    const first = scriptedRpc({ tenzro_decodeAction: () => ({ effects: effects('d1') }) });
    const second = scriptedRpc({ tenzro_decodeAction: () => ({ effects: effects('d1') }) });
    const tx = { tx_type: { Transfer: { amount: 500 } } };
    const e = await checkedEffects(first.rpc, second.rpc, tx);
    expect(e.digest).toBe('d1');
    expect(second.calls[0]!.params).toEqual([{ transaction: tx, block: { blockHash: '0xb1' } }]);
    expect(balanceDelta(e, FROM)).toBe(-600n);
    expect(balanceDelta(e, TO)).toBe(500n);
  });

  it('shows nothing when the digests differ', async () => {
    const first = scriptedRpc({ tenzro_decodeAction: () => ({ effects: effects('d1') }) });
    const second = scriptedRpc({ tenzro_decodeAction: () => ({ effects: effects('d2') }) });
    await expect(checkedEffects(first.rpc, second.rpc, { tx_type: {} })).rejects.toThrow(
      /disagree/,
    );
  });

  it('shows nothing without a second node', async () => {
    const first = scriptedRpc({ tenzro_decodeAction: () => ({ effects: effects('d1') }) });
    await expect(checkedEffects(first.rpc, null, { tx_type: {} })).rejects.toBeInstanceOf(
      EffectsUnavailable,
    );
    expect(first.calls).toHaveLength(0);
  });
});

describe('transfer', () => {
  it('pads a 20-byte recipient to its ledger slot and refuses bad input', () => {
    expect(transfer(TO, 1n).to).toBe(`${TO}${'00'.repeat(12)}`);
    expect(() => transfer('0x12', 1n)).toThrow();
    expect(() => transfer(TO, 0n)).toThrow();
    const big = transfer(TO, 10n ** 24n);
    expect(big.fields).toEqual({ amount: (10n ** 24n).toString() });
  });
});
