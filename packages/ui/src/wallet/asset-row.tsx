/**
 * AssetRow — chain-aware balance line.
 *
 * Visual hierarchy:
 *   token-icon (with chain-dot overlay) · ticker / chain-name · amount / usd
 *
 * Decimals come from the chain (chainDecimals), so the row stays
 * honest about per-VM precision without any caller-side conversion.
 */

import * as React from 'react';
import { Avatar } from '../components/avatar';
import { cn } from '../utils/cn';
import { type SurfaceForAmount, formatAmount, formatUsd } from '../utils/format';
import { CHAINS, type ChainId, chainDecimals } from './chain';
import { ChainLogo } from './chain-badge';

export interface AssetRowProps {
  symbol: string;
  name?: string;
  iconSrc?: string;
  chain: ChainId;
  baseUnits: bigint | string;
  usdValue?: number;
  changePct?: number;
  onClick?: () => void;
  className?: string;
}

export function AssetRow({
  symbol,
  name,
  iconSrc,
  chain,
  baseUnits,
  usdValue,
  changePct,
  onClick,
  className,
}: AssetRowProps) {
  const chainMeta = CHAINS[chain];
  const surfaceForFmt: SurfaceForAmount =
    chainDecimals(chain) === 9 ? 'svm' : chainDecimals(chain) === 10 ? 'canton' : 'evm';
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 rounded-xl px-3 py-2.5 w-full text-left transition-colors',
        onClick && 'hover:bg-surface-2 cursor-pointer',
        className,
      )}
    >
      {/* Token avatar with chain-logo overlay */}
      <div className="relative shrink-0">
        <Avatar src={iconSrc} seed={symbol} size="md" initials={symbol.slice(0, 2)} />
        <span className="absolute -right-1 -bottom-1 inline-flex items-center justify-center size-4 rounded-full bg-background ring-1 ring-border-default p-0.5">
          <ChainLogo chain={chain} size={10} />
        </span>
      </div>

      {/* Symbol + chain name (chain in muted small text) */}
      <div className="flex flex-1 flex-col min-w-0">
        <span className="font-semibold text-foreground tracking-tight">{symbol}</span>
        <span className="text-xs text-foreground-muted truncate">{name ?? chainMeta.name}</span>
      </div>

      {/* Right: amount + USD/change */}
      <div className="flex flex-col items-end gap-0.5">
        <span className="tabular text-sm font-medium text-foreground">
          {formatAmount(baseUnits, surfaceForFmt)}
        </span>
        <div className="flex items-center gap-1.5 text-xs">
          {usdValue !== undefined && (
            <span className="tabular text-foreground-muted">
              {formatUsd(usdValue, { compact: true })}
            </span>
          )}
          {changePct !== undefined && (
            <span className={cn('tabular', changePct >= 0 ? 'text-success' : 'text-danger')}>
              {changePct >= 0 ? '+' : ''}
              {changePct.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
    </Component>
  );
}
