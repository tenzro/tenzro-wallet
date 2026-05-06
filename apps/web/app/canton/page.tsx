/**
 * Canton — Tenzro's institutional surface.
 *
 * Maps to DESIGN.md §M4: external party display, validator co-signing
 * status, DAML holdings, internal vs external Canton flows. M4b
 * (MainNet) is gated on the Splice 0.5.x baseline (post-2026-05-05) —
 * surfaced here as a "coming soon" panel rather than a connect button
 * so the user understands the timeline.
 */

'use client';

import { Building2, ExternalLink, ShieldCheck } from 'lucide-react';
import * as React from 'react';

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChainBadge,
  KeyStat,
  Separator,
} from '@tenzro/ui';

import { CANTON_HOLDINGS } from '@/lib/mock-data';

export default function CantonPage() {
  return (
    <div className="space-y-8">
      <header>
        <Badge variant="default" size="md" className="mb-2">
          <Building2 className="size-3" /> Institutional · Canton MainNet
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Canton holdings</h1>
        <p className="text-foreground-muted">
          External-party DAML positions, validator co-signed. Splice 0.5.x baseline lands
          post-2026-05-05; testnet flows are live today.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KeyStat label="External party" value="hilary" accent="brand" />
        <KeyStat label="Holdings" value={CANTON_HOLDINGS.length.toString()} accent="brand" />
        <KeyStat
          label="Validator"
          value="splice.tenzro"
          delta={{ value: 'co-signing live', positive: true }}
          icon={ShieldCheck}
          accent="success"
        />
        <KeyStat label="DAML modules" value="3" accent="brand" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card variant="raised">
            <CardHeader>
              <CardTitle>Holdings</CardTitle>
              <CardDescription>DAML active contracts under your external party</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {CANTON_HOLDINGS.map((h) => (
                <div
                  key={h.symbol}
                  className="flex items-center gap-3 rounded-xl bg-surface-1 border border-border-subtle p-4"
                >
                  <Avatar seed={h.symbol} size="lg" initials={h.symbol.slice(0, 2)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{h.symbol}</span>
                      <ChainBadge chain="canton" size="xs" />
                    </div>
                    <p className="text-xs text-foreground-muted font-mono mt-0.5 truncate">
                      {h.party}
                    </p>
                    <div className="text-xs text-foreground-subtle mt-1">
                      Validator <span className="text-foreground-muted">{h.validator}</span>
                      {h.custodian && (
                        <>
                          {' '}
                          · Custodian <span className="text-foreground-muted">{h.custodian}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="tabular text-lg font-medium">{h.amount}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card variant="flat">
            <CardHeader>
              <CardTitle className="text-sm">Internal vs external Canton flows</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-foreground-muted space-y-3">
              <div className="flex items-start gap-3">
                <Badge variant="success" size="xs" dot>
                  Internal
                </Badge>
                <p>
                  Canton entries on Tenzro&apos;s synchronizer — fast, no MainNet gas. Used for
                  DOPS-issued instruments and the Tenzro internal CC ledger.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="warning" size="xs" dot>
                  External
                </Badge>
                <p>
                  Settlement on Canton MainNet — validator co-signed, splice-baselined. Higher
                  latency, real institutional finality.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card variant="raised">
          <CardHeader>
            <CardTitle>Validator</CardTitle>
            <CardDescription>splice.tenzro.global</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-success animate-pulse-glow" />
              <span className="text-sm">Co-signing</span>
              <Badge variant="success" size="xs" className="ml-auto">
                v0.5.0-rc4
              </Badge>
            </div>
            <Separator />
            <Stat label="Round" value="142,304" />
            <Stat label="Open mining round" value="ledger-time +24m" />
            <Stat label="Splice baseline" value="0.5.x · Post-2026-05-05" />
            <Separator />
            <Button variant="secondary" size="sm" rightIcon={<ExternalLink className="size-3.5" />}>
              View on validator
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground-subtle">{label}</span>
      <span className="tabular text-foreground">{value}</span>
    </div>
  );
}
