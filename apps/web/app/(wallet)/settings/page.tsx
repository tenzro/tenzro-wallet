/**
 * Settings — linked devices, recovery, network, agent defaults.
 */

'use client';

import { Cpu, Fingerprint, Globe, Shield } from 'lucide-react';
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

import { DeviceRow } from '@/components/wallet/device-row';
import { LinkDeviceActions } from '@/components/wallet/link-device';
import { RecoverySection } from '@/components/wallet/recovery-section';
import { TENZRO_CHAIN_ID, TENZRO_NETWORK_NAME, TENZRO_RP_ID } from '@/lib/tenzro/config';
import {
  useChainId,
  useDeviceActions,
  useDevices,
  useEndpoint,
  useWallet,
} from '@/lib/tenzro/hooks';

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
          <EndpointRow />
          <ChainIdRow />
          <Row icon={Shield} label="Passkey domain" value={TENZRO_RP_ID} />
        </CardContent>
      </Card>
    </div>
  );
}

function ChainIdRow() {
  const chainId = useChainId();
  return <Row icon={Cpu} label="Chain id" value={chainId.data ?? String(TENZRO_CHAIN_ID)} />;
}

/** The endpoint in use: found from the network's staked RPC operators, checked against the chain. */
function EndpointRow() {
  const endpoint = useEndpoint();
  return <Row icon={Globe} label="Endpoint" value={endpoint ?? 'Finding the network'} />;
}

function DevicesCard() {
  const { wallet } = useWallet();
  const devices = useDevices(wallet);
  const { remove } = useDeviceActions(wallet);
  const list = devices.data ?? [];
  const readiness = assessReadiness(list);
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;

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
          <DeviceRow
            key={d.credentialIdHex}
            device={d}
            onlyDevice={list.filter((x) => (x.status ?? 'on-wallet') === 'on-wallet').length <= 1}
            removing={remove.isPending}
            onRemove={() => remove.mutate(d.credentialIdHex)}
            userAgent={userAgent}
          />
        ))}
        {!readiness.ready && list.length > 0 && (
          <p className="text-sm text-foreground-muted" data-testid="sending-disabled">
            Sending is off: {readiness.guidance}
          </p>
        )}
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
