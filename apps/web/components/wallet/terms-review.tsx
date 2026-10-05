'use client';

import type { ReactNode } from 'react';
import type { AgentTermsWire } from 'tenzro-wallet';

import { TNZO_DECIMALS, formatBaseUnits } from '@/lib/tenzro/format';

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="shrink-0 text-foreground-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}

const tnzo = (wei: string | null | undefined) =>
  wei ? `${formatBaseUnits(wei, TNZO_DECIMALS, 18)} TNZO` : 'No limit';

const list = (items: readonly string[] | undefined) =>
  items && items.length > 0 ? items.join(', ') : 'Any';

/** The Terms an agent will act under, as the person approves them. */
export function TermsReview({ terms }: { readonly terms: AgentTermsWire }) {
  const s = terms.delegation_scope ?? {};
  return (
    <dl className="space-y-2">
      <Row label="Agent">{terms.agent_name}</Row>
      <Row label="Per payment">{tnzo(s.max_transaction_value)}</Row>
      <Row label="Per hour">{tnzo(s.max_hourly_spend)}</Row>
      <Row label="Per day">{tnzo(s.max_daily_spend)}</Row>
      {s.step_up_above ? <Row label="Ask me above">{tnzo(s.step_up_above)}</Row> : null}
      {s.step_up_new_counterparty ? <Row label="Ask me for">every new recipient</Row> : null}
      <Row label="Actions">{list(s.allowed_operations)}</Row>
      <Row label="Networks">{list(s.allowed_chains)}</Row>
      {s.allowed_payment_protocols && s.allowed_payment_protocols.length > 0 ? (
        <Row label="Pays through">{s.allowed_payment_protocols.join(', ')}</Row>
      ) : null}
      {s.allowed_models && s.allowed_models.length > 0 ? (
        <Row label="Models">{s.allowed_models.join(', ')}</Row>
      ) : null}
      {s.allowed_counterparties && s.allowed_counterparties.length > 0 ? (
        <Row label="Recipients">{s.allowed_counterparties.length} listed</Row>
      ) : null}
      {s.asset_limits?.map((a) => (
        <Row key={a.asset} label={`Per day in ${a.asset.slice(0, 10)}`}>
          {a.max_per_day}
        </Row>
      ))}
      <Row label="Served by">
        {terms.serving_nodes.length} node{terms.serving_nodes.length === 1 ? '' : 's'}
      </Row>
      <Row label="Expires">
        {terms.expires_at_ms ? new Date(terms.expires_at_ms).toUTCString() : 'Never'}
      </Row>
      {terms.trifecta_exception ? (
        <p className="rounded-md border border-danger/40 p-2 text-sm text-danger">
          These Terms let the agent read private data, take in outside content and send data out
          together. Approve only an agent you trust with all three.
        </p>
      ) : null}
    </dl>
  );
}
