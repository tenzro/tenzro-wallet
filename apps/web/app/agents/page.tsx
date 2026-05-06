/**
 * Agents — the agentic-stack control center.
 *
 * Three tabs:
 *   - Pending   → mandates awaiting your approval (AP2 Cart/Intent/Payment)
 *   - Active    → live mandates + session keys (ERC-7702)
 *   - History   → revoked + expired
 *
 * Top KPIs reinforce the value: mandates active, spend this month
 * (under cap), reputation min, attestation freshness.
 */

'use client';

import { Bot, Filter, ShieldCheck, TrendingUp } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import * as React from 'react';

import {
  AgentMandateCard,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  KeyStat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tenzro/ui';

import { type AgentMandate, MANDATES } from '@/lib/mock-data';

export default function AgentsPage() {
  const pending = MANDATES.filter((m) => m.state === 'pending');
  const active = MANDATES.filter((m) => m.state === 'active');
  const history = MANDATES.filter((m) => m.state === 'revoked' || m.state === 'expired');

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <Badge variant="agent" size="md" className="mb-2">
            <Bot className="size-3" /> Agentic stack
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight mb-1">Your agents</h1>
          <p className="text-foreground-muted">
            AP2 mandates, ERC-7702 session keys, ERC-8004 identities — all in one place.
          </p>
        </div>
        <Button variant="primary" leftIcon={<Bot className="size-4" />}>
          Connect a new agent
        </Button>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KeyStat label="Pending" value={pending.length.toString()} icon={Filter} accent="brand" />
        <KeyStat label="Active" value={active.length.toString()} icon={Bot} accent="agent" />
        <KeyStat
          label="Spend · 30d"
          value="$94.20"
          delta={{ value: '$405.80 left under caps', positive: true }}
          icon={TrendingUp}
          accent="success"
        />
        <KeyStat
          label="Verifier rep · min"
          value="4.55 ★"
          delta={{ value: 'all attested in 24h', positive: true }}
          icon={ShieldCheck}
          accent="agent"
        />
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending · {pending.length}</TabsTrigger>
          <TabsTrigger value="active">Active · {active.length}</TabsTrigger>
          <TabsTrigger value="history">History · {history.length}</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {pending.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No pending mandates"
              description="Agents will appear here when they request authorisation to act on your behalf."
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AnimatePresence>
                {pending.map((m) => (
                  <ManCard key={m.id} mandate={m} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AnimatePresence>
              {active.map((m) => (
                <ManCard key={m.id} mandate={m} />
              ))}
            </AnimatePresence>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {history.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No history yet"
              description="Revoked and expired mandates will live here for audit."
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {history.map((m) => (
                <ManCard key={m.id} mandate={m} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Card variant="flat">
        <CardHeader>
          <CardTitle>How agentic spend stays safe</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-foreground-muted">
          <div>
            <h3 className="text-foreground font-medium mb-1">Policy-bound</h3>
            <p>
              Every mandate carries a cap, window, and recipient class — enforced at signing time.
            </p>
          </div>
          <div>
            <h3 className="text-foreground font-medium mb-1">Verifiable identity</h3>
            <p>
              Agents present an ERC-8004 DID with on-chain reputation and a TEE attestation receipt.
            </p>
          </div>
          <div>
            <h3 className="text-foreground font-medium mb-1">Revocable instantly</h3>
            <p>
              Revoke a session key or mandate from any device — propagates across the quorum in
              seconds.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ManCard({ mandate }: { mandate: AgentMandate }) {
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
      onRevoke={() => {}}
    />
  );
}
