'use client';

import type { ReactNode } from 'react';
import type { AgentActionWire } from 'tenzro-wallet/custody';

import { TNZO_DECIMALS, formatBaseUnits, shortDid } from '@/lib/tenzro/format';

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="shrink-0 text-foreground-muted">{label}</dt>
      <dd className="min-w-0 break-all text-right">{children}</dd>
    </div>
  );
}

/**
 * What a held agent action does, as the person approves it: the agent, the
 * operation, the value and where it goes. Every field shown is bound by the
 * digest the passkey signs.
 */
export function StepUpReview({ action }: { readonly action: AgentActionWire }) {
  const amount = String(action.amount ?? '0');
  return (
    <dl className="space-y-2">
      <Row label="Agent">
        <span className="font-mono text-xs">{shortDid(action.agent_did, 10)}</span>
      </Row>
      <Row label="Action">{action.operation}</Row>
      {amount !== '0' ? (
        <Row label="Amount">
          {action.asset ? (
            <span className="tabular-nums">
              {amount} units of {action.asset}
              {action.usd_e6 ? ` (about $${(action.usd_e6 / 1e6).toFixed(2)})` : ''}
            </span>
          ) : (
            <span className="tabular-nums">{formatBaseUnits(amount, TNZO_DECIMALS, 18)} TNZO</span>
          )}
        </Row>
      ) : null}
      {action.counterparty ? (
        <Row label="To">
          <span className="font-mono text-xs">0x{action.counterparty.replace(/^0x/, '')}</span>
        </Row>
      ) : null}
      {action.chain && action.chain !== 'tenzro' ? <Row label="Network">{action.chain}</Row> : null}
      {action.payment_protocol ? <Row label="Paid through">{action.payment_protocol}</Row> : null}
      {action.payment ? <Row label="Payment">{action.payment.payment_id}</Row> : null}
      {action.model ? <Row label="Model">{action.model}</Row> : null}
      {action.calls && action.calls.length > 0 ? (
        <Row label="Contract calls">
          {action.calls.length} on{' '}
          {[...new Set(action.calls.map((c) => c.vm.toUpperCase()))].join(', ')}
        </Row>
      ) : null}
      {action.ballot ? (
        <Row label="Vote">
          {action.ballot.in_favour ? 'For' : 'Against'} {action.ballot.proposal_id}
        </Row>
      ) : null}
      {action.veto_signal ? <Row label="Veto signal">{action.veto_signal}</Row> : null}
      <Row label="Served by">
        <span className="font-mono text-xs">{shortDid(action.machine_did, 10)}</span>
      </Row>
      {action.tainted ? (
        <p className="rounded-md border border-danger/40 p-2 text-sm text-danger">
          Content from outside this agent's Terms reached it before it proposed this action. Check
          every detail.
        </p>
      ) : null}
    </dl>
  );
}
