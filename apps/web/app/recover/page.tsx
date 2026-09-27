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

type Step = 'idle' | 'opening' | 'passkey' | 'approving' | 'finishing' | 'done';

const LABEL: Record<Step, string> = {
  idle: 'Recover wallet',
  opening: 'Opening the key file…',
  passkey: 'Create a passkey on this device…',
  approving: 'Approving with your recovery key…',
  finishing: 'Finishing…',
  done: 'Recovered',
};

export default function RecoverPage() {
  const router = useRouter();
  const [file, setFile] = React.useState<unknown>(null);
  const [pass, setPass] = React.useState('');
  const [step, setStep] = React.useState<Step>('idle');
  const [error, setError] = React.useState<string | null>(null);

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

  async function recover() {
    setError(null);
    let key: Awaited<ReturnType<typeof importRecoveryKey>> | null = null;
    try {
      setStep('opening');
      key = await importRecoveryKey(file, pass);
      setStep('passkey');
      const started = await custody().startRecovery({
        account: key.account,
        label: 'Recovered device',
      });
      setStep('approving');
      const submitted = await custody().submitRecoverySignature({
        recoveryId: started.recovery_id,
        guardianIndex: key.guardianIndex,
        signatureHex: key.signRecovery(started.recovery_op_hash_hex),
      });
      if (!submitted.quorum_reached) {
        throw new Error(
          `Your account needs ${submitted.guardians_required} approvals to recover; this key is one of them. Ask your other guardians to approve recovery ${started.recovery_id}.`,
        );
      }
      setStep('finishing');
      const done = await custody().finalizeRecovery(started.recovery_id);
      saveWallet({
        did: key.did,
        account: done.account_address,
        credentialId: started.credentialId,
        transports: [],
      });
      setStep('done');
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('idle');
    } finally {
      key?.wipe();
    }
  }

  const busy = step !== 'idle' && step !== 'done';
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Recover your wallet</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          For when every device is lost. Your recovery key approves a new passkey on this device,
          and every earlier passkey stops working. Have another device? Use it instead: it can link
          this one directly.
        </p>
      </div>
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
          <Button onClick={recover} disabled={busy || !file || pass.length === 0}>
            {LABEL[step]}
          </Button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
