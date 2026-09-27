'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tenzro/ui';

import { SignedOut } from '@/components/wallet/signed-out';
import { useTokenBalances, useWallet } from '@/lib/tenzro/hooks';

export default function CantonPage() {
  const { wallet } = useWallet();
  const balances = useTokenBalances(wallet?.account);

  if (!wallet) return <SignedOut what="your Canton view" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Canton</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Your TNZO as a DAML holding. It is the same balance as everywhere else in the wallet, seen
          from Canton.
        </p>
      </div>
      <Card variant="raised">
        <CardHeader>
          <CardTitle>TNZO holding</CardTitle>
          <CardDescription>From the node's DAML projection of your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {balances.isLoading ? (
            <p className="text-sm text-foreground-muted">Loading…</p>
          ) : balances.error ? (
            <p className="text-sm text-danger">
              Could not read the holding: {String(balances.error)}
            </p>
          ) : (
            <p className="font-mono text-2xl tabular">
              {balances.data?.daml_holding.amount ?? '0'} TNZO
            </p>
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-foreground-subtle">
        Other Canton assets are not shown yet: the network does not report per-account Canton
        holdings beyond TNZO.
      </p>
    </div>
  );
}
