/**
 * BalanceHero — the giant top-of-dashboard total.
 *
 * Restrained per Coinbase / Revolut: no glass or gradient orbs. Big
 * number, small change pill, action cluster. The chain breakdown
 * below uses ChainBadge instead of colored chips.
 */

'use client';

import { ArrowDownUp, Eye, EyeOff, Plus, Send } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { Button } from '../components/button';
import { cn } from '../utils/cn';
import { type SurfaceForAmount, formatAmount, formatUsd } from '../utils/format';
import type { ChainId } from './chain';
import { chainDecimals } from './chain';
import { ChainBadge } from './chain-badge';

export interface ChainLeg {
  chain: ChainId;
  baseUnits: bigint | string;
  usdValue: number;
}

export interface BalanceHeroProps {
  totalUsd: number;
  changePct?: number;
  changeUsd?: number;
  legs: ChainLeg[];
  onSend?: () => void;
  onReceive?: () => void;
  onSwap?: () => void;
  className?: string;
}

export function BalanceHero({
  totalUsd,
  changePct,
  changeUsd,
  legs,
  onSend,
  onReceive,
  onSwap,
  className,
}: BalanceHeroProps) {
  const [hidden, setHidden] = React.useState(false);

  return (
    <div
      className={cn('rounded-3xl bg-surface-1 border border-border-subtle p-6 sm:p-8', className)}
    >
      {/* Top row — number + actions */}
      <div className="flex items-start justify-between mb-7 gap-4 flex-wrap">
        <div>
          <span className="text-xs uppercase tracking-widest text-foreground-subtle font-medium">
            Net worth
          </span>
          <div className="flex items-baseline gap-3 mt-1.5">
            <AnimatePresence mode="wait">
              <motion.span
                key={hidden ? 'hidden' : 'visible'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="tabular text-5xl sm:text-6xl font-semibold text-foreground tracking-tighter"
              >
                {hidden ? '••••••' : formatUsd(totalUsd)}
              </motion.span>
            </AnimatePresence>
            <button
              type="button"
              onClick={() => setHidden((v) => !v)}
              className="inline-flex items-center justify-center size-8 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
            >
              {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {changePct !== undefined && !hidden && (
            <div className="flex items-center gap-2 mt-2.5 text-sm">
              <span
                className={cn(
                  'tabular font-medium',
                  changePct >= 0 ? 'text-success' : 'text-danger',
                )}
              >
                {changePct >= 0 ? '+' : ''}
                {changePct.toFixed(2)}%
              </span>
              {changeUsd !== undefined && (
                <span className="tabular text-foreground-muted">
                  {changeUsd >= 0 ? '+' : ''}
                  {formatUsd(changeUsd)} today
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {onSend && (
            <Button
              onClick={onSend}
              variant="primary"
              size="md"
              leftIcon={<Send className="size-4" />}
            >
              Send
            </Button>
          )}
          {onReceive && (
            <Button
              onClick={onReceive}
              variant="secondary"
              size="md"
              leftIcon={<Plus className="size-4" />}
            >
              Receive
            </Button>
          )}
          {onSwap && (
            <Button
              onClick={onSwap}
              variant="secondary"
              size="md"
              leftIcon={<ArrowDownUp className="size-4" />}
            >
              Swap
            </Button>
          )}
        </div>
      </div>

      {/* Per-chain legs — mono cards with ChainBadge */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {legs.map((leg) => {
          const surfaceForFmt: SurfaceForAmount =
            chainDecimals(leg.chain) === 9
              ? 'svm'
              : chainDecimals(leg.chain) === 10
                ? 'canton'
                : 'evm';
          return (
            <div
              key={leg.chain}
              className="rounded-xl bg-background-elevated border border-border-subtle px-3 py-2.5 hover:border-border-default transition-colors"
            >
              <ChainBadge chain={leg.chain} size="xs" />
              <div className="mt-2 tabular text-sm font-medium text-foreground">
                {hidden ? '••••' : formatAmount(leg.baseUnits, surfaceForFmt)}
              </div>
              <div className="tabular text-xs text-foreground-muted">
                {hidden ? '••••' : formatUsd(leg.usdValue, { compact: true })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
