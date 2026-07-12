/**
 * Settings — quorum management, network, agentic policy defaults.
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
  Separator,
  Switch,
  formatRelativeTime,
} from '@tenzro/ui';

const devices = [
  { id: 'd1', name: 'MacBook Pro · Hilary', ts: Date.now() - 600_000, primary: true },
  { id: 'd2', name: 'iPhone 17 Pro', ts: Date.now() - 86_400_000 * 2, primary: false },
];

export default function SettingsPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Settings</h1>
        <p className="text-foreground-muted">Quorum, network, and agentic defaults.</p>
      </header>

      <Card variant="raised">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Custody quorum</CardTitle>
              <CardDescription>2-of-2 (testnet) · upgrades to 2-of-3 at MainNet</CardDescription>
            </div>
            <Badge variant="success" size="sm" dot>
              Healthy
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
                  Last signed {formatRelativeTime(d.ts)}
                </span>
              </div>
              <Button variant="ghost" size="sm">
                Manage
              </Button>
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
          <Row icon={Globe} label="Tenzro RPC" value="rpc.tenzro.xyz · testnet" />
          <Row icon={Cpu} label="Splice baseline" value="0.5.x (gated · post-2026-05-05)" />
          <Row
            icon={Shield}
            label="ML-DSA-65 leg"
            value="node-TEE only · until threshold ML-DSA matures"
          />
        </CardContent>
      </Card>

      <Card variant="raised">
        <CardHeader>
          <CardTitle>Agentic defaults</CardTitle>
          <CardDescription>What new mandates inherit unless you change them</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RowSwitch
            label="Require TEE attestation"
            description="Refuse mandates without a TEE receipt from a known verifier"
            defaultChecked
          />
          <Separator />
          <RowSwitch
            label="Show ERC-8004 reputation inline"
            description="Surface reputation score on the agent's first request"
            defaultChecked
          />
          <Separator />
          <RowSwitch
            label="Cap session keys at 30 days"
            description="ERC-7702 session keys expire after 30 days unless renewed"
            defaultChecked
          />
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

function RowSwitch({
  label,
  description,
  defaultChecked,
}: {
  label: string;
  description: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="text-xs text-foreground-muted mt-0.5">{description}</p>
      </div>
      <Switch {...(defaultChecked !== undefined ? { defaultChecked } : {})} />
    </div>
  );
}
