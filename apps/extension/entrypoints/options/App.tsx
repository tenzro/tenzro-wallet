/**
 * Options page — the full settings surface, opened in a dedicated tab.
 *
 * Mirrors the web app's settings page but in extension chrome.
 */

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
  Logo,
  Separator,
  Switch,
  formatRelativeTime,
} from '@tenzro/ui';

const devices = [
  { id: 'd1', name: 'Laptop', ts: Date.now() - 600_000, primary: true },
  { id: 'd2', name: 'Phone', ts: Date.now() - 86_400_000 * 2, primary: false },
];

export function App() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <Logo size={28} withWordmark />
        <Badge variant="default" size="sm" className="ml-auto">
          v0.3.0 · Network 1
        </Badge>
      </header>

      <Card variant="raised">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Devices</CardTitle>
              <CardDescription>Passkeys that can approve for this wallet</CardDescription>
            </div>
            <Badge variant="success" size="sm" dot>
              {devices.length} devices
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-xl bg-surface-2 border border-border-subtle p-3"
            >
              <Smartphone className="size-5 text-foreground-muted" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{d.name}</span>
                  {d.primary && (
                    <Badge variant="agent" size="xs">
                      This device
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-foreground-subtle">
                  Last approved {formatRelativeTime(d.ts)}
                </span>
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" leftIcon={<Fingerprint className="size-4" />}>
            Add a device
          </Button>
        </CardContent>
      </Card>

      <Card variant="raised">
        <CardHeader>
          <CardTitle>Network</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row
            icon={Globe}
            label="Endpoints"
            value="staked RPC operators, checked against the chain"
          />
          <Row icon={Cpu} label="Chain id" value="13380" />
          <Row icon={Shield} label="Approvals" value="passkey, on this device" />
        </CardContent>
      </Card>

      <Card variant="raised">
        <CardHeader>
          <CardTitle>Agentic defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RowSwitch label="Require TEE attestation" defaultChecked />
          <Separator />
          <RowSwitch label="Show ERC-8004 reputation" defaultChecked />
          <Separator />
          <RowSwitch label="Cap session keys at 30 days" defaultChecked />
        </CardContent>
      </Card>
    </div>
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

function RowSwitch({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <Switch {...(defaultChecked !== undefined ? { defaultChecked } : {})} />
    </div>
  );
}
