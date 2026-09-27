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
  const { link, remove } = useDeviceActions(wallet);
  const list = devices.data ?? [];
  const readiness = assessReadiness(list);

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
            {list.length} {list.length === 1 ? 'device' : 'devices'}
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
                {d.tier === 'synced' && (
                  <Badge variant="warning" size="xs">
                    Synced
                  </Badge>
                )}
              </div>
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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Fingerprint className="size-4" />}
            pending={link.isPending && !link.variables?.securityKey}
            onClick={() => link.mutate({ label: 'Linked device' })}
          >
            Link a phone or computer
          </Button>
          <Button
            variant="ghost"
            size="sm"
            pending={link.isPending && !!link.variables?.securityKey}
            onClick={() => link.mutate({ label: 'Security key', securityKey: true })}
          >
            Add a security key
          </Button>
        </div>
        {(link.error || remove.error) && (
          <p className="text-sm text-danger">{(link.error ?? remove.error)?.message}</p>
        )}
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
