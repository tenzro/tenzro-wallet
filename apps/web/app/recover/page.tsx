/**
 * Recover — every device is lost; the account's guardians let a new one in.
 *
 *   1. Start   make a passkey on this device and open a recovery for it
 *              (`tenzro_initiateRecovery`)
 *   2. Ask     send each guardian the request link; they approve on their
 *              own device at /guardian
 *   3. Finish  once enough independent guardians approved and the wait is
 *              over, complete it (`tenzro_finalizeRecovery`) and sign in
 *
 * During the wait any passkey still on the account can cancel the recovery.
 */

'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card, Input, Logo } from '@tenzro/ui';
import { Check, Copy, Fingerprint, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import * as React from 'react';
import {
  type RecoveryRequest,
  decodeRecoveryRequest,
  encodeRecoveryRequest,
} from 'tenzro-wallet/custody';

import { custody, signIn } from '@/lib/tenzro/wallet';

const STORE_KEY = 'tenzro.recovery';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function loadStarted(): RecoveryRequest | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    return raw ? decodeRecoveryRequest(raw) : null;
  } catch {
    return null;
  }
}

function saveStarted(r: RecoveryRequest | null): void {
  try {
    if (r) window.sessionStorage.setItem(STORE_KEY, encodeRecoveryRequest(r));
    else window.sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Storage can be unavailable; the recovery then lasts for this page.
  }
}

export default function RecoverPage() {
  const [started, setStarted] = React.useState<RecoveryRequest | null>(null);
  React.useEffect(() => setStarted(loadStarted()), []);
  const remember = (r: RecoveryRequest | null) => {
    saveStarted(r);
    setStarted(r);
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
            <Waiting request={started} onReset={() => remember(null)} />
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

function Start({ onStarted }: { readonly onStarted: (r: RecoveryRequest) => void }) {
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
    onSuccess: (s) => onStarted(s.request),
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
  request,
  onReset,
}: { readonly request: RecoveryRequest; readonly onReset: () => void }) {
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const link =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/guardian#r=${encodeRecoveryRequest(request)}`;
  const status = useQuery({
    queryKey: ['tenzro', 'recovery', request.recoveryId],
    queryFn: async () =>
      (await custody().listPendingRecoveries(request.account)).find(
        (r) => r.recovery_id === request.recoveryId,
      ) ?? null,
    refetchInterval: 20_000,
  });
  const finish = useMutation({
    mutationFn: async () => {
      await custody().finalizeRecovery(request.recoveryId);
      return signIn();
    },
    onSuccess: () => {
      onReset();
      router.push('/dashboard');
    },
  });
  const s = status.data;
  const ready =
    !!s && s.ready_at_ms !== null && s.ready_at_ms <= now && !s.finalized && !s.cancelled;
  const expired = request.expiresAtMs <= now;

  return (
    <Card variant="raised" className="p-6 space-y-4 text-sm">
      <p className="text-foreground-muted">
        A passkey for this wallet was made on this device. Send this link to each guardian. They
        open it on the device that holds their guardian passkey and approve.
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

      <div className="rounded-xl border border-border-subtle p-3 space-y-1">
        {status.isError && <p className="text-danger">{errorText(status.error)}</p>}
        {s === null && <p className="text-danger">The network no longer lists this recovery.</p>}
        {s?.cancelled && (
          <p className="text-danger">This recovery was cancelled from a device on the wallet.</p>
        )}
        {s && !s.cancelled && (
          <>
            <p>
              {s.guardian_signatures_collected} approval
              {s.guardian_signatures_collected === 1 ? '' : 's'} so far.
            </p>
            <p className="text-foreground-subtle">
              {s.ready_at_ms === null
                ? 'Approvals count by independent provider; the network decides when enough have arrived.'
                : s.ready_at_ms > now
                  ? `Enough guardians approved. It can complete ${new Date(s.ready_at_ms).toLocaleString()}.`
                  : 'Enough guardians approved and the wait is over.'}
            </p>
          </>
        )}
        {expired && !ready && (
          <p className="text-danger">This recovery has expired. Start a new one.</p>
        )}
      </div>

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
