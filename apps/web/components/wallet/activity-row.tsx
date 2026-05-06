/**
 * ActivityRow — chain-aware transaction line.
 *
 * Mono chrome with a small chain logo overlay on the action icon.
 * Cross-chain moves show both chain badges with a connector glyph.
 */

'use client';

import type { Activity } from '@/lib/mock-data';
import { Badge, ChainBadge, TxStatus, cn, formatRelativeTime } from '@tenzro/ui';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Cable,
  type LucideIcon,
  Zap,
} from 'lucide-react';
import * as React from 'react';

const kindIcon: Record<Activity['kind'], LucideIcon> = {
  send: ArrowUpRight,
  receive: ArrowDownLeft,
  swap: ArrowRight,
  agent: Bot,
  'cross-vm': Zap,
  bridge: Cable,
};

const kindLabel: Record<Activity['kind'], string> = {
  send: 'Sent',
  receive: 'Received',
  swap: 'Swapped',
  agent: 'Agent paid',
  'cross-vm': 'Pointer-op',
  bridge: 'Bridge',
};

export function ActivityRow({ tx }: { tx: Activity }) {
  const Icon = kindIcon[tx.kind];
  const isIncoming = tx.kind === 'receive';

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
          <span className="font-medium text-sm">{kindLabel[tx.kind]}</span>
          <ChainBadge chain={tx.chain} size="xs" />
          {tx.toChain && tx.toChain !== tx.chain && (
            <>
              <ArrowRight className="size-3 text-foreground-disabled" />
              <ChainBadge chain={tx.toChain} size="xs" />
            </>
          )}
          {tx.kind === 'agent' && tx.agentName && (
            <Badge variant="agent" size="xs" dot>
              {tx.agentName}
            </Badge>
          )}
        </div>
        <div className="text-xs text-foreground-muted mt-0.5 truncate">
          {tx.counterparty ?? (tx.kind === 'cross-vm' ? 'precompile 0x1003' : '')}
          {tx.vendor && <span> · via {tx.vendor}</span>}
          <span className="text-foreground-subtle"> · {formatRelativeTime(tx.ts)}</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <span
          className={cn(
            'tabular text-sm font-medium',
            isIncoming ? 'text-success' : 'text-foreground',
          )}
        >
          {isIncoming ? '+' : '−'} {tx.amount}
        </span>
        <TxStatus state={tx.state} />
      </div>
    </div>
  );
}
