'use client';

import { formatAddress, formatAmount } from '@tenzro/ui';
import { useEffect, useState } from 'react';
import type { TransactionEffects, TypedTransaction } from 'tenzro-sdk';

import { EffectsUnavailable, checkedEffects, unsignedTransaction } from '@/lib/effects';
import type { Network } from '@/lib/network';

import { Notice } from './ui';

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'ok'; readonly effects: TransactionEffects }
  | { readonly status: 'blocked'; readonly reason: string };

/**
 * What the transaction does, as two operators' nodes derived it at the same
 * block. Reports `true` to `onReady` only when they agree; otherwise it shows
 * no effects at all, only why.
 */
export function Effects({
  net,
  tx,
  from,
  onReady,
}: {
  net: Network;
  tx: TypedTransaction;
  from: string;
  onReady(ok: boolean): void;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const key = JSON.stringify(tx);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive when the transaction changes
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    onReady(false);
    (async () => {
      const unsigned = await unsignedTransaction(net.rpc, { ...tx, from });
      return checkedEffects(net.rpc, net.second, unsigned);
    })()
      .then((effects) => {
        if (!live) return;
        const ok = effects.outcome === 'applied';
        setState({ status: 'ok', effects });
        onReady(ok);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setState({
          status: 'blocked',
          reason: e instanceof EffectsUnavailable ? e.message : 'The effects could not be derived.',
        });
        onReady(false);
      });
    return () => {
      live = false;
    };
  }, [key, from, net]);

  if (state.status === 'loading') {
    return <Notice>Two nodes are working out what this does.</Notice>;
  }
  if (state.status === 'blocked') return <Notice tone="danger">{state.reason}</Notice>;
  const e = state.effects;
  return (
    <div className="space-y-3 rounded-xl border border-border-default bg-surface-2 p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">What this does</span>
        <span className={e.outcome === 'applied' ? 'text-success' : 'text-danger'}>
          {e.outcome === 'applied' ? 'Would succeed' : `Would fail${e.error ? `: ${e.error}` : ''}`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {e.balance_changes.map((c) => {
          const delta = BigInt(c.after) - BigInt(c.before);
          return (
            <li key={c.account} className="flex justify-between gap-4 tabular">
              <span className="font-mono text-xs text-foreground-muted">
                {formatAddress(c.account, 10, 6)}
              </span>
              <span className={delta < 0n ? 'text-danger' : 'text-success'}>
                {delta < 0n ? '' : '+'}
                {formatAmount(delta)} TNZO
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-foreground-muted">
        Derived by two nodes of different operators at block {e.height}; both reached{' '}
        <span className="font-mono">{e.digest.slice(0, 12)}</span>.
      </p>
    </div>
  );
}
