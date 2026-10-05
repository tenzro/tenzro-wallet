/**
 * Pay — an x402 paid resource or a node-issued payment challenge, from the
 * wallet's account, approved with this device's passkey.
 */

'use client';

import { useMutation } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@tenzro/ui';
import { CreditCard } from 'lucide-react';
import * as React from 'react';
import type { PaymentChallenge } from 'tenzro-sdk';

import { tnzoToBaseUnits } from '@/lib/tenzro/format';
import { useWallet } from '@/lib/tenzro/hooks';
import { payChallenge, payX402Resource } from '@/lib/tenzro/pay';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function PayPage() {
  const { wallet } = useWallet();
  const [url, setUrl] = React.useState('');
  const [max, setMax] = React.useState('');
  const [challenge, setChallenge] = React.useState('');
  const resource = useMutation({
    mutationFn: () => {
      if (!wallet) throw new Error('Open a wallet first.');
      if (!/^\d+(\.\d{1,18})?$/.test(max.trim()))
        throw new Error('Set the most you will pay, in TNZO.');
      return payX402Resource(wallet, url.trim(), BigInt(tnzoToBaseUnits(max.trim())));
    },
  });
  const issued = useMutation({
    mutationFn: () => {
      if (!wallet) throw new Error('Open a wallet first.');
      return payChallenge(wallet, JSON.parse(challenge) as PaymentChallenge);
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Pay</h1>
      <Card variant="raised">
        <CardHeader>
          <CardTitle>A paid web resource (x402)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-label="Resource URL"
          />
          <Input
            value={max}
            onChange={(e) => setMax(e.target.value)}
            inputMode="decimal"
            placeholder="Most you will pay, TNZO"
            aria-label="Most you will pay"
          />
          <Button
            variant="primary"
            size="md"
            leftIcon={<CreditCard className="size-4" />}
            pending={resource.isPending}
            disabled={!url.trim() || resource.isPending}
            onClick={() => resource.mutate()}
          >
            Pay and open
          </Button>
          {resource.error && <p className="text-danger">{errorText(resource.error)}</p>}
          {resource.data && (
            <div className="space-y-1">
              <p>
                {resource.data.status === 402
                  ? 'Nothing was paid: no offer fits your ceiling.'
                  : `Answered ${resource.data.status}.`}
              </p>
              <pre className="max-h-64 overflow-auto rounded-xl bg-surface-1 p-3 text-xs">
                {resource.data.body}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
      <Card variant="raised">
        <CardHeader>
          <CardTitle>A payment challenge (x402 or MPP)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <textarea
            className="h-32 w-full rounded-xl border border-border bg-surface-1 p-3 font-mono text-xs"
            value={challenge}
            onChange={(e) => setChallenge(e.target.value)}
            placeholder="Paste the challenge a node issued (JSON)"
            aria-label="Payment challenge"
          />
          <Button
            variant="primary"
            size="md"
            leftIcon={<CreditCard className="size-4" />}
            pending={issued.isPending}
            disabled={!challenge.trim() || issued.isPending}
            onClick={() => issued.mutate()}
          >
            Approve with passkey and pay
          </Button>
          {issued.error && <p className="text-danger">{errorText(issued.error)}</p>}
          {issued.data !== undefined && (
            <pre className="max-h-64 overflow-auto rounded-xl bg-surface-1 p-3 text-xs">
              {JSON.stringify(
                issued.data,
                (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
                2,
              )}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
