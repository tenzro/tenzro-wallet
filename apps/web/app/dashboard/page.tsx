/**
 * Dashboard — chain-aware portfolio + agent inbox.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Balance hero (chain legs + actions)                     │
 *   ├────────────────────────────────────┬─────────────────────┤
 *   │  Assets · Activity (tabs)          │  Pending mandates   │
 *   │                                    │  + Connected dApps  │
 *   └────────────────────────────────────┴─────────────────────┘
 */

'use client';

import { ArrowRight, Bot, Cable, Filter } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import {
  AgentMandateCard,
  AssetRow,
  BalanceHero,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type ChainLeg,
  EmptyState,
  KeyStat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tenzro/ui';

import { ActivityRow } from '@/components/wallet/activity-row';
import { LiveTestnetCard } from '@/components/wallet/live-testnet-card';
import { ACTIVITY, ASSETS, type AgentMandate, DAPPS, MANDATES, TOTAL_USD } from '@/lib/mock-data';

// Top six chains by USD value, surfaced in the hero strip
const heroLegs: ChainLeg[] = [
  { chain: 'tenzro', baseUnits: '1247000000000000000000', usdValue: 12470 },
  { chain: 'base', baseUnits: '8420410000000000000000', usdValue: 9032 },
  { chain: 'canton', baseUnits: '52000000000000', usdValue: 5200 },
  { chain: 'tempo', baseUnits: '4200000000000000000000', usdValue: 4200 },
];

export default function DashboardPage() {
  const pendingMandates = MANDATES.filter((m) => m.state === 'pending');
  const activeMandates = MANDATES.filter((m) => m.state === 'active');

  return (
    <div className="space-y-6">
      <LiveTestnetCard />

      <BalanceHero totalUsd={TOTAL_USD} changePct={2.84} changeUsd={931.5} legs={heroLegs} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KeyStat
          label="Active mandates"
          value={activeMandates.length.toString()}
          icon={Bot}
          accent="agent"
        />
        <KeyStat
          label="Pending"
          value={pendingMandates.length.toString()}
          icon={Filter}
          accent="brand"
        />
        <KeyStat
          label="Connected dApps"
          value={DAPPS.length.toString()}
          icon={Cable}
          accent="brand"
        />
        <KeyStat
          label="Cross-VM · 30d"
          value="42"
          delta={{ value: 'all pointer-ops', positive: true }}
          icon={ArrowRight}
          accent="native"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card variant="raised">
            <Tabs defaultValue="assets">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <TabsList>
                  <TabsTrigger value="assets">Assets · {ASSETS.length}</TabsTrigger>
                  <TabsTrigger value="activity">Activity · {ACTIVITY.length}</TabsTrigger>
                </TabsList>
                <Button variant="ghost" size="sm" leftIcon={<Filter className="size-3.5" />}>
                  Filter
                </Button>
              </CardHeader>

              <TabsContent value="assets" className="px-3 pb-3">
                <div className="flex flex-col">
                  {ASSETS.map((asset) => (
                    <AssetRow
                      key={`${asset.symbol}-${asset.chain}`}
                      symbol={asset.symbol}
                      name={asset.name}
                      chain={asset.chain}
                      baseUnits={asset.baseUnits}
                      usdValue={asset.usdValue}
                      changePct={asset.changePct}
                      onClick={() => {}}
                    />
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="activity" className="px-3 pb-3">
                <div className="flex flex-col gap-1">
                  {ACTIVITY.map((tx) => (
                    <ActivityRow key={tx.id} tx={tx} />
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        <div className="space-y-6">
          <Card variant="raised">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Pending mandates</CardTitle>
                <Button asChild variant="ghost" size="xs">
                  <Link href="/agents">View all</Link>
                </Button>
              </div>
              <CardDescription>Agentic actions awaiting your approval</CardDescription>
            </CardHeader>
            <CardContent>
              {pendingMandates[0] ? (
                <PendingMandateMini mandate={pendingMandates[0]} />
              ) : (
                <EmptyState
                  icon={Bot}
                  title="Nothing pending"
                  description="Approved agents act for you with policy-bound mandates."
                />
              )}
            </CardContent>
          </Card>

          <Card variant="raised">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Connected apps</CardTitle>
                <Button asChild variant="ghost" size="xs">
                  <Link href="/connect">Manage</Link>
                </Button>
              </div>
              <CardDescription>EIP-6963 + CAIP-25</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {DAPPS.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2 transition-colors"
                >
                  <div className="size-8 rounded-lg bg-surface-2 border border-border-subtle flex items-center justify-center text-xs font-semibold">
                    {d.name.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{d.name}</div>
                    <div className="text-xs text-foreground-subtle truncate">{d.origin}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PendingMandateMini({ mandate }: { mandate: AgentMandate }) {
  return (
    <AgentMandateCard
      kind={mandate.kind}
      agentName={mandate.agentName}
      agentDid={mandate.agentDid}
      agentVerifier={mandate.agentVerifier ?? ''}
      summary={mandate.summary}
      cap={mandate.cap}
      recipientClass={mandate.recipientClass ?? ''}
      expiresAt={mandate.expiresAt}
      chain={mandate.chain}
      state={mandate.state}
      reputation={mandate.reputation}
      attestationId={mandate.attestationId ?? ''}
      onApprove={() => {}}
      onReject={() => {}}
    />
  );
}
