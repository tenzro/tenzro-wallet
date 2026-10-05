/**
 * Guardian — from a guardian's own device.
 *
 *   Become a guardian   make a guardian passkey here and send its card to
 *                       the account holder (public data only)
 *   Approve a recovery  open a recovery request (link or pasted text), check
 *                       it against the network and approve it with the
 *                       guardian passkey on this device
 *
 * The guardian needs no wallet of their own.
 */

'use client';

import { useMutation } from '@tanstack/react-query';
import { Button, Card, Input, Logo, Tabs, TabsContent, TabsList, TabsTrigger } from '@tenzro/ui';
import { Check, Copy, KeyRound, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import {
  type GuardianSource,
  type RecoveryRequest,
  decodeRecoveryRequest,
  encodeGuardianCard,
  encodeRecoveryApproval,
} from 'tenzro-wallet/custody';

import { shortAddress } from '@/lib/tenzro/format';
import { custody } from '@/lib/tenzro/wallet';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function CopyButton({ text }: { readonly text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={done ? <Check className="size-4" /> : <Copy className="size-4" />}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setDone(true));
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

export default function GuardianPage() {
  const [request, setRequest] = React.useState('');
  React.useEffect(() => {
    const m = /(?:^#|&)r=([^&]+)/.exec(window.location.hash);
    if (m?.[1]) setRequest(decodeURIComponent(m[1]));
  }, []);

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-border-subtle">
        <Link href="/">
          <Logo size={28} withWordmark />
        </Link>
      </header>
      <main className="flex-1 flex justify-center px-4 py-10">
        <div className="w-full max-w-xl space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Guardian</h1>
          <Tabs defaultValue={request ? 'approve' : 'become'} key={request ? 'a' : 'b'}>
            <TabsList>
              <TabsTrigger value="become">Become a guardian</TabsTrigger>
              <TabsTrigger value="approve">Approve a recovery</TabsTrigger>
            </TabsList>
            <TabsContent value="become">
              <BecomeGuardian />
            </TabsContent>
            <TabsContent value="approve">
              <ApproveRecovery initial={request} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

const SOURCES: { value: GuardianSource; title: string; body: string }[] = [
  {
    value: 'trusted_person',
    title: 'For someone I know',
    body: 'A passkey on this device, kept for them.',
  },
  {
    value: 'own_passkey',
    title: 'For my own wallet',
    body: 'A passkey on another device of mine.',
  },
  {
    value: 'security_key',
    title: 'On a security key',
    body: 'A hardware key; recoveries it approves wait the shortest.',
  },
];

function BecomeGuardian() {
  const [label, setLabel] = React.useState('');
  const [source, setSource] = React.useState<GuardianSource>('trusted_person');
  const create = useMutation({
    mutationFn: () =>
      custody().createGuardian({
        label,
        source,
        ...(source === 'security_key' ? { hints: ['security-key'] as const } : {}),
      }),
  });
  const card = create.data ? encodeGuardianCard(create.data) : null;

  return (
    <Card variant="raised" className="p-6 space-y-4 text-sm">
      <p className="text-foreground-muted">
        This makes a guardian passkey on this device. Nothing secret leaves it: you send the account
        holder a card with its public key, and later approve a recovery with the same passkey.
      </p>
      <div className="grid grid-cols-1 gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setSource(s.value)}
            className={`rounded-xl border p-3 text-left ${
              source === s.value ? 'border-border-strong bg-surface-2' : 'border-border-subtle'
            }`}
          >
            <p className="font-medium">{s.title}</p>
            <p className="text-foreground-subtle">{s.body}</p>
          </button>
        ))}
      </div>
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="A name the account holder will see"
        aria-label="Guardian name"
        maxLength={64}
      />
      <Button
        variant="primary"
        size="md"
        leftIcon={<KeyRound className="size-4" />}
        pending={create.isPending}
        disabled={create.isPending || !label.trim()}
        onClick={() => create.mutate()}
      >
        Make guardian passkey
      </Button>
      {create.error && <p className="text-danger">{errorText(create.error)}</p>}
      {card && (
        <div className="space-y-2">
          <p className="font-medium">Send this card to the account holder</p>
          <p className="font-mono text-xs break-all rounded-xl bg-surface-1 border border-border-subtle p-3">
            {card}
          </p>
          <CopyButton text={card} />
        </div>
      )}
    </Card>
  );
}

function ApproveRecovery({ initial }: { readonly initial: string }) {
  const [text, setText] = React.useState(initial);
  React.useEffect(() => setText(initial), [initial]);
  const parsed = React.useMemo((): { request?: RecoveryRequest; error?: string } => {
    if (!text.trim()) return {};
    try {
      return { request: decodeRecoveryRequest(text) };
    } catch (e) {
      return { error: errorText(e) };
    }
  }, [text]);
  const approve = useMutation({
    mutationFn: (r: RecoveryRequest) => custody().approveRecovery(r),
  });
  const r = parsed.request;
  const joining =
    r && typeof r.update.op === 'object' && 'start_recovery' in r.update.op
      ? r.update.op.start_recovery.credential
      : null;
  const code = approve.data ? encodeRecoveryApproval(approve.data) : '';

  return (
    <Card variant="raised" className="p-6 space-y-4 text-sm">
      <p className="text-foreground-muted">
        Approve only if the account holder asked you directly, in person or by a channel you trust.
        Approving lets a new passkey into their wallet once enough guardians agree and the wait is
        over.
      </p>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Recovery request"
        aria-label="Recovery request"
        spellCheck={false}
      />
      {parsed.error && <p className="text-danger">{parsed.error}</p>}
      {r && (
        <div className="space-y-1 rounded-xl bg-surface-1 border border-border-subtle p-3">
          <p>
            Account{' '}
            <span className="font-mono">
              {shortAddress(`0x${r.update.account.replace(/^0x/, '')}`)}
            </span>
          </p>
          <p>
            New passkey <span className="font-mono">{joining?.credential_id.slice(0, 16)}…</span>
            {joining?.label ? ` (${joining.label})` : ''}
          </p>
        </div>
      )}
      <Button
        variant="primary"
        size="md"
        leftIcon={<ShieldCheck className="size-4" />}
        pending={approve.isPending}
        disabled={!r || approve.isPending || approve.isSuccess}
        onClick={() => r && approve.mutate(r)}
      >
        Approve with my guardian passkey
      </Button>
      {approve.error && <p className="text-danger">{errorText(approve.error)}</p>}
      {approve.data && (
        <div className="space-y-2">
          <p className="text-success">
            Approved. Send this approval code back to the account holder; their new device sends the
            recovery with it.
          </p>
          <p className="font-mono text-xs break-all rounded-xl bg-surface-1 border border-border-subtle p-3">
            {code}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(code)}
          >
            Copy approval code
          </Button>
        </div>
      )}
    </Card>
  );
}
