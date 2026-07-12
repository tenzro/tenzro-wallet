/**
 * Popup — the 380x600 surface that pops from the toolbar icon.
 *
 * Information density is the design constraint here. Three tabs cover
 * the operations you need without leaving the popup: Wallet (compact
 * balance hero + asset list), Agents (pending mandates), and Connect
 * (active dApp sessions). For anything heavier (full activity history,
 * settings) the popup links out to the side panel or web app.
 */

import { ArrowDownUp, ChevronDown, ExternalLink, Plus, Send, Settings } from 'lucide-react';
import type * as React from 'react';

import {
  AssetRow,
  Avatar,
  Badge,
  Button,
  ChainBadge,
  type ChainId,
  IdentityCard,
  Logo,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatUsd,
} from '@tenzro/ui';

const SELF_DID = 'did:tenzro:0x7e4c2a9b3e2c91dfa3d5c8b1f4c9a78e5d6f2b8a3c7e9d4f1a5b6c8d2e3f4a5b';
const TOTAL_USD = 31_702.41;

const ASSETS: {
  symbol: string;
  chain: ChainId;
  baseUnits: string;
  usdValue: number;
  changePct: number;
}[] = [
  {
    symbol: 'WTNZO',
    chain: 'tenzro',
    baseUnits: '1247000000000000000000',
    usdValue: 12470,
    changePct: 4.21,
  },
  {
    symbol: 'USDC',
    chain: 'base',
    baseUnits: '8420410000000000000000',
    usdValue: 8420.41,
    changePct: 0.01,
  },
  {
    symbol: 'USDC',
    chain: 'tempo',
    baseUnits: '4200000000000000000000',
    usdValue: 4200,
    changePct: 0.0,
  },
  { symbol: 'CC', chain: 'canton', baseUnits: '52000000000000', usdValue: 5200, changePct: -0.84 },
  { symbol: 'SOL', chain: 'solana', baseUnits: '8500000000', usdValue: 1240, changePct: 2.94 },
  {
    symbol: 'ETH',
    chain: 'ethereum',
    baseUnits: '420000000000000000',
    usdValue: 1428,
    changePct: 1.84,
  },
];

const PENDING = 2;

export function App() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <Logo size={22} />
        <Badge variant="default" size="xs" className="ml-1">
          testnet
        </Badge>
        <button
          type="button"
          className="ml-auto inline-flex items-center justify-center size-7 rounded-md hover:bg-surface-2 transition-colors text-foreground-muted hover:text-foreground cursor-pointer"
        >
          <Settings className="size-3.5" />
        </button>
      </header>

      {/* Identity */}
      <div className="px-4 pt-3">
        <IdentityCard did={SELF_DID} label="Hilary · Personal" compact onSwitch={() => {}} />
      </div>

      {/* Balance */}
      <div className="px-4 pt-4">
        <div className="text-[10px] uppercase tracking-widest text-foreground-subtle font-medium">
          Net worth
        </div>
        <div className="tabular text-3xl font-semibold tracking-tight">{formatUsd(TOTAL_USD)}</div>
        <div className="text-xs">
          <span className="tabular text-success bg-success-soft px-1.5 py-0.5 rounded-md font-medium">
            +2.84%
          </span>
          <span className="text-foreground-muted ml-2">+$931.50 today</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-4 pt-4 grid grid-cols-3 gap-2">
        <QuickAction icon={Send} label="Send" />
        <QuickAction icon={Plus} label="Receive" />
        <QuickAction icon={ArrowDownUp} label="Swap" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="assets" className="flex-1 min-h-0 mt-4 flex flex-col">
        <TabsList className="mx-4">
          <TabsTrigger value="assets" className="flex-1">
            Assets
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex-1">
            Agents{' '}
            {PENDING > 0 && (
              <Badge variant="agent" size="xs" className="ml-1">
                {PENDING}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="connect" className="flex-1">
            Connect
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="flex-1 min-h-0 overflow-y-auto px-2 mt-2">
          {ASSETS.map((a) => (
            <AssetRow
              key={`${a.symbol}-${a.chain}`}
              symbol={a.symbol}
              chain={a.chain}
              baseUnits={a.baseUnits}
              usdValue={a.usdValue}
              changePct={a.changePct}
              onClick={() => {}}
            />
          ))}
        </TabsContent>

        <TabsContent value="agents" className="flex-1 min-h-0 overflow-y-auto px-4 mt-2 space-y-2">
          <PendingMandateMini
            agent="Doorstep · Groceries"
            summary="Buy groceries up to $25/day from approved merchants"
            chain="base"
          />
          <PendingMandateMini
            agent="Trip Wallet"
            summary="Pay $342 for Lufthansa LH401 (FRA → JFK)"
            chain="base"
            urgent
          />
        </TabsContent>

        <TabsContent value="connect" className="flex-1 min-h-0 overflow-y-auto px-4 mt-2 space-y-2">
          <ConnectedRow
            name="Uniswap"
            origin="uniswap.org"
            chains={['ethereum', 'base', 'arbitrum']}
          />
          <ConnectedRow name="Jupiter" origin="jupiter.ag" chains={['solana', 'tenzro-svm']} />
          <ConnectedRow name="Tempo" origin="app.tempo.xyz" chains={['tempo']} />
        </TabsContent>
      </Tabs>

      {/* Footer link to web */}
      <div className="border-t border-border-subtle px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] text-foreground-subtle">v0.1.0 · rpc.tenzro.xyz</span>
        <a
          href="https://wallet.tenzro.xyz/dashboard"
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-foreground-muted hover:text-foreground inline-flex items-center gap-1 transition-colors"
        >
          Open in web
          <ExternalLink className="size-2.5" />
        </a>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
}: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      type="button"
      className="group flex flex-col items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-1 px-2 py-3 hover:border-border-default hover:bg-surface-2 transition-colors cursor-pointer"
    >
      <Icon className="size-4 text-brand" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function PendingMandateMini({
  agent,
  summary,
  chain,
  urgent,
}: {
  agent: string;
  summary: string;
  chain: ChainId;
  urgent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${urgent ? 'border-border-default bg-surface-2' : 'border-border-subtle bg-surface-1'}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar seed={agent} size="xs" />
        <span className="text-xs font-semibold flex-1 truncate">{agent}</span>
        <ChainBadge chain={chain} size="xs" />
      </div>
      <p className="text-xs text-foreground-muted mb-2 line-clamp-2">{summary}</p>
      <div className="flex gap-1.5">
        <Button variant="ghost" size="xs" className="flex-1">
          Reject
        </Button>
        <Button variant="primary" size="xs" className="flex-1">
          Approve
        </Button>
      </div>
    </div>
  );
}

function ConnectedRow({
  name,
  origin,
  chains,
}: {
  name: string;
  origin: string;
  chains: ChainId[];
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg p-2 hover:bg-surface-2 transition-colors">
      <Avatar seed={origin} size="sm" initials={name.slice(0, 1)} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{name}</div>
        <div className="text-[10px] text-foreground-subtle truncate">{origin}</div>
      </div>
      <div className="flex items-center gap-1">
        {chains.map((c) => (
          <ChainBadge key={c} chain={c} size="xs" withName={false} />
        ))}
      </div>
    </div>
  );
}
