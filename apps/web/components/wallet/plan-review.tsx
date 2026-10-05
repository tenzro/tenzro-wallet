'use client';

import { useQuery } from '@tanstack/react-query';
import type { SplitLine, SplitRule } from 'tenzro-sdk';
import type { PopupSignSettlementPlan } from 'tenzro-wallet';

import { TNZO_DECIMALS, formatBaseUnits, shortAddress, usdEstimate } from '@/lib/tenzro/format';
import { useUsdRate } from '@/lib/tenzro/hooks';
import { previewSplit } from '@/lib/tenzro/methods';

type Plan = PopupSignSettlementPlan['plan'];
type Leg = { kind?: Record<string, Record<string, unknown>>; class_required?: string; usd_e6?: number; max_network_fee?: string };

const CLASS_TEXT: Record<string, string> = {
  native: 'settles on Tenzro',
  proven: 'proven from its network',
  attested: 'attested by a bonded attestor',
};

const big = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : typeof v === 'number' ? BigInt(v) : 0n);
const usd = (e6: bigint) => `$${(e6 / 1_000_000n).toLocaleString('en-US')}.${((e6 % 1_000_000n) / 10_000n).toString().padStart(2, '0')}`;

/** One leg in words: what moves, where, and how its outcome is known. */
function legText(leg: Leg): string {
  const [kind, f] = Object.entries(leg.kind ?? {})[0] ?? ['unknown', {}];
  switch (kind) {
    case 'native_transfer':
      return `${formatBaseUnits(String(f.amount ?? '0'), TNZO_DECIMALS)} TNZO from your account on Tenzro`;
    case 'intent_fill':
      return `fill of order ${shortAddress(`0x${String(f.order_id ?? '')}`)}`;
    case 'hash_locked':
      return `hash-locked payment on ${String(f.chain ?? 'another network')}`;
    case 'remote_lock':
      return `lock on ${String(f.chain ?? 'another network')}`;
    case 'rail_instruction':
      return `payment over ${String(f.rail ?? 'a payment rail')}`;
    case 'netted':
      return 'netted against other payments';
    default:
      return kind.replace(/_/g, ' ');
  }
}

function lineText(l: SplitLine): string {
  const who =
    l.recipient === 'leg_submitter'
      ? 'whoever proves the outcome'
      : 'did_derived' in l.recipient
        ? l.recipient.did_derived
        : shortAddress(`0x${l.recipient.address}`);
  return `${l.role} (${who})`;
}

/**
 * What a settlement plan does, before the passkey signs its open
 * transaction: every leg and the network it settles on, the fees (the
 * protocol fee and each leg's network-fee cap), the division of the Tenzro
 * value by the split rule, and what commit and abort each do.
 */
export function PlanReview({ plan }: { readonly plan: Plan }) {
  const legs = plan.legs as Leg[];
  const split = plan.split as unknown as SplitRule;
  const funded = legs.reduce((t, l) => t + big(l.kind?.native_transfer?.amount), 0n);
  const caps = legs.reduce((t, l) => t + big(l.max_network_fee), 0n);
  const offTenzroUsd = legs.reduce((t, l) => (l.kind?.native_transfer ? t : t + big(l.usd_e6)), 0n);
  const rate = useUsdRate();
  const division = useQuery({
    queryKey: ['tenzro', 'plan-division', plan.split_hash, funded.toString(), caps.toString()],
    queryFn: () => previewSplit(funded, split, caps),
    enabled: funded > 0n,
  });
  const deadline = new Date(plan.decide_deadline_ms);

  return (
    <div className="space-y-4" data-testid="plan-review">
      <section>
        <h3 className="mb-1 font-medium">Legs</h3>
        <ol className="space-y-1">
          {legs.map((l, i) => (
            <li key={i} className="flex justify-between gap-3" data-testid="plan-leg">
              <span>
                {i + 1}. {legText(l)}
              </span>
              <span className="shrink-0 text-foreground-muted">
                {CLASS_TEXT[l.class_required ?? ''] ?? l.class_required}
                {l.usd_e6 ? `, ${usd(big(l.usd_e6))}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-1">
        <h3 className="font-medium">Fees</h3>
        {division.data ? (
          <p>
            Protocol fee: {formatBaseUnits(division.data.allocation.fee.fee, TNZO_DECIMALS)} TNZO
          </p>
        ) : null}
        <p>Network fees, at most: {formatBaseUnits(caps.toString(), TNZO_DECIMALS)} TNZO</p>
      </section>

      <section>
        <h3 className="mb-1 font-medium">Who is paid on commit</h3>
        {funded === 0n ? (
          <p className="text-foreground-muted">No Tenzro value is divided; each leg pays its own recipient.</p>
        ) : division.error ? (
          <p className="text-danger">This plan cannot be divided: {String(division.error)}</p>
        ) : (
          <ul className="space-y-1" data-testid="plan-split">
            {split.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{lineText(l)}</span>
                <span className="tabular-nums">
                  {division.data
                    ? `${formatBaseUnits(division.data.allocation.credits[i] ?? '0', TNZO_DECIMALS)} TNZO`
                    : '…'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1 rounded-md border border-border-subtle p-3">
        <p>
          <span className="font-medium">Total:</span> {formatBaseUnits(funded.toString(), TNZO_DECIMALS)} TNZO on Tenzro
          {offTenzroUsd > 0n ? ` and ${usd(offTenzroUsd)} on other networks` : ''}
          {rate.data && funded > 0n ? (
            <span className="text-foreground-muted"> (about {usdEstimate(funded, rate.data)} for the TNZO, an estimate)</span>
          ) : null}
        </p>
        <p>
          <span className="font-medium">Commit:</span> once every leg is shown done before{' '}
          {deadline.toLocaleString()}, the Tenzro value is divided as above.
        </p>
        <p>
          <span className="font-medium">Abort:</span> if any leg fails or the deadline passes, the plan aborts and
          everything it holds returns to you.
        </p>
      </section>
    </div>
  );
}
