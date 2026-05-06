/**
 * Live testnet card — the only piece of the dashboard wired to real
 * chain state. Shows one TNZO total (sum of every VM projection of
 * the same Tenzro address) plus an expandable breakdown for users who
 * want to see where the balance currently sits.
 *
 * The single-number presentation is intentional: under Tenzro's
 * pointer-token model the four "balances" (native, EVM wTNZO, SVM
 * wTNZO, Canton CIP-56 holding) are all views over one underlying
 * supply. Showing them as separate balances would imply a
 * fragmentation that doesn't exist.
 */

'use client';

import { ChevronDown, Copy, Droplets, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge, Button, Card, CardContent, ChainBadge, cn } from '@tenzro/ui';

import { formatBaseUnits, shortAddress } from '@/lib/tenzro/format';
import { useFaucet, useTokenBalances, useWallet } from '@/lib/tenzro/hooks';

function tnzoDecimalToBase(decimal: string): string {
  const [whole = '0', frac = ''] = (decimal || '0').split('.');
  const fracPadded = frac.padEnd(18, '0').slice(0, 18);
  return (BigInt(whole) * 10n ** 18n + BigInt(fracPadded || '0')).toString();
}

function ProjectionLine({
  label,
  baseUnits,
  decimals,
}: {
  label: string;
  baseUnits: string;
  decimals: number;
}) {
  return (
    <>
      <span className="text-foreground-subtle">{label}</span>
      <span className="text-right text-foreground-muted">
        {formatBaseUnits(baseUnits, decimals, 6)}
      </span>
    </>
  );
}

/**
 * Sum the four VM projections into one TNZO total. The DAML Canton
 * holding is reported as a decimal-string `amount` already in TNZO
 * units, so we re-encode it to base-units for a uniform sum, while
 * `native`/`evm_wtnzo` come in base units directly. SVM uses 9
 * decimals, so we left-shift by 9 to align it to 18.
 */
function sumProjectionsBaseUnits(b: ReturnType<typeof useTokenBalances>['data']): bigint {
  if (!b) return 0n;
  const native = BigInt(b.native.balance || '0');
  const evm = BigInt(b.evm_wtnzo.balance || '0');
  const svm = BigInt(b.svm_wtnzo.balance || '0') * 10n ** 9n; // align 9-dec → 18-dec
  // DAML holding is a decimal string in TNZO units (e.g. "0.000000000000000000")
  const damlBaseUnits = (() => {
    const [whole = '0', frac = ''] = (b.daml_holding.amount || '0').split('.');
    const fracPadded = frac.padEnd(18, '0').slice(0, 18);
    return BigInt(whole) * 10n ** 18n + BigInt(fracPadded || '0');
  })();
  return native + evm + svm + damlBaseUnits;
}

export function LiveTestnetCard() {
  const { wallet, loading } = useWallet();
  const balances = useTokenBalances(wallet?.address);
  const faucet = useFaucet(wallet?.address);
  const [copied, setCopied] = React.useState(false);
  const [showBreakdown, setShowBreakdown] = React.useState(false);

  const totalBaseUnits = React.useMemo(
    () => sumProjectionsBaseUnits(balances.data),
    [balances.data],
  );

  const copy = React.useCallback(() => {
    if (!wallet) return;
    void navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [wallet]);

  if (loading) {
    return (
      <Card variant="raised">
        <CardContent className="flex items-center gap-3 py-6">
          <Loader2 className="size-4 animate-spin text-foreground-muted" />
          <span className="text-sm text-foreground-muted">Loading wallet…</span>
        </CardContent>
      </Card>
    );
  }

  if (!wallet) {
    return (
      <Card variant="raised">
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-4 py-6">
          <div className="flex-1">
            <Badge variant="warning" size="xs" className="mb-2">
              No wallet on this device
            </Badge>
            <p className="text-sm text-foreground">
              Onboard to mint your DID and Tenzro testnet address.
            </p>
          </div>
          <Button asChild variant="primary" size="md">
            <Link href="/onboarding">Get started</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="raised">
      <CardContent className="py-5">
        <div className="flex items-center gap-2 mb-3">
          <ChainBadge chain="tenzro" size="xs" />
          <Badge variant="success" size="xs" dot>
            Live testnet
          </Badge>
          <span className="text-xs text-foreground-subtle ml-auto font-mono">
            rpc.tenzro.network
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-foreground-subtle font-medium">
              TNZO balance
            </div>
            <div className="flex items-end gap-2">
              <span className="tabular text-3xl font-semibold tracking-tight">
                {balances.data ? formatBaseUnits(totalBaseUnits.toString(), 18) : '—'}
              </span>
              <span className="text-sm text-foreground-muted mb-1.5">TNZO</span>
              <button
                type="button"
                onClick={() => balances.refetch()}
                className="ml-auto size-7 rounded-md hover:bg-surface-2 inline-flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className={cn('size-3.5', balances.isFetching && 'animate-spin')} />
              </button>
            </div>
            {balances.error && (
              <p className="text-xs text-danger">{(balances.error as Error).message}</p>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-foreground-subtle font-medium">
              Address
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular text-sm font-mono">
                {shortAddress(wallet.address, 10, 8)}
              </span>
              <button
                type="button"
                onClick={copy}
                className="size-7 rounded-md hover:bg-surface-2 inline-flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
                title="Copy full address"
              >
                <Copy className="size-3.5" />
              </button>
              {copied && <span className="text-xs text-success">Copied</span>}
            </div>
            <div className="text-[10px] text-foreground-subtle font-mono truncate">
              {wallet.did}
            </div>
          </div>
        </div>

        {balances.data && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowBreakdown((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-foreground-subtle hover:text-foreground-muted transition-colors cursor-pointer"
            >
              <ChevronDown
                className={cn('size-3 transition-transform', showBreakdown && 'rotate-180')}
              />
              Holdings
            </button>
            {showBreakdown && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] tabular pl-1">
                <ProjectionLine
                  label="Native (Tenzro Ledger)"
                  baseUnits={balances.data.native.balance}
                  decimals={18}
                />
                <ProjectionLine
                  label="EVM (wTNZO ERC-20)"
                  baseUnits={balances.data.evm_wtnzo.balance}
                  decimals={18}
                />
                <ProjectionLine
                  label="SVM (SPL adapter)"
                  baseUnits={balances.data.svm_wtnzo.balance}
                  decimals={9}
                />
                <ProjectionLine
                  label="Canton (CIP-56)"
                  baseUnits={tnzoDecimalToBase(balances.data.daml_holding.amount)}
                  decimals={18}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => faucet.mutate()}
            variant="secondary"
            size="sm"
            pending={faucet.isPending}
            leftIcon={<Droplets className="size-3.5" />}
          >
            Drip from faucet
          </Button>
          <Button asChild variant="primary" size="sm">
            <Link href="/send">Send TNZO</Link>
          </Button>
          {faucet.data && (
            <span
              className={cn(
                'text-xs px-2 py-1 rounded-md',
                faucet.data.success
                  ? 'text-success bg-success-soft'
                  : 'text-warning bg-warning-soft',
              )}
            >
              {faucet.data.success ? `Sent ${faucet.data.amount}` : faucet.data.message}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
