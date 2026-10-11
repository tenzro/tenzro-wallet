'use client';

import { Button, Input, formatAmount } from '@tenzro/ui';
import { useEffect, useState } from 'react';

import { Field, Mono, Notice, Section, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import {
  type AgentForm,
  type AgentRecord,
  agentTerms,
  delegate,
  loadAgents,
  revoke,
  saveAgents,
} from '@/lib/agents';

const EMPTY: AgentForm = {
  name: '',
  maxPerTransaction: '',
  maxPerDay: '',
  allowList: '',
  machineDid: '',
  operatorDid: '',
  days: 30,
};

export default function Agents() {
  const { wallet, net } = useWallet();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [form, setForm] = useState<AgentForm>(EMPTY);
  const create = useAction();
  const remove = useAction();
  useEffect(() => setAgents(loadAgents()), []);
  if (!wallet || !net) return <Notice>Sign in first.</Notice>;

  const set = (patch: Partial<AgentForm>) => setForm((f) => ({ ...f, ...patch }));
  let preview: { perTx: bigint; perDay: bigint } | null = null;
  try {
    const t = agentTerms(wallet.did, form, Date.now());
    preview = {
      perTx: BigInt(t.delegation_scope?.max_transaction_value ?? '0'),
      perDay: BigInt(t.delegation_scope?.max_daily_spend ?? '0'),
    };
  } catch {
    preview = null;
  }

  return (
    <>
      <Section
        title="Agents"
        description="An agent acts for you only within limits your passkey approves. You can revoke it at any time."
      >
        {agents.length === 0 ? (
          <p className="text-sm text-foreground-muted">No agents from this device yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {agents.map((a) => (
              <li key={a.did} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-foreground-muted">
                    <Mono>{a.did}</Mono>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  pending={remove.pending}
                  onClick={() =>
                    remove.run(async () => {
                      await revoke(net.rpc, wallet, a.did);
                      const next = agents.filter((x) => x.did !== a.did);
                      saveAgents(next);
                      setAgents(next);
                    })
                  }
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        {remove.error ? <Notice tone="danger">{remove.error}</Notice> : null}
      </Section>
      <Section
        title="New agent"
        description="Your passkey approves these terms; the network enforces them on every action."
      >
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Most per payment" hint="TNZO">
            <Input
              inputMode="decimal"
              value={form.maxPerTransaction}
              onChange={(e) => set({ maxPerTransaction: e.target.value })}
            />
          </Field>
          <Field label="Most per day" hint="TNZO">
            <Input
              inputMode="decimal"
              value={form.maxPerDay}
              onChange={(e) => set({ maxPerDay: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="May pay only"
          hint="Accounts, one per line. Leave empty to allow any within the limits."
        >
          <textarea
            value={form.allowList}
            onChange={(e) => set({ allowList: e.target.value })}
            rows={3}
            className="w-full rounded-xl border border-border-default bg-surface-2 p-3 font-mono text-xs"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Serving node" hint="The node’s machine DID">
            <Input
              value={form.machineDid}
              onChange={(e) => set({ machineDid: e.target.value })}
              placeholder="did:..."
            />
          </Field>
          <Field label="Its operator" hint="The operator’s DID">
            <Input
              value={form.operatorDid}
              onChange={(e) => set({ operatorDid: e.target.value })}
              placeholder="did:..."
            />
          </Field>
        </div>
        <Field label="Expires after" hint="Days">
          <Input
            type="number"
            min={1}
            max={365}
            value={form.days}
            onChange={(e) => set({ days: Number(e.target.value) })}
          />
        </Field>
        {preview ? (
          <Notice>
            Up to {formatAmount(preview.perTx)} TNZO a payment and {formatAmount(preview.perDay)}{' '}
            TNZO a day, for {form.days} days.
          </Notice>
        ) : null}
        {create.error ? <Notice tone="danger">{create.error}</Notice> : null}
        <Button
          pending={create.pending}
          disabled={!preview}
          onClick={() =>
            create.run(async () => {
              const terms = agentTerms(wallet.did, form, Date.now());
              const made = await delegate(net.rpc, wallet, terms);
              const next = [
                ...agents,
                {
                  did: made.identity.did,
                  name: terms.agent_name,
                  address: made.wallet.address,
                  expiresAtMs: made.expires_at_ms ?? null,
                },
              ];
              saveAgents(next);
              setAgents(next);
              setForm(EMPTY);
            })
          }
        >
          Approve with passkey
        </Button>
      </Section>
    </>
  );
}
