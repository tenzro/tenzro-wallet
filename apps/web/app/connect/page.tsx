/**
 * Connections — EIP-6963 / CAIP-25 dApp sessions + signature requests.
 *
 * Two columns:
 *   - Left: connected dApps with per-surface scope, last seen, revoke
 *   - Right: pending signature/transaction requests from connected dApps
 *
 * The signature-request panel is the consent moment — surface badge,
 * decoded payload (typed-data preview), the dApp identity, and a
 * "what this signs" plain-language summary.
 */

'use client';

import { Cable, Check, Globe, ShieldAlert, X } from 'lucide-react';
import * as React from 'react';

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChainBadge,
  EmptyState,
  Separator,
  formatRelativeTime,
} from '@tenzro/ui';

import { DAPPS } from '@/lib/mock-data';

export default function ConnectPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Connections</h1>
        <p className="text-foreground-muted">
          dApps you&apos;ve granted scoped access. EIP-6963 announces, CAIP-25 scopes — revoke
          per-surface from here.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connected list */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider mb-2">
            Connected · {DAPPS.length}
          </h2>
          {DAPPS.map((d) => (
            <Card key={d.id} variant="raised">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <Avatar seed={d.origin} size="lg" initials={d.name.slice(0, 1)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold tracking-tight">{d.name}</h3>
                      <Badge variant="success" size="xs" dot>
                        Online
                      </Badge>
                    </div>
                    <p className="text-xs text-foreground-muted truncate flex items-center gap-1.5">
                      <Globe className="size-3" />
                      {d.origin}
                    </p>
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      <span className="text-xs text-foreground-subtle uppercase tracking-wider mr-1">
                        Scoped to
                      </span>
                      {d.chains.map((c) => (
                        <ChainBadge key={c} chain={c} size="xs" />
                      ))}
                    </div>
                    <p className="text-xs text-foreground-subtle mt-2">
                      Connected {formatRelativeTime(d.connectedAt)} · CAIP-25:{' '}
                      <span className="font-mono">{d.caip25Scope}</span>
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button variant="secondary" size="sm">
                      Open
                    </Button>
                    <Button variant="danger" size="sm">
                      Revoke
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Pending signature request */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider mb-2">
            Awaiting consent · 1
          </h2>
          <Card variant="raised">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Signature request</CardTitle>
                <ChainBadge chain="base" size="xs" />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar seed="https://uniswap.org" size="md" initials="U" />
                <div className="min-w-0">
                  <div className="font-medium text-sm">Uniswap</div>
                  <div className="text-xs text-foreground-muted">https://uniswap.org</div>
                </div>
              </div>

              <Separator />

              <div>
                <span className="text-[10px] uppercase tracking-wider text-foreground-subtle font-medium">
                  Method
                </span>
                <p className="font-mono text-xs mt-1">eth_signTypedData_v4</p>
              </div>

              <div>
                <span className="text-[10px] uppercase tracking-wider text-foreground-subtle font-medium">
                  What this signs
                </span>
                <p className="text-sm mt-1">
                  Permit Uniswap to spend up to{' '}
                  <span className="tabular text-foreground font-medium">42.0 USDC</span> from your
                  EVM-on-Tenzro account for 24 hours.
                </p>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-info/20 bg-info-soft px-3 py-2.5 text-xs">
                <ShieldAlert className="size-3.5 text-info shrink-0 mt-0.5" />
                <div>
                  Permit (EIP-2612) — no on-chain tx now, but a future tx can pull this amount
                  without another signature.
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" size="md" leftIcon={<X className="size-4" />}>
                  Reject
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  width="full"
                  leftIcon={<Check className="size-4" />}
                >
                  Sign
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card variant="flat">
            <CardContent className="p-4 text-xs text-foreground-muted">
              <Cable className="size-4 text-brand inline mr-1.5" />
              The Tenzro browser extension announces via EIP-6963 with{' '}
              <code className="text-foreground font-mono">uuid: …</code> and exposes both the EVM
              and SVM JSON-RPC providers under one provider object.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
