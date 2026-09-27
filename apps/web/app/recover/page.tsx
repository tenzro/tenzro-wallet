'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@tenzro/ui';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { importRecoveryKey } from 'tenzro-wallet/custody';

import { custody, saveWallet } from '@/lib/tenzro/wallet';

type Step = 'idle' | 'opening' | 'passkey' | 'approving' | 'waiting' | 'finishing';

const LABEL: Record<Step, string> = {
  idle: 'Start recovery',
  opening: 'Opening the key file…',
  passkey: 'Create a passkey on this device…',
  approving: 'Approving with your recovery key…',
  waiting: 'Waiting',
  finishing: 'Finishing…',
};

/**
 * A recovery started on this device, kept so the person can come back when
 * its wait is over. Public data only: the passkey stays in the authenticator.
 */
interface StartedRecovery {
  readonly recoveryId: string;
  readonly account: string;
  readonly did: string;
  readonly credentialId: string;
  readonly readyAtMs: number;
}

const STORAGE_KEY = 'tenzro.recovery.v1';

function loadStarted(): StartedRecovery | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StartedRecovery) : null;
  } catch {
    return null;
  }
}

function storeStarted(r: StartedRecovery | null): void {
  try {
    if (r) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the recovery can still be finished from this page.
  }
}

function waitLabel(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

export default function RecoverPage() {
  const router = useRouter();
  const [file, setFile] = React.useState<unknown>(null);
  const [pass, setPass] = React.useState('');
  const [step, setStep] = React.useState<Step>('idle');
  const [started, setStarted] = React.useState<StartedRecovery | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const r = loadStarted();
    if (r) {
      setStarted(r);
      setStep('waiting');
    }
  }, []);

  React.useEffect(() => {
    if (step !== 'waiting') return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [step]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setFile(JSON.parse(await f.text()));
    } catch {
      setFile(null);
      setError('That file is not a recovery key.');
    }
  }

  async function start() {
    setError(null);
    let key: Awaited<ReturnType<typeof importRecoveryKey>> | null = null;
    try {
      setStep('opening');
      key = await importRecoveryKey(file, pass);
      setStep('passkey');
      const begun = await custody().startRecovery({
        account: key.account,
        label: 'Recovered device',
      });
      setStep('approving');
      const submitted = await custody().submitRecoverySignature({
        recoveryId: begun.recovery_id,
        guardianIndex: key.guardianIndex,
        signatureHex: key.signRecovery(begun.recovery_op_hash_hex),
      });
      if (!submitted.quorum_reached || submitted.ready_at_ms === null) {
        throw new Error(
          `Your account needs ${submitted.guardians_required} approvals to recover; this key is one of them. Ask your other guardians to approve recovery ${begun.recovery_id}.`,
        );
      }
      const r: StartedRecovery = {
        recoveryId: begun.recovery_id,
        account: key.account,
        did: key.did,
        credentialId: begun.credentialId,
        readyAtMs: submitted.ready_at_ms,
      };
      storeStarted(r);
      setStarted(r);
      setStep('waiting');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('idle');
    } finally {
      key?.wipe();
    }
  }

  async function finish() {
    if (!started) return;
    setError(null);
    setStep('finishing');
    try {
      const done = await custody().finalizeRecovery(started.recoveryId);
      saveWallet({
        did: started.did,
        account: done.account_address,
        credentialId: started.credentialId,
        transports: [],
      });
      storeStarted(null);
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('waiting');
    }
  }

  function forget() {
    storeStarted(null);
    setStarted(null);
    setStep('idle');
    setError(null);
  }

  const busy = step === 'opening' || step === 'passkey' || step === 'approving';
  const remaining = started ? started.readyAtMs - now : 0;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Recover your wallet</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          For when every device is lost. Your recovery key approves a new passkey on this device.
          The new passkey joins your account after a waiting period, and any of your existing
          devices can cancel it during the wait, so nobody can recover a wallet whose owner still
          has a device. Have another device? Use it instead: it can link this one directly.
        </p>
      </div>

      {started ? (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Recovery in progress</CardTitle>
            <CardDescription>
              {remaining > 0
                ? `This device's passkey joins your account in ${waitLabel(remaining)}. You can close this page and come back.`
                : 'The wait is over. Finish to start using your wallet on this device.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-foreground-subtle font-mono break-all">
              {started.account} · recovery {started.recoveryId.slice(0, 12)}…
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={finish} disabled={remaining > 0 || step === 'finishing'}>
                {step === 'finishing' ? LABEL.finishing : 'Finish recovery'}
              </Button>
              <Button variant="ghost" onClick={forget} disabled={step === 'finishing'}>
                Start over
              </Button>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </CardContent>
        </Card>
      ) : (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Recovery key</CardTitle>
            <CardDescription>The file you saved, and its passphrase.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="file" accept="application/json,.json" onChange={onFile} disabled={busy} />
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Passphrase"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              disabled={busy}
            />
            <Button onClick={start} disabled={busy || !file || pass.length === 0}>
              {LABEL[step]}
            </Button>
            {error && <p className="text-sm text-danger">{error}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
