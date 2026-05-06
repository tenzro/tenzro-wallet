/**
 * Live activity list — real `tenzro_getTransactionHistory` for the
 * onboarded wallet. Designed to sit above the mock multi-VM feed so
 * the user can see "this is what's actually on-chain" at a glance.
 */

'use client';

import { ArrowDownLeft, ArrowUpRight, Loader2 } from 'lucide-react';
import * as React from 'react';

import { Badge, Card, CardContent, ChainBadge, TxStatus, cn, formatRelativeTime } from '@tenzro/ui';

import { formatTnzo, shortAddress } from '@/lib/tenzro/format';
import { useTransactionHistory, useWallet } from '@/lib/tenzro/hooks';
import type { TenzroTransaction } from '@/lib/tenzro/methods';

export function LiveActivityList() {
  const { wallet } = useWallet();
  const history = useTransactionHistory(wallet?.address);

  if (!wallet) {
    return (
      <Card variant="raised" className="p-6 text-center">
        <p className="text-sm text-foreground-muted">
          Onboard a wallet to see live testnet activity.
        </p>
      </Card>
    );
  }

  if (history.isLoading) {
    return (
      <Card variant="raised" className="p-6 flex items-center gap-3 justify-center">
        <Loader2 className="size-4 animate-spin text-foreground-muted" />
        <span className="text-sm text-foreground-muted">Loading history…</span>
      </Card>
    );
  }

  if (history.error) {
    return (
      <Card variant="raised" className="p-6">
        <p className="text-sm text-danger">{(history.error as Error).message}</p>
      </Card>
    );
  }

  const txs = history.data ?? [];

  if (txs.length === 0) {
    return (
      <Card variant="raised">
        <CardContent className="py-8 text-center">
          <Badge variant="default" size="xs" className="mb-3">
            Empty
          </Badge>
          <p className="text-sm text-foreground-muted">
            No transactions yet. Drip from the faucet on the dashboard, then send to yourself to
            populate the feed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="raised" className="p-2">
      {txs.map((tx) => (
        <LiveActivityRow key={tx.hash} tx={tx} self={wallet.address} />
      ))}
    </Card>
  );
}

function LiveActivityRow({ tx, self }: { tx: TenzroTransaction; self: string }) {
  const isIncoming = tx.to.toLowerCase() === self.toLowerCase();
  const counterparty = isIncoming ? tx.from : tx.to;
  const Icon = isIncoming ? ArrowDownLeft : ArrowUpRight;
  const status: 'finalized' | 'mempool' | 'failed' | 'included' =
    tx.status === 'finalized' || tx.status === 'confirmed'
      ? 'finalized'
      : tx.status === 'failed'
        ? 'failed'
        : tx.status === 'included'
          ? 'included'
          : 'mempool';

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-2 transition-colors group cursor-pointer">
      <div
        className={cn(
          'flex items-center justify-center size-9 rounded-xl border border-border-subtle',
          isIncoming ? 'bg-success-soft text-success' : 'bg-surface-2 text-foreground-muted',
        )}
      >
        <Icon className="size-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-sm">{isIncoming ? 'Received' : 'Sent'}</span>
          <ChainBadge chain="tenzro" size="xs" />
          {tx.tx_type && (
            <span className="text-[10px] uppercase tracking-wider text-foreground-subtle">
              {tx.tx_type}
            </span>
          )}
        </div>
        <div className="text-xs text-foreground-muted mt-0.5 truncate font-mono">
          {shortAddress(counterparty)}
          {tx.timestamp && (
            <span className="text-foreground-subtle"> · {formatRelativeTime(tx.timestamp)}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <span
          className={cn(
            'tabular text-sm font-medium',
            isIncoming ? 'text-success' : 'text-foreground',
          )}
        >
          {isIncoming ? '+' : '−'} {formatTnzo(tx.amount)} {tx.asset ?? 'TNZO'}
        </span>
        <TxStatus state={status} />
      </div>
    </div>
  );
}
