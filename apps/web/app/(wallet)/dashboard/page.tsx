'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  KeyStat,
} from '@tenzro/ui';
import { ArrowUpRight, Bot, Check, Copy, KeyRound } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { LiveActivityList } from '@/components/wallet/live-activity-list';
import { LiveNetworkCard } from '@/components/wallet/live-network-card';
import { SignedOut } from '@/components/wallet/signed-out';
import { formatBaseUnits, shortAddress } from '@/lib/tenzro/format';
import { useDevices, useMandates, useTokenBalances, useWallet } from '@/lib/tenzro/hooks';

export default function DashboardPage() {
  const { wallet } = useWallet();
  const balances = useTokenBalances(wallet?.account);
  const devices = useDevices(wallet);
  const mandates = useMandates(wallet?.did);
  const [copied, setCopied] = React.useState(false);

  if (!wallet) return <SignedOut what="your balance and activity" />;

  const native = balances.data?.native;
  const tnzo = native ? formatBaseUnits(native.balance, native.decimals) : null;
  const deviceCount = devices.data?.length;

  async function copyAddress() {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.account);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      <LiveNetworkCard />

      <Card variant="raised">
        <CardHeader>
          <CardDescription>Balance</CardDescription>
          <CardTitle className="font-mono text-3xl tabular">
            {balances.isLoading ? '…' : balances.error ? 'Unavailable' : `${tnzo ?? '0'} TNZO`}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/send">
              <ArrowUpRight className="size-4" /> Send
            </Link>
          </Button>
          <Button variant="outline" onClick={copyAddress}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : `Receive · ${shortAddress(wallet.account)}`}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KeyStat
          label="Devices"
          value={deviceCount === undefined ? '…' : String(deviceCount)}
          icon={KeyRound}
          {...(deviceCount !== undefined && deviceCount < 2
            ? { delta: { value: 'Link a second device for recovery', positive: false } }
            : {})}
        />
        <KeyStat
          label="Agents authorised"
          value={mandates.data ? String(mandates.data.length) : '…'}
          icon={Bot}
          accent="agent"
        />
        <KeyStat
          label="EVM view"
          value={
            balances.data
              ? formatBaseUnits(balances.data.evm_wtnzo.balance, balances.data.evm_wtnzo.decimals)
              : '…'
          }
          accent="evm"
        />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg tracking-tight">Recent activity</h2>
        <Link href="/activity" className="text-sm text-foreground-muted hover:text-foreground">
          All activity
        </Link>
      </div>
      <LiveActivityList />
    </div>
  );
}
