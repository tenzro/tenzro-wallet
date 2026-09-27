/**
 * Send — one form. The recipient decides the route:
 *   - a Tenzro account (0x, 20 or 32 bytes) → a transfer from your passkey
 *     account, approved with your passkey on this device;
 *   - a Solana address → another network (shown, not submitted here yet).
 *
 * A wallet protected by a single passkey can receive but not send: link a
 * second device first (Settings).
 */

'use client';

import { Send } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import {
  AmountInput,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChainBadge,
  Input,
} from '@tenzro/ui';
import { assessReadiness } from 'tenzro-wallet/custody';

import { formatTnzo, shortAddress, tnzoToBaseUnits } from '@/lib/tenzro/format';
import { useBalance, useDevices, useSend, useWallet } from '@/lib/tenzro/hooks';
import { planSend } from '@/lib/tenzro/orchestrate';

export default function SendPage() {
  const { wallet } = useWallet();
  const balance = useBalance(wallet?.account);
  const devices = useDevices(wallet);
  const send = useSend(wallet);

  const [recipient, setRecipient] = React.useState('');
  const [amount, setAmount] = React.useState('');

  const route = React.useMemo(() => planSend({ recipient }), [recipient]);
  const readiness = assessReadiness(devices.data ?? []);
  const liveBalance = balance.data ? formatTnzo(balance.data) : '—';
  const ready = !!wallet && !!amount && route.kind === 'tenzro' && readiness.ready;

  const submit = React.useCallback(async () => {
    if (!wallet || route.kind !== 'tenzro') return;
    try {
      const result = await send.mutateAsync({
        to: route.recipient,
        amount: tnzoToBaseUnits(amount),
      });
      toast.success(`Sent · ${result.userOpHash.slice(0, 18)}…`);
      setAmount('');
      setRecipient('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [amount, route, send, wallet]);

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Send TNZO</h1>
        <p className="text-foreground-muted">
          Paste an address. You approve with your passkey; nothing leaves your device but the
          signature.
        </p>
        {wallet && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-surface-1 border border-border-subtle px-3 py-1.5">
            <ChainBadge chain="tenzro" size="xs" />
            <span className="text-xs text-foreground-muted font-mono">
              {shortAddress(wallet.account)}
            </span>
            <span className="text-xs text-foreground-subtle">·</span>
            <span className="text-xs tabular">{liveBalance} TNZO</span>
          </div>
        )}
      </header>

      {wallet && devices.data && !readiness.ready && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
          <Badge variant="warning" size="xs">
            Add a device
          </Badge>
          <span className="text-xs text-foreground-muted">
            {readiness.guidance}{' '}
            <Link href="/settings" className="underline">
              Manage devices
            </Link>
          </span>
        </div>
      )}

      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle>Recipient</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="0x… Tenzro account"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          {recipient && route.kind === 'invalid' && (
            <p className="text-xs text-warning">{route.reason}</p>
          )}
          {route.kind === 'tenzro' && (
            <p className="text-xs text-foreground-muted">
              Transfer on Tenzro · approved with your passkey
            </p>
          )}
          {route.kind === 'external' && (
            <p className="text-xs text-foreground-muted">
              {route.network} addresses are on another network. Sending there is not available in
              this wallet yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle>Amount</CardTitle>
        </CardHeader>
        <CardContent>
          <AmountInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            symbol="TNZO"
            available={liveBalance}
            onMax={() => balance.data && setAmount(formatTnzo(balance.data, 18))}
          />
        </CardContent>
      </Card>

      <Button
        variant="primary"
        size="lg"
        width="full"
        leftIcon={<Send className="size-4" />}
        disabled={!ready || send.isPending}
        pending={send.isPending}
        onClick={submit}
      >
        Approve with passkey and send
      </Button>
    </div>
  );
}
