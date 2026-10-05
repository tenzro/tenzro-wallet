'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@tenzro/ui';
import { Bot } from 'lucide-react';
import * as React from 'react';
import { type AgentStepUp, type StepUpRequest, parseStepUpRequest } from 'tenzro-wallet/custody';

import { AgentTermsCard } from '@/components/wallet/agent-terms-card';
import { SignedOut } from '@/components/wallet/signed-out';
import { StepUpReview } from '@/components/wallet/step-up-review';
import { type RootedMachine, approveStepUp } from '@/lib/tenzro/agents';
import { useRootedIdentities, useUsdRate, useWallet } from '@/lib/tenzro/hooks';
import { type StoredWallet, custody } from '@/lib/tenzro/wallet';

/**
 * A held action handed over as text (an agent run from a terminal prints the
 * action and the node's step_up data): review it, approve it with the
 * passkey, and copy the step_up back to the agent.
 */
function HeldAction({ wallet }: { readonly wallet: StoredWallet }) {
  const [text, setText] = React.useState('');
  const [request, setRequest] = React.useState<StepUpRequest | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<AgentStepUp | null>(null);
  const approve = useMutation({
    mutationFn: (r: StepUpRequest) => approveStepUp(wallet, r),
    onSuccess: setResult,
  });

  function review() {
    setParseError(null);
    setResult(null);
    try {
      setRequest(parseStepUpRequest(text));
    } catch (e) {
      setRequest(null);
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }

  const out = result ? JSON.stringify(result) : '';
  return (
    <Card variant="raised">
      <CardHeader>
        <CardTitle>Approve a held action</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-foreground-muted">
          When an agent's Terms hold an action for you, the agent shows the action and the network's
          challenge for it. Paste both here as JSON,{' '}
          <span className="font-mono">{'{"action": …, "step_up": …}'}</span>.
        </p>
        <textarea
          className="h-28 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Held action"
        />
        <Button size="sm" variant="outline" disabled={!text.trim()} onClick={review}>
          Review
        </Button>
        {parseError ? <p className="text-sm text-danger">{parseError}</p> : null}
        {request && !result ? (
          <div className="space-y-3 rounded-md border border-border p-3">
            <StepUpReview action={request.action} />
            <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(request)}>
              {approve.isPending ? 'Approve with your passkey…' : 'Approve this action'}
            </Button>
            {approve.error ? <p className="text-sm text-danger">{approve.error.message}</p> : null}
          </div>
        ) : null}
        {result ? (
          <div className="space-y-2">
            <p className="text-sm">
              Approved. Give the agent this step_up and it sends the action again:
            </p>
            <textarea
              readOnly
              className="h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
              value={out}
              aria-label="Step-up approval"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(out)}
            >
              Copy
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A machine registered under this identity, and the passkey action that ends it. */
function MachineCard({
  machine,
  wallet,
  onRevoked,
}: {
  readonly machine: RootedMachine;
  readonly wallet: StoredWallet;
  readonly onRevoked: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const revoke = useMutation({
    mutationFn: () => custody().revokeDelegatedAgent({ account: wallet, agentDid: machine.did }),
    onSuccess: () => {
      setConfirming(false);
      onRevoked();
    },
  });
  const active = machine.status.toLowerCase() === 'active';
  return (
    <Card variant="raised" data-machine={machine.did}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{machine.displayName ?? 'Machine'}</CardTitle>
            <p className="mt-1 truncate font-mono text-xs text-foreground-muted">{machine.did}</p>
          </div>
          <Badge variant={active ? 'success' : 'outline'}>{machine.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {active ? (
          confirming ? (
            <div className="space-y-2 rounded-md border border-danger/40 p-3">
              <p className="text-sm">Revoke this machine? Every node refuses it from then on.</p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate()}
                >
                  {revoke.isPending ? 'Approve with your passkey…' : 'Revoke with passkey'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </Button>
              </div>
              {revoke.error ? <p className="text-sm text-danger">{revoke.error.message}</p> : null}
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AgentsPage() {
  const { wallet } = useWallet();
  const rooted = useRootedIdentities(wallet?.did);
  const rate = useUsdRate();
  const qc = useQueryClient();

  if (!wallet) return <SignedOut what="the agents and machines you have authorised" />;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['tenzro', 'rooted', wallet.did] });
  const agents = rooted.data?.agents ?? [];
  const machines = rooted.data?.machines ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Agents you have allowed to act on your behalf, the Terms you approved for each and what
          they have spent, and the machines registered under your identity. Approvals here are
          signed by the passkey your identity was created with.
        </p>
      </div>
      <HeldAction wallet={wallet} />
      {rooted.isLoading ? (
        <p className="text-sm text-foreground-muted">Loading…</p>
      ) : rooted.error ? (
        <p className="text-sm text-danger">Could not read your agents: {String(rooted.error)}</p>
      ) : agents.length === 0 && machines.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents authorised"
          description="When you let an agent act on your behalf, its Terms and limits appear here."
        />
      ) : (
        <>
          {agents.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {agents.map((view) => (
                <AgentTermsCard
                  key={view.agent_did}
                  view={view}
                  rate={rate.data ?? null}
                  wallet={wallet}
                  onChanged={refresh}
                />
              ))}
            </div>
          ) : null}
          {machines.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-lg tracking-tight">Machines</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {machines.map((m) => (
                  <MachineCard key={m.did} machine={m} wallet={wallet} onRevoked={refresh} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
