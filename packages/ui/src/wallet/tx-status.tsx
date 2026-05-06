/**
 * TxStatus — pill that shows where a tx is in its lifecycle, with the
 * "block confirmation progress" we got from 2026 trends.
 *
 * Five canonical states: signing, broadcast, mempool, included, finalized.
 * A failed state shows the rejection reason. The signing state has the
 * brand glow pulse to communicate "your hardware is waiting on you".
 */

'use client';

import { Check, CircleAlert, Clock, Layers, Send, X } from 'lucide-react';
import { motion } from 'motion/react';
import * as React from 'react';
import { Badge } from '../components/badge';
import { cn } from '../utils/cn';

export type TxState = 'signing' | 'broadcast' | 'mempool' | 'included' | 'finalized' | 'failed';

const config = {
  signing: { label: 'Awaiting signature', icon: Send, variant: 'info' as const, pulse: true },
  broadcast: { label: 'Broadcasting', icon: Send, variant: 'info' as const, pulse: true },
  mempool: { label: 'In mempool', icon: Clock, variant: 'warning' as const, pulse: false },
  included: { label: 'Included', icon: Layers, variant: 'info' as const, pulse: false },
  finalized: { label: 'Finalized', icon: Check, variant: 'success' as const, pulse: false },
  failed: { label: 'Failed', icon: X, variant: 'danger' as const, pulse: false },
};

export interface TxStatusProps {
  state: TxState;
  confirmations?: number;
  required?: number;
  reason?: string;
  className?: string;
}

export function TxStatus({ state, confirmations, required, reason, className }: TxStatusProps) {
  const c = config[state];
  const Icon = c.icon;
  const showProgress =
    (state === 'included' || state === 'mempool') &&
    typeof confirmations === 'number' &&
    typeof required === 'number';

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <Badge variant={c.variant} size="sm" className={cn(c.pulse && 'animate-pulse-glow')}>
        <Icon className="size-3" aria-hidden />
        {c.label}
        {state === 'failed' && reason && <span className="text-foreground-subtle">: {reason}</span>}
      </Badge>
      {showProgress && (
        <div className="flex items-center gap-1.5">
          <span className="tabular text-xs text-foreground-muted">
            {confirmations}/{required}
          </span>
          <div className="flex gap-0.5">
            {Array.from({ length: required }).map((_, i) => (
              <motion.span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position progress dots that never reorder.
                key={`confirm-${i}`}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.05 }}
                className={cn(
                  'block h-1.5 w-1.5 rounded-full',
                  i < confirmations ? 'bg-success' : 'bg-surface-3',
                )}
              />
            ))}
          </div>
        </div>
      )}
      {state === 'failed' && <CircleAlert className="size-3.5 text-danger" />}
    </div>
  );
}
