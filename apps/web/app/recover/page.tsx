/**
 * Recover — every device is lost; the account's guardians let a new one in.
 *
 *   1. Start   make a passkey on this device and build the recovery change
 *              for the account's keystore
 *   2. Ask     send each guardian the request link; each approves on their
 *              own device at /guardian and sends back an approval code
 *   3. Send    with enough approvals, this device sends the recovery from the
 *              account itself, signed by its new passkey
 *   4. Finish  once the wait is over, complete it and sign in
 *
 * During the wait any passkey still on the account can cancel the recovery.
 * Nothing is kept by this site: the recovery is on the network.
 */

'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card, Input, Logo } from '@tenzro/ui';
import { Check, Copy, Fingerprint, LifeBuoy, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import * as React from 'react';
import {
  type RecoveryApproval,
  type RecoveryRequest,
  decodeRecoveryApproval,
  decodeRecoveryRequest,
  encodeRecoveryApproval,
  encodeRecoveryRequest,
} from 'tenzro-wallet/custody';

import { custody, signIn } from '@/lib/tenzro/wallet';

const STORE_KEY = 'tenzro.recovery.v2';

interface Started {
  readonly request: RecoveryRequest;
  readonly credentialId: string;
  readonly approvals: readonly RecoveryApproval[];
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function loadStarted(): Started | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { request: string; credentialId: string; approvals: string[] };
    return {
      request: decodeRecoveryRequest(s.request),
      credentialId: s.credentialId,
      approvals: s.approvals.map(decodeRecoveryApproval),
    };
  } catch {
    return null;
  }
}

function saveStarted(s: Started | null): void {
  try {
    if (!s) {
      window.sessionStorage.removeItem(STORE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        request: encodeRecoveryRequest(s.request),
        credentialId: s.credentialId,
        approvals: s.approvals.map(encodeRecoveryApproval),
      }),
    );
  } catch {
    // Storage can be unavailable; the recovery then lasts for this page.
  }
}

export default function RecoverPage() {
  const [started, setStarted] = React.useState<Started | null>(null);
  React.useEffect(() => setStarted(loadStarted()), []);
  const remember = (s: Started | null) => {
    saveStarted(s);
    setStarted(s);
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-border-subtle">
        <Link href="/">
          <Logo size={28} withWordmark />
        </Link>
      </header>
      <main className="flex-1 flex justify-center px-4 py-10">
        <div className="w-full max-w-xl space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Recover a wallet</h1>
          {started ? (
            <Waiting started={started} onChange={remember} onReset={() => remember(null)} />
          ) : (
            <Start onStarted={remember} />
          )}
        </div>
      </main>
    </div>
  );
}

function accountFromKit(text: string): string | null {
  try {
    const kit = JSON.parse(text) as { format?: string; account?: string };
    return kit.format === 'tenzro-recovery-kit' && typeof kit.account === 'string'
      ? kit.account
      : null;
  } catch {
    return null;
  }
}

function Start({ onStarted }: { readonly onStarted: (s: Started) => void }) {
  const [account, setAccount] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [kitError, setKitError] = React.useState<string | null>(null);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(account.trim());
  const start = useMutation({
    mutationFn: () =>
      custody().startRecovery({
        account: account.trim(),
        label: label.trim() || 'Recovered device',
      }),
    onSuccess: (s) =>
      onStarted({ request: s.request, credentialId: s.credentialId, approvals: [] }),
  });

  return (
    <Card variant="raised" className="p-6 space-y-4 text-sm">
      <p className="text-foreground-muted">
        If you still have a device with this wallet, link a new one from it instead. Recovery is for
        when every device is gone: your guardians approve a new passkey made here, and after a
        waiting period it joins the wallet.
      </p>
      <Input
        value={account}
        onChange={(e) => setAccount(e.target.value)}
        placeholder="Account address (0x…)"
        aria-label="Account address"
        spellCheck={false}
      />
      <label className="block text-foreground-subtle">
        Or open your Recovery Kit{' '}
        <input
          type="file"
          accept="application/json,.json"
          className="text-xs"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void f.text().then((t) => {
              const a = accountFromKit(t);
              setKitError(a ? null : 'That file is not a Tenzro Recovery Kit.');
              if (a) setAccount(a);
            });
          }}
        />
      </label>
      {kitError && <p className="text-danger">{kitError}</p>}
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name for this device"
        aria-label="Device name"
        maxLength={64}
      />
      <Button
        variant="primary"
        size="md"
        leftIcon={<Fingerprint className="size-4" />}
        pending={start.isPending}
        disabled={!valid || start.isPending}
        onClick={() => start.mutate()}
      >
        Make a passkey and start recovery
      </Button>
      {start.error && <p className="text-danger">{errorText(start.error)}</p>}
    </Card>
  );
}

function Waiting({
  started,
  onChange,
  onReset,
}: {
  readonly started: Started;
  readonly onChange: (s: Started) => void;
  readonly onReset: () => void;
}) {
  const router = useRouter();
  const { request, credentialId, approvals } = started;
  const account = `0x${request.update.account.replace(/^0x/, '')}`;
  const [copied, setCopied] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const link =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/guardian#r=${encodeRecoveryRequest(request)}`;
  const pending = useQuery({
    queryKey: ['tenzro', 'pendingRecovery', account],
    queryFn: () => custody().pendingRecovery(account),
    refetchInterval: 20_000,
  });
  const submit = useMutation({
    mutationFn: () => custody().submitRecovery({ request, approvals, credentialId }),
    onSuccess: () => void pending.refetch(),
  });
  const finish = useMutation({
    mutationFn: async () => {
      await custody().finishRecovery({ account, credentialId });
      return signIn();
    },
    onSuccess: () => {
      onReset();
      router.push('/dashboard');
    },
  });
  const p = pending.data;
  const ours =
    !!p && p.credential.credential_id.replace(/^0x/, '') === credentialId.replace(/^0x/, '');
  const ready = ours && p.ready_at_ms <= now;
  const addCode = () => {
    try {
      const a = decodeRecoveryApproval(code);
      if (a.account.replace(/^0x/, '') !== request.update.account.replace(/^0x/, '')) {
        throw new Error('That approval is for another account.');
      }
      if (!approvals.some((x) => x.public_key === a.public_key))
        onChange({ ...started, approvals: [...approvals, a] });
      setCode('');
      setCodeError(null);
    } catch (e) {
      setCodeError(errorText(e));
    }
  };

  return (
    <Card variant="raised" className="p-6 space-y-4 text-sm">
      <p className="text-foreground-muted">
        A passkey for this wallet was made on this device. Send this link to each guardian. They
        open it on the device that holds their guardian passkey, approve, and send you back an
        approval code.
      </p>
      <div className="flex justify-center rounded-xl bg-white p-4">
        <QRCodeSVG value={link} size={196} />
      </div>
      <div className="flex items-center gap-2">
        <p className="font-mono text-xs break-all flex-1 rounded-xl bg-surface-1 border border-border-subtle p-3">
          {link}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {!ours && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste a guardian's approval code"
              aria-label="Guardian approval code"
              spellCheck={false}
            />
            <Button variant="secondary" size="md" onClick={addCode} disabled={!code.trim()}>
              Add
            </Button>
          </div>
          {codeError && <p className="text-danger">{codeError}</p>}
          <p className="text-foreground-subtle">
            {approvals.length} of {request.threshold} approval{request.threshold === 1 ? '' : 's'}{' '}
            needed. Approvals count by independent provider.
          </p>
          <Button
            variant="primary"
            size="md"
            leftIcon={<Send className="size-4" />}
            pending={submit.isPending}
            disabled={approvals.length < request.threshold || submit.isPending}
            onClick={() => submit.mutate()}
          >
            Send the recovery
          </Button>
          <p className="text-foreground-subtle">
            It is sent from the wallet itself, so the wallet pays its small network fee.
          </p>
          {submit.error && <p className="text-danger">{errorText(submit.error)}</p>}
        </div>
      )}

      {ours && (
        <div className="rounded-xl border border-border-subtle p-3 space-y-1">
          <p>
            {ready
              ? 'The wait is over: complete the recovery.'
              : `The recovery is on the network. It can complete ${new Date(p.ready_at_ms).toLocaleString()}.`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          size="md"
          leftIcon={<LifeBuoy className="size-4" />}
          pending={finish.isPending}
          disabled={!ready || finish.isPending}
          onClick={() => finish.mutate()}
        >
          Complete recovery
        </Button>
        <Button variant="ghost" size="md" onClick={onReset}>
          Start over
        </Button>
      </div>
      {finish.error && <p className="text-danger">{errorText(finish.error)}</p>}
    </Card>
  );
}
