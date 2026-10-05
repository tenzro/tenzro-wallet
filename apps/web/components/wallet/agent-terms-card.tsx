'use client';

import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@tenzro/ui';
import * as React from 'react';
import type { CredentialRef, RawAgentTermsView } from 'tenzro-wallet/custody';

import { TNZO_DECIMALS, formatBaseUnits, shortDid, usdEstimate } from '@/lib/tenzro/format';
import { custody } from '@/lib/tenzro/wallet';

type Scope = {
  max_transaction_value?: string | null;
  max_daily_spend?: string | null;
  max_hourly_spend?: string | null;
  allowed_operations?: string[];
  allowed_chains?: string[];
  asset_limits?: { asset: string; max_per_tx?: string | null; max_per_day: string }[];
  max_split_fee_bps?: number | null;
};

const STATUS_TEXT: Record<RawAgentTermsView['status'], string> = {
  active: 'Active',
  quarantined: 'Paused',
  revoked: 'Revoked',
  expired: 'Expired',
};

/** A wei amount as TNZO, with its USD estimate when the rate is known. */
function Amount({ wei, rate }: { readonly wei: string; readonly rate: bigint | null }) {
  return (
    <span className="tabular-nums">
      {formatBaseUnits(wei, TNZO_DECIMALS)} TNZO
      {rate !== null ? (
        <span className="text-foreground-muted"> (about {usdEstimate(BigInt(wei), rate)})</span>
      ) : null}
    </span>
  );
}

function Limit({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/**
 * One delegated agent: its consensus Terms in TNZO with a USD estimate at the
 * network's fee rate, what it has spent, and the one action that ends it.
 * Revoking is approved with the passkey and takes effect on every node.
 */
export function AgentTermsCard({
  view,
  rate,
  account,
  approver,
  onRevoked,
}: {
  readonly view: RawAgentTermsView;
  readonly rate: bigint | null;
  readonly account: string;
  readonly approver: CredentialRef;
  readonly onRevoked: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const scope = ((view.terms as { delegation_scope?: Scope }).delegation_scope ?? {}) as Scope;
  const name = (view.terms as { agent_name?: string }).agent_name ?? shortDid(view.agent_did);
  const revoke = useMutation({
    mutationFn: () => custody().revokeDelegatedAgent({ account, agentDid: view.agent_did, approver }),
    onSuccess: () => {
      setConfirming(false);
      onRevoked();
    },
  });
  const live = view.status === 'active' || view.status === 'quarantined';

  return (
    <Card variant="raised" data-agent={view.agent_did}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{name}</CardTitle>
            <p className="mt-1 truncate font-mono text-xs text-foreground-muted">{view.agent_did}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Badge variant="outline">{view.root_kind === 'machine' ? 'Machine key' : 'Passkey'}</Badge>
            <Badge variant={view.status === 'active' ? 'success' : 'outline'}>{STATUS_TEXT[view.status]}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-2">
          {scope.max_transaction_value ? (
            <Limit label="Per payment">
              <Amount wei={scope.max_transaction_value} rate={rate} />
            </Limit>
          ) : null}
          {scope.max_daily_spend ? (
            <Limit label="Per day">
              <Amount wei={scope.max_daily_spend} rate={rate} />
            </Limit>
          ) : null}
          {scope.max_hourly_spend ? (
            <Limit label="Per hour">
              <Amount wei={scope.max_hourly_spend} rate={rate} />
            </Limit>
          ) : null}
          <Limit label="Spent today">
            <Amount wei={view.spent.today} rate={rate} />
          </Limit>
          {view.spent.remaining_today !== null ? (
            <Limit label="Left today">
              <Amount wei={view.spent.remaining_today} rate={rate} />
            </Limit>
          ) : null}
          {scope.max_split_fee_bps != null ? (
            <Limit label="Facilitator and relayer fees">at most {(scope.max_split_fee_bps / 100).toFixed(2)}%</Limit>
          ) : null}
          {scope.allowed_chains && scope.allowed_chains.length > 0 ? (
            <Limit label="Networks">{scope.allowed_chains.join(', ')}</Limit>
          ) : null}
          {view.spent.assets.map((a) => (
            <Limit key={a.asset} label={`Spent today in ${a.asset.slice(0, 10)}`}>
              <span className="tabular-nums">{a.spent_today}</span>
            </Limit>
          ))}
        </dl>
        {rate !== null ? (
          <p className="text-xs text-foreground-muted">
            US dollar amounts are estimates at the network's current TNZO rate; limits are held in TNZO.
          </p>
        ) : null}
        {live ? (
          confirming ? (
            <div className="space-y-2 rounded-md border border-danger/40 p-3">
              <p className="text-sm">
                Revoke {name}? It stops at once on every node and every network it was granted, and cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                  {revoke.isPending ? 'Approve with your passkey…' : 'Revoke with passkey'}
                </Button>
                <Button variant="secondary" size="sm" disabled={revoke.isPending} onClick={() => setConfirming(false)}>
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
