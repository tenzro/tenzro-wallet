'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tenzro/ui';
import { Download } from 'lucide-react';
import * as React from 'react';
import { type CredentialRef, type PasskeyAccount, buildRecoveryKit } from 'tenzro-wallet/custody';

import { GuardiansPanel } from '@/components/wallet/guardians';
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
      // The keystore as the network holds it, and the anchor a fresh device
      // needs while the account has none on chain yet.
      const view = await custody().keystore(w);
      const record = { ...view, ...(w.anchor ? { anchor: w.anchor } : {}) };
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

  return (
    <Card variant="raised">
      <CardHeader>
        <CardTitle>Recovery</CardTitle>
        <CardDescription>
          Your wallet is your passkeys. Link a second device so that losing one never locks you out,
          and add guardians for the day every device is gone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <PendingRecoveries
          account={w}
          approver={{ id: w.credentialId, transports: w.transports }}
        />

        <GuardiansPanel account={w} approver={{ id: w.credentialId, transports: w.transports }} />

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
      </CardContent>
    </Card>
  );
}

/**
 * Recoveries started on this account. A recovery adds a new passkey after a
 * wait; one the owner did not start is cancelled here, with their passkey.
 */
function PendingRecoveries({
  account,
  approver,
}: {
  readonly account: PasskeyAccount;
  readonly approver: CredentialRef;
}) {
  const qc = useQueryClient();
  const key = ['tenzro', 'pendingRecovery', account.account];
  const pending = useQuery({
    queryKey: key,
    queryFn: () => custody().pendingRecovery(account),
    refetchInterval: 30_000,
  });
  const cancel = useMutation({
    mutationFn: () => custody().cancelRecovery({ account, approver }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const r = pending.data;
  if (!r) return null;

  return (
    <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-4">
      <p className="font-medium">Recovery in progress</p>
      <p className="text-foreground-muted">
        Someone started recovering this wallet onto a new device. If it was not you, cancel it now:
        it cannot complete once cancelled.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-foreground-subtle">
          {r.credential.credential_id.slice(0, 12)}… · completes after{' '}
          {new Date(r.ready_at_ms).toLocaleString()}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
        >
          {cancel.isPending ? 'Approve with your passkey…' : 'Cancel recovery'}
        </Button>
      </div>
      {cancel.error && <p className="text-danger">{cancel.error.message}</p>}
    </div>
  );
}
