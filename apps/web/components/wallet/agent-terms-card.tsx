'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@tenzro/ui';
import * as React from 'react';
import type { RawAgentTermsView } from 'tenzro-wallet/custody';

import { type AgentBondView, getAgentBond, updateAgentLimits } from '@/lib/tenzro/agents';
import {
  TNZO_DECIMALS,
  formatBaseUnits,
  shortDid,
  tnzoToBaseUnits,
  usdEstimate,
} from '@/lib/tenzro/format';
import { increaseAgentBond, postAgentBond, withdrawAgentBond } from '@/lib/tenzro/native-tx';
import { type StoredWallet, custody } from '@/lib/tenzro/wallet';

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
  quarantined: 'Quarantined',
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

function Limit({
  label,
  children,
}: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** TNZO typed by the person as wei; empty means no limit. */
function limitWei(text: string): string | null {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d+(\.\d{1,18})?$/.test(t)) throw new Error(`"${t}" is not an amount in TNZO.`);
  return tnzoToBaseUnits(t);
}

const asTnzo = (wei: string | null | undefined) =>
  wei ? formatBaseUnits(wei, TNZO_DECIMALS, 18) : '';

/**
 * Adds to an agent's bond, or withdraws it (the first withdrawal starts its
 * cooldown, one after the cooldown returns it), from the wallet's account,
 * signed by this device's passkey.
 */
function BondActions({
  view,
  wallet,
  bond,
  onDone,
}: {
  readonly view: RawAgentTermsView;
  readonly wallet: StoredWallet;
  readonly bond: AgentBondView | null | undefined;
  readonly onDone: () => void;
}) {
  const [amount, setAmount] = React.useState('');
  const active = bond?.state === 'Active';
  const add = useMutation({
    mutationFn: async () => {
      const wei = BigInt(limitWei(amount) ?? '0');
      if (wei === 0n) throw new Error('Enter an amount in TNZO.');
      return active
        ? increaseAgentBond(wallet, view.agent_did, wei)
        : postAgentBond(wallet, view.agent_did, wei);
    },
    onSuccess: () => {
      setAmount('');
      onDone();
    },
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawAgentBond(wallet, view.agent_did),
    onSuccess: onDone,
  });
  const cooling = bond?.state === 'Cooldown';
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex gap-2">
        <Input
          inputMode="decimal"
          placeholder="Add to bond, TNZO"
          aria-label="Add to bond"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button size="sm" disabled={add.isPending || !amount.trim()} onClick={() => add.mutate()}>
          {add.isPending ? 'Approve with your passkey…' : active ? 'Add' : 'Post bond'}
        </Button>
      </div>
      {bond && (active || cooling) ? (
        <Button
          variant="outline"
          size="sm"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate()}
        >
          {withdraw.isPending
            ? 'Approve with your passkey…'
            : cooling
              ? 'Return the bond'
              : 'Withdraw the bond (stops the agent)'}
        </Button>
      ) : null}
      {cooling && bond?.cooldown_until_ms ? (
        <p className="text-xs text-foreground-muted">
          Returnable from {new Date(bond.cooldown_until_ms).toLocaleString()}.
        </p>
      ) : null}
      {add.error ? <p className="text-sm text-danger">{add.error.message}</p> : null}
      {withdraw.error ? <p className="text-sm text-danger">{withdraw.error.message}</p> : null}
    </div>
  );
}

/** Edits the three spend limits; the passkey approves the new Terms. */
function LimitsEditor({
  view,
  scope,
  wallet,
  onDone,
}: {
  readonly view: RawAgentTermsView;
  readonly scope: Scope;
  readonly wallet: StoredWallet;
  readonly onDone: (changed: boolean) => void;
}) {
  const [perPayment, setPerPayment] = React.useState(asTnzo(scope.max_transaction_value));
  const [perHour, setPerHour] = React.useState(asTnzo(scope.max_hourly_spend));
  const [perDay, setPerDay] = React.useState(asTnzo(scope.max_daily_spend));
  const save = useMutation({
    mutationFn: () =>
      updateAgentLimits(wallet, view, {
        perPayment: limitWei(perPayment),
        perHour: limitWei(perHour),
        perDay: limitWei(perDay),
      }),
    onSuccess: () => onDone(true),
  });
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="block space-y-1 text-sm">
      <span className="text-foreground-muted">{label}, TNZO</span>
      <Input
        inputMode="decimal"
        placeholder="No limit"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      {field('Per payment', perPayment, setPerPayment)}
      {field('Per hour', perHour, setPerHour)}
      {field('Per day', perDay, setPerDay)}
      <p className="text-xs text-foreground-muted">
        The agent's bond must cover its limits: when a new limit needs more, the difference is
        posted from this wallet first, with the same passkey.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Approve with your passkey…' : 'Approve new limits'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={save.isPending}
          onClick={() => onDone(false)}
        >
          Cancel
        </Button>
      </div>
      {save.error ? <p className="text-sm text-danger">{save.error.message}</p> : null}
    </div>
  );
}

/**
 * One delegated agent: its consensus Terms in TNZO with a USD estimate at the
 * network's fee rate, its bond, what it has spent, and the passkey actions on
 * it: change its limits, or revoke it on every node.
 */
export function AgentTermsCard({
  view,
  rate,
  wallet,
  onChanged,
}: {
  readonly view: RawAgentTermsView;
  readonly rate: bigint | null;
  readonly wallet: StoredWallet;
  readonly onChanged: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const scope = ((view.terms as { delegation_scope?: Scope }).delegation_scope ?? {}) as Scope;
  const name = (view.terms as { agent_name?: string }).agent_name ?? shortDid(view.agent_did);
  const bond = useQuery({
    queryKey: ['tenzro', 'agent-bond', view.agent_did],
    queryFn: () => getAgentBond(view.agent_did),
  });
  const revoke = useMutation({
    mutationFn: () => custody().revokeDelegatedAgent({ account: wallet, agentDid: view.agent_did }),
    onSuccess: () => {
      setConfirming(false);
      onChanged();
    },
  });
  const live = view.status === 'active' || view.status === 'quarantined';
  const rootedHere = view.root_kind === 'passkey';

  return (
    <Card variant="raised" data-agent={view.agent_did}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{name}</CardTitle>
            <p className="mt-1 truncate font-mono text-xs text-foreground-muted">
              {view.agent_did}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Badge variant="outline">
              {view.root_kind === 'machine' ? 'Machine key' : 'Passkey'}
            </Badge>
            <Badge variant={view.status === 'active' ? 'success' : 'outline'}>
              {STATUS_TEXT[view.status]}
            </Badge>
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
          <Limit label="Bond">
            {bond.data ? (
              <>
                <Amount wei={bond.data.amount} rate={rate} />
                {bond.data.state !== 'Active' ? (
                  <span className="text-foreground-muted"> ({bond.data.state})</span>
                ) : null}
              </>
            ) : bond.isLoading ? (
              '…'
            ) : (
              'None posted'
            )}
          </Limit>
          {scope.max_split_fee_bps != null ? (
            <Limit label="Facilitator and relayer fees">
              at most {(scope.max_split_fee_bps / 100).toFixed(2)}%
            </Limit>
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
            US dollar amounts are estimates at the network's current TNZO rate; limits are held in
            TNZO.
          </p>
        ) : null}
        {live && rootedHere && editing ? (
          <LimitsEditor
            view={view}
            scope={scope}
            wallet={wallet}
            onDone={(changed) => {
              setEditing(false);
              if (changed) onChanged();
            }}
          />
        ) : null}
        {rootedHere && !editing ? (
          <BondActions
            view={view}
            wallet={wallet}
            bond={bond.data}
            onDone={() => void bond.refetch()}
          />
        ) : null}
        {live && rootedHere && !editing ? (
          confirming ? (
            <div className="space-y-2 rounded-md border border-danger/40 p-3">
              <p className="text-sm">
                Revoke {name}? It stops at once on every node and every network it was granted, and
                cannot be undone.
              </p>
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
            <div className="flex gap-2">
              {view.status === 'active' ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Change limits
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                Revoke
              </Button>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
