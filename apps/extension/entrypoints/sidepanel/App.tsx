/**
 * Side panel — persistent activity feed pinned beside the dApp.
 *
 * The panel stays open while the user browses, surfaces tx state in
 * real time, and gives one-tap access to mandate prompts so the user
 * can stay in the dApp while approving a Cart Mandate or sig request.
 */

import { ArrowDownLeft, ArrowUpRight, Bot, Filter, Pin, Zap } from 'lucide-react';
import * as React from 'react';

import {
  Badge,
  Button,
  ChainBadge,
  type ChainId,
  Logo,
  TxStatus,
  formatRelativeTime,
} from '@tenzro/ui';

const NOW = Date.now();

const FEED: FeedTx[] = [
  {
    id: 'a1',
    kind: 'cross-vm',
    from: 'tenzro-evm',
    to: 'tenzro-svm',
    amount: '12.4 WTNZO',
    state: 'finalized',
    ts: NOW - 1_200_000,
  },
  {
    id: 'a2',
    kind: 'agent',
    chain: 'base',
    counterparty: 'shopify.merchant.eth',
    amount: '$12.40',
    agentName: 'Doorstep',
    state: 'finalized',
    ts: NOW - 4_400_000,
  },
  {
    id: 'a3',
    kind: 'send',
    chain: 'ethereum',
    counterparty: '0x91…3a',
    amount: '0.5 ETH',
    state: 'mempool',
    ts: NOW - 120_000,
  },
];

export function App() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <Logo size={20} />
        <span className="text-sm font-semibold tracking-tight">Activity</span>
        <Badge variant="success" size="xs" dot className="ml-2">
          Live
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="size-7 rounded-md hover:bg-surface-2 inline-flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <Filter className="size-3.5" />
          </button>
          <button
            type="button"
            className="size-7 rounded-md hover:bg-surface-2 inline-flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <Pin className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {FEED.map((tx) => (
          <FeedRow key={tx.id} tx={tx} />
        ))}
      </div>

      <div className="border-t border-border-subtle px-4 py-3">
        <Button variant="secondary" size="sm" width="full">
          Open full activity
        </Button>
      </div>
    </div>
  );
}

type TxStateLite = 'finalized' | 'mempool' | 'included' | 'failed';
type FeedTx =
  | {
      id: string;
      kind: 'cross-vm';
      from: ChainId;
      to: ChainId;
      amount: string;
      state: TxStateLite;
      ts: number;
    }
  | {
      id: string;
      kind: 'agent';
      chain: ChainId;
      counterparty: string;
      agentName: string;
      amount: string;
      state: TxStateLite;
      ts: number;
    }
  | {
      id: string;
      kind: 'send';
      chain: ChainId;
      counterparty: string;
      amount: string;
      state: TxStateLite;
      ts: number;
    };

function FeedRow({ tx }: { tx: FeedTx }) {
  const Icon = tx.kind === 'cross-vm' ? Zap : tx.kind === 'agent' ? Bot : ArrowUpRight;

  return (
    <div className="flex items-start gap-2.5 rounded-xl px-2.5 py-2.5 hover:bg-surface-2 transition-colors cursor-pointer">
      <div className="size-7 rounded-lg bg-surface-2 border border-border-subtle flex items-center justify-center text-foreground-muted">
        <Icon className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold">
            {tx.kind === 'cross-vm' ? 'Pointer-op' : tx.kind === 'agent' ? tx.agentName : 'Sent'}
          </span>
          {tx.kind === 'cross-vm' ? (
            <>
              <ChainBadge chain={tx.from} size="xs" withName={false} />
              <span className="text-foreground-disabled">→</span>
              <ChainBadge chain={tx.to} size="xs" withName={false} />
            </>
          ) : (
            <ChainBadge chain={tx.chain} size="xs" />
          )}
        </div>
        <p className="text-[11px] text-foreground-muted mt-0.5 truncate">
          {tx.kind === 'agent' || tx.kind === 'send' ? tx.counterparty : 'precompile 0x1003'}
          <span className="text-foreground-subtle"> · {formatRelativeTime(tx.ts)}</span>
        </p>
        <div className="mt-1">
          <TxStatus state={tx.state} />
        </div>
      </div>
      <span className="tabular text-xs font-medium">{tx.amount}</span>
    </div>
  );
}
