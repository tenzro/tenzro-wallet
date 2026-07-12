/**
 * Activity — the cross-VM transaction feed.
 *
 * Filterable by surface and kind. Each row preserves the cross-VM
 * connector if the tx moved between surfaces. Selecting a row opens
 * the receipt panel (intentionally out of scope for this scaffold —
 * placeholder shows a soft toast).
 */

'use client';

import { Badge, Button, Card, Input, Tabs, TabsList, TabsTrigger } from '@tenzro/ui';
import { Filter, Search } from 'lucide-react';
import * as React from 'react';

import { ActivityRow } from '@/components/wallet/activity-row';
import { LiveActivityList } from '@/components/wallet/live-activity-list';
import { ACTIVITY } from '@/lib/mock-data';

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Activity</h1>
        <p className="text-foreground-muted">
          Every signature, every cross-VM move, every agentic charge — receipted and replayable.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          prefix={<Search className="size-3.5" />}
          placeholder="Filter by address, tx hash, or agent…"
          containerClassName="flex-1 min-w-[240px]"
        />
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="native">Native</TabsTrigger>
            <TabsTrigger value="evm">EVM</TabsTrigger>
            <TabsTrigger value="svm">SVM</TabsTrigger>
            <TabsTrigger value="canton">Canton</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="md" leftIcon={<Filter className="size-3.5" />}>
          More
        </Button>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold tracking-tight">
            Live testnet · rpc.tenzro.xyz
          </h2>
          <Badge variant="success" size="xs" dot>
            Real-time
          </Badge>
        </div>
        <LiveActivityList />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold tracking-tight">
            Cross-VM preview (design — not live)
          </h2>
          <Badge variant="default" size="xs">
            Mock
          </Badge>
        </div>
        <Card variant="raised" className="p-2">
          {ACTIVITY.map((tx) => (
            <ActivityRow key={tx.id} tx={tx} />
          ))}
        </Card>
      </section>

      <div className="flex items-center justify-between text-xs text-foreground-muted px-1">
        <span>Showing {ACTIVITY.length} preview · live count populates from on-chain</span>
        <Badge variant="default" size="xs">
          Indexed in real time
        </Badge>
      </div>
    </div>
  );
}
