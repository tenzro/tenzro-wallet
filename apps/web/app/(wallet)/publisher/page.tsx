'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@tenzro/ui';
import * as React from 'react';
import { type SplitLine, type SplitRole, type SplitRule, validateSplitRule } from 'tenzro-sdk';

import { SignedOut } from '@/components/wallet/signed-out';
import { TNZO_DECIMALS, formatBaseUnits, shortAddress } from '@/lib/tenzro/format';
import { useWallet } from '@/lib/tenzro/hooks';
import { getPayeeSplit, listPayouts, previewSplit } from '@/lib/tenzro/methods';
import { nativeAccount, setPayeeSplit } from '@/lib/tenzro/native-tx';

const ROLES: { value: SplitRole; label: string }[] = [
  { value: 'publisher', label: 'Publisher' },
  { value: 'licensor', label: 'Licensor' },
  { value: 'referrer', label: 'Referrer' },
  { value: 'facilitator', label: 'Facilitator' },
  { value: 'relayer', label: 'Relayer' },
];

interface Row {
  role: SplitRole;
  recipient: string;
  percent: string;
}

const ONE_TNZO = 10n ** 18n;

function recipientOf(r: string): SplitLine['recipient'] {
  const v = r.trim();
  return v.startsWith('did:')
    ? { did_derived: v }
    : { address: v.replace(/^0x/, '').toLowerCase() };
}

/** The rule the rows describe: each row a basis-point line, this account the remainder. */
function ruleOf(rows: Row[], self: string): SplitRule {
  const lines: SplitLine[] = rows.map((r) => ({
    role: r.role,
    recipient: recipientOf(r.recipient),
    basis: { bps: Math.round(Number(r.percent) * 100) },
  }));
  lines.push({
    role: 'payee',
    recipient: { address: self.replace(/^0x/, '').toLowerCase() },
    basis: 'remainder',
  });
  return { version: 1, lines };
}

function describe(line: SplitLine): string {
  const who =
    line.recipient === 'leg_submitter'
      ? 'whoever decides the payment'
      : 'did_derived' in line.recipient
        ? line.recipient.did_derived
        : shortAddress(`0x${line.recipient.address}`);
  const share =
    line.basis === 'remainder'
      ? 'the rest'
      : 'bps' in line.basis
        ? `${line.basis.bps / 100}%`
        : `${line.basis.fixed} base units`;
  return `${line.role}: ${share} to ${who}`;
}

/**
 * Publisher mode: how every payment to this account is divided (its standing
 * split, which consensus applies to each payment after the protocol fee), and
 * the payments it has received. Changing the split is a transaction the
 * passkey signs.
 */
export default function PublisherPage() {
  const { wallet } = useWallet();
  const qc = useQueryClient();
  const self = useQuery({
    queryKey: ['tenzro', 'native-account', wallet?.account],
    queryFn: () => nativeAccount(wallet!),
    enabled: !!wallet,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const payee = self.data;
  const current = useQuery({
    queryKey: ['tenzro', 'payee-split', payee],
    queryFn: () => getPayeeSplit(payee!),
    enabled: !!payee,
  });
  const payouts = useQuery({
    queryKey: ['tenzro', 'payouts', payee],
    queryFn: () => listPayouts(payee!),
    enabled: !!payee,
    refetchInterval: 30_000,
  });
  const [rows, setRows] = React.useState<Row[]>([]);

  const draft = React.useMemo((): { rule?: SplitRule; error?: string } => {
    if (!payee || rows.length === 0) return {};
    try {
      const rule = ruleOf(rows, payee);
      validateSplitRule(rule);
      return { rule };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [rows, payee]);

  const preview = useQuery({
    queryKey: ['tenzro', 'split-preview', draft.rule],
    queryFn: () => previewSplit(ONE_TNZO, draft.rule!),
    enabled: !!draft.rule,
  });

  const save = useMutation({
    mutationFn: (rule: SplitRule | null) => setPayeeSplit(wallet!, rule),
    onSuccess: () => {
      setRows([]);
      void qc.invalidateQueries({ queryKey: ['tenzro', 'payee-split', payee] });
    },
  });

  if (!wallet) return <SignedOut what="how payments to you are divided" />;

  const rule = current.data?.rule ?? null;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Publisher</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          How every payment to you is divided, and what you have been paid.
          {payee ? <span className="ml-1 font-mono text-xs">{shortAddress(payee)}</span> : null}
        </p>
      </div>

      <Card variant="raised">
        <CardHeader>
          <CardTitle>Your split</CardTitle>
          <CardDescription>
            The network divides each payment to you by this rule, after its protocol fee.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {current.isLoading || self.isLoading ? (
            <p className="text-sm text-foreground-muted">Loading…</p>
          ) : self.error ? (
            <p className="text-sm text-danger">{String(self.error)}</p>
          ) : rule ? (
            <ul className="space-y-1 text-sm" data-testid="current-split">
              {rule.lines.map((l, i) => (
                <li key={i}>{describe(l)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted" data-testid="current-split">
              No split: every payment is yours in full.
            </p>
          )}
          {rule ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Clear split
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card variant="raised">
        <CardHeader>
          <CardTitle>New split</CardTitle>
          <CardDescription>Shares go to the people you name; the rest stays yours.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[8rem_1fr_6rem_auto] items-center gap-2">
              <select
                aria-label={`Role ${i + 1}`}
                className="h-10 rounded-xl border border-border-default bg-surface-1 px-2 text-sm"
                value={r.role}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) => (j === i ? { ...x, role: e.target.value as SplitRole } : x)),
                  )
                }
              >
                {ROLES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`Recipient ${i + 1}`}
                placeholder="Account (0x, 32 bytes) or DID"
                value={r.recipient}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, recipient: e.target.value } : x)))
                }
              />
              <Input
                aria-label={`Percent ${i + 1}`}
                inputMode="decimal"
                placeholder="%"
                value={r.percent}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRows([...rows, { role: 'publisher', recipient: '', percent: '' }])}
          >
            Add a share
          </Button>
          {draft.error ? <p className="text-sm text-danger">{draft.error}</p> : null}
          {preview.data ? (
            <div
              className="rounded-md border border-border-subtle p-3 text-sm"
              data-testid="split-preview"
            >
              <p className="mb-1 text-foreground-muted">A payment of 1 TNZO would divide as:</p>
              <p>
                Protocol fee: {formatBaseUnits(preview.data.allocation.fee.fee, TNZO_DECIMALS)} TNZO
              </p>
              {draft.rule?.lines.map((l, i) => (
                <p key={i}>
                  {l.role === 'payee' ? 'You' : l.role}:{' '}
                  {formatBaseUnits(preview.data.allocation.credits[i] ?? '0', TNZO_DECIMALS)} TNZO
                </p>
              ))}
            </div>
          ) : null}
          {draft.rule ? (
            <Button disabled={save.isPending} onClick={() => save.mutate(draft.rule!)}>
              {save.isPending ? 'Approve with your passkey…' : 'Set split with passkey'}
            </Button>
          ) : null}
          {save.error ? <p className="text-sm text-danger">{save.error.message}</p> : null}
        </CardContent>
      </Card>

      <Card variant="raised">
        <CardHeader>
          <CardTitle>Payouts</CardTitle>
          <CardDescription>Payments to you, as consensus recorded them.</CardDescription>
        </CardHeader>
        <CardContent>
          {payouts.isLoading ? (
            <p className="text-sm text-foreground-muted">Loading…</p>
          ) : (payouts.data?.payments.length ?? 0) === 0 ? (
            <p className="text-sm text-foreground-muted">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-border-subtle text-sm" data-testid="payouts">
              {payouts.data!.payments.map((p) => {
                const r = p.record as { amount?: string; payer?: string };
                return (
                  <li key={p.cursor} className="flex justify-between py-2">
                    <span className="font-mono text-xs">{shortAddress(p.tx_hash)}</span>
                    <span className="tabular-nums">
                      {r.amount ? `${formatBaseUnits(r.amount, TNZO_DECIMALS)} TNZO` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
