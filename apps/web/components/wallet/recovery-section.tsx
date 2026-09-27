'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Separator,
} from '@tenzro/ui';
import { Download, KeyRound } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { buildRecoveryKit, createRecoveryKey, exportRecoveryKey } from 'tenzro-wallet/custody';

import { TENZRO_NETWORK_NAME, TENZRO_RP_ID } from '@/lib/tenzro/config';
import { useWallet } from '@/lib/tenzro/hooks';
import { custody } from '@/lib/tenzro/wallet';

function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function RecoverySection() {
  const { wallet } = useWallet();
  const [kitState, setKitState] = React.useState<'idle' | 'busy' | 'done' | string>('idle');
  const [pass, setPass] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [keyState, setKeyState] = React.useState<'idle' | 'busy' | 'done' | string>('idle');

  if (!wallet) {
    return (
      <Card variant="raised">
        <CardHeader>
          <CardTitle>Recovery</CardTitle>
          <CardDescription>Sign in to set up recovery for your wallet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const w = wallet;
  const short = w.account.slice(2, 10);

  async function saveKit() {
    setKitState('busy');
    try {
      const record = await custody().getAccountRecord(w.account);
      download(
        `tenzro-recovery-kit-${short}.json`,
        buildRecoveryKit({
          account: w.account,
          did: w.did,
          rpId: TENZRO_RP_ID,
          network: TENZRO_NETWORK_NAME,
          record,
        }),
      );
      setKitState('done');
    } catch (e) {
      setKitState(errorText(e));
    }
  }

  async function createKey() {
    if (pass.length < 12) return setKeyState('Use a passphrase of at least 12 characters.');
    if (pass !== confirm) return setKeyState('The two passphrases do not match.');
    setKeyState('busy');
    const created = createRecoveryKey();
    try {
      // Registering first gives the key its guardian position, which the file records.
      const added = await custody().addGuardian({
        account: w.account,
        guardian: {
          ed25519PublicKeyHex: created.key.ed25519PublicKeyHex,
          mlDsaPublicKeyHex: created.key.mlDsaPublicKeyHex,
          label: 'Recovery key',
        },
        approver: { id: w.credentialId, transports: w.transports },
      });
      const file = await exportRecoveryKey(created, {
        account: w.account,
        did: w.did,
        guardianIndex: added.guardian_count - 1,
        passphrase: pass,
      });
      download(`tenzro-recovery-key-${short}.json`, file);
      setPass('');
      setConfirm('');
      setKeyState('done');
    } catch (e) {
      setKeyState(errorText(e));
    } finally {
      created.key.wipe();
    }
  }

  return (
    <Card variant="raised">
      <CardHeader>
        <CardTitle>Recovery</CardTitle>
        <CardDescription>
          Your wallet is your passkeys. Link a second device first; these are for when every device
          is gone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          <p className="font-medium">Recovery Kit</p>
          <p className="text-foreground-muted">
            Your account, identity and the record of which keys may sign. It contains no keys, so it
            is safe to keep anywhere. Save a new one after you add or remove a device.
          </p>
          <Button variant="outline" size="sm" onClick={saveKit} disabled={kitState === 'busy'}>
            <Download className="size-4" />{' '}
            {kitState === 'busy' ? 'Preparing…' : 'Download Recovery Kit'}
          </Button>
          {kitState === 'done' && <p className="text-success">Saved.</p>}
          {!['idle', 'busy', 'done'].includes(kitState) && (
            <p className="text-danger">{kitState}</p>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="font-medium">Recovery key</p>
          <p className="text-foreground-muted">
            A key made on this device and saved as a file locked with a passphrase you choose. The
            file and the passphrase together can approve a new passkey for this wallet. Keep them
            apart, and keep both safe: anyone with both can recover your wallet.
          </p>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Passphrase (12 or more characters)"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Repeat the passphrase"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button size="sm" onClick={createKey} disabled={keyState === 'busy'}>
            <KeyRound className="size-4" />{' '}
            {keyState === 'busy' ? 'Approve with your passkey…' : 'Create recovery key'}
          </Button>
          {keyState === 'done' && (
            <p className="text-success">
              Recovery key created, registered on your account, and saved.
            </p>
          )}
          {!['idle', 'busy', 'done'].includes(keyState) && (
            <p className="text-danger">{keyState}</p>
          )}
        </div>

        <p className="text-foreground-subtle">
          Lost every device? Use your recovery key on the{' '}
          <Link href="/recover" className="underline underline-offset-2">
            recovery page
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
