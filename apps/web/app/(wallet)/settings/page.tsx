/**
 * Settings — linked devices, recovery, network, agent defaults.
 */

'use client';

import { Cpu, Fingerprint, Globe, Shield, Smartphone } from 'lucide-react';
import type * as React from 'react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@tenzro/ui';
import { assessReadiness } from 'tenzro-wallet/custody';

import { LinkDeviceActions } from '@/components/wallet/link-device';
import { RecoverySection } from '@/components/wallet/recovery-section';
import { TENZRO_NETWORK_NAME, TENZRO_RPC_URL, TENZRO_RP_ID } from '@/lib/tenzro/config';
import { useChainId, useDeviceActions, useDevices, useWallet } from '@/lib/tenzro/hooks';

export default function SettingsPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Settings</h1>
        <p className="text-foreground-muted">Devices, recovery, network, and agent defaults.</p>
      </header>

      <DevicesCard />

      <RecoverySection />

      <Card variant="raised">
        <CardHeader>
          <CardTitle>Network</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row icon={Globe} label="Network" value={TENZRO_NETWORK_NAME} />
          <Row icon={Globe} label="RPC" value={TENZRO_RPC_URL} />
          <ChainIdRow />
          <Row icon={Shield} label="Passkey domain" value={TENZRO_RP_ID} />
        </CardContent>
      </Card>
    </div>
  );
}

function ChainIdRow() {
  const chainId = useChainId();
  return <Row icon={Cpu} label="Chain id" value={chainId.data ?? '…'} />;
}

function DevicesCard() {
  const { wallet } = useWallet();
  const devices = useDevices(wallet);
  const { remove } = useDeviceActions(wallet);
  const list = devices.data ?? [];
  const readiness = assessReadiness(list);
  // Passkeys in the same password manager share a root: number the providers
  // so the list shows which ones fall together. The network records only an
  // identifier, not a name, so they are numbered, not named.
  const providers = new Map<string, number>();
  for (const d of list) {
    if (d.tier === 'synced' && d.aaguid && !providers.has(d.aaguid))
      providers.set(d.aaguid, providers.size + 1);
  }
  const where = (d: (typeof list)[number]): string | null =>
    d.tier === 'synced'
      ? d.aaguid && providers.size > 1
        ? `Syncs across your devices · password manager ${providers.get(d.aaguid)}`
        : 'Syncs across your devices'
      : d.tier === 'device-bound'
        ? 'On one device or security key only'
        : null;

  if (!wallet) {
    return (
      <Card variant="raised">
        <CardHeader>
          <CardTitle>Devices</CardTitle>
          <CardDescription>Create or sign in to a wallet to manage its devices.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card variant="raised">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Devices</CardTitle>
            <CardDescription>{readiness.guidance}</CardDescription>
          </div>
          <Badge variant={readiness.ready ? 'success' : 'warning'} size="sm" dot>
            {readiness.independentRoots} independent{' '}
            {readiness.independentRoots === 1 ? 'root' : 'roots'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {devices.error && <p className="text-sm text-danger">{devices.error.message}</p>}
        {list.map((d) => (
          <div
            key={d.credentialIdHex}
            className="flex items-center gap-3 rounded-xl bg-surface-2 border border-border-subtle p-3"
          >
            <Smartphone className="size-5 text-foreground-muted" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{d.label ?? 'Passkey'}</span>
                {d.thisDevice && (
                  <Badge variant="agent" size="xs">
                    This device
                  </Badge>
                )}
              </div>
              {where(d) && <span className="block text-xs text-foreground-muted">{where(d)}</span>}
              <span className="text-xs text-foreground-subtle font-mono">
                {d.credentialIdHex.slice(0, 18)}…
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={list.length <= 1 || d.thisDevice || remove.isPending}
              onClick={() => remove.mutate(d.credentialIdHex)}
            >
              Remove
            </Button>
          </div>
        ))}
        <LinkDeviceActions />
        {remove.error && <p className="text-sm text-danger">{remove.error.message}</p>}
      </CardContent>
    </Card>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2 transition-colors">
      <Icon className="size-4 text-foreground-muted" />
      <span className="text-sm text-foreground-muted">{label}</span>
      <span className="ml-auto text-sm tabular">{value}</span>
    </div>
  );
}
