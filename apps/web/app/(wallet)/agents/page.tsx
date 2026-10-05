'use client';

import { useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '@tenzro/ui';
import { Bot } from 'lucide-react';

import { AgentTermsCard } from '@/components/wallet/agent-terms-card';
import { SignedOut } from '@/components/wallet/signed-out';
import { useDelegatedAgents, useUsdRate, useWallet } from '@/lib/tenzro/hooks';

export default function AgentsPage() {
  const { wallet } = useWallet();
  const agents = useDelegatedAgents(wallet?.did);
  const rate = useUsdRate();
  const qc = useQueryClient();

  if (!wallet) return <SignedOut what="the agents you have authorised" />;

  const list = agents.data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Agents you have allowed to act on your behalf, the Terms you approved for each, and what they have spent.
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
          description="When you let an agent act on your behalf, its Terms and limits appear here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((view) => (
            <AgentTermsCard
              key={view.agent_did}
              view={view}
              rate={rate.data ?? null}
              account={wallet.account}
              approver={{ id: wallet.credentialId, transports: wallet.transports }}
              onRevoked={() => void qc.invalidateQueries({ queryKey: ['tenzro', 'delegated-agents', wallet.did] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
