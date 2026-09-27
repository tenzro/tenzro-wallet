'use client';

import { AgentMandateCard, CHAINS, type ChainId, EmptyState } from '@tenzro/ui';
import { Bot } from 'lucide-react';

import { SignedOut } from '@/components/wallet/signed-out';
import { useMandates, useWallet } from '@/lib/tenzro/hooks';
import type { Mandate } from '@/lib/tenzro/methods';

function chainOf(m: Mandate): ChainId {
  const c = (m.chain ?? '').toLowerCase();
  return c in CHAINS ? (c as ChainId) : 'tenzro';
}

function stateOf(m: Mandate): 'active' | 'expired' {
  return m.expires_at && m.expires_at * 1000 < Date.now() ? 'expired' : 'active';
}

export default function AgentsPage() {
  const { wallet } = useWallet();
  const mandates = useMandates(wallet?.did);

  if (!wallet) return <SignedOut what="the agents you have authorised" />;

  const list = mandates.data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Agents you have allowed to pay on your behalf, and the limits you set for each.
        </p>
      </div>
      {mandates.isLoading ? (
        <p className="text-sm text-foreground-muted">Loading…</p>
      ) : mandates.error ? (
        <p className="text-sm text-danger">Could not read mandates: {String(mandates.error)}</p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents authorised"
          description="When you let an agent spend on your behalf, its mandate and limits appear here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((m) => (
            <AgentMandateCard
              key={m.mandate_id}
              kind="payment"
              agentName={m.agent_did.split(':').pop()?.slice(0, 12) ?? m.agent_did}
              agentDid={m.agent_did}
              summary={m.description ?? 'Payments within the limit below'}
              cap={{ amount: m.max_amount, currency: m.asset ?? 'TNZO' }}
              expiresAt={m.expires_at ? m.expires_at * 1000 : undefined}
              chain={chainOf(m)}
              state={stateOf(m)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
