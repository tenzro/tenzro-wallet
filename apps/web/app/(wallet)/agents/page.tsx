'use client';

import { AgentMandateCard, EmptyState } from '@tenzro/ui';
import { Bot } from 'lucide-react';

import { SignedOut } from '@/components/wallet/signed-out';
import { formatBaseUnits } from '@/lib/tenzro/format';
import { useDelegatedAgents, useWallet } from '@/lib/tenzro/hooks';

export default function AgentsPage() {
  const { wallet } = useWallet();
  const agents = useDelegatedAgents(wallet?.did);

  if (!wallet) return <SignedOut what="the agents you have authorised" />;

  const list = agents.data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Agents you have allowed to pay on your behalf, and the limits you set for each.
        </p>
      </div>
      {agents.isLoading ? (
        <p className="text-sm text-foreground-muted">Loading…</p>
      ) : agents.error ? (
        <p className="text-sm text-danger">Could not read your agents: {String(agents.error)}</p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents authorised"
          description="When you let an agent spend on your behalf, its terms and limits appear here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((a) => (
            <AgentMandateCard
              key={a.agent_did}
              kind="payment"
              agentName={a.agent_did.split(':').pop()?.slice(0, 12) ?? a.agent_did}
              agentDid={a.agent_did}
              summary={`Spent today: ${formatBaseUnits(a.current_daily_spend, 18)} TNZO`}
              cap={
                a.max_daily_spend === null
                  ? undefined
                  : { amount: formatBaseUnits(a.max_daily_spend, 18), currency: 'TNZO', window: 'day' }
              }
              chain="tenzro"
              state="active"
            />
          ))}
        </div>
      )}
    </div>
  );
}
