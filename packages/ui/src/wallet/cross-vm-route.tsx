/**
 * CrossVmRoute — chain-to-chain route preview.
 *
 * Restrained: no glow on the surrounding card, just a small connector
 * glyph that picks up the route kind. Pointer-ops use the brand
 * accent (the only place we light up the brand on this page),
 * bridges use the warning/info hairline.
 *
 *   - "pointer" — Tenzro-internal precompile 0x1003 (sub-second, no LP)
 *   - "bridge"  — anything crossing a sovereignty boundary, vendor named
 *   - "direct"  — same chain, no route
 */

'use client';

import { ArrowRight, Cable, Zap } from 'lucide-react';
import * as React from 'react';
import { cn } from '../utils/cn';
import { type ChainId, classifyRoute } from './chain';
import { ChainBadge } from './chain-badge';

export interface CrossVmRouteProps {
  from: ChainId;
  to: ChainId;
  /** When omitted, derived via classifyRoute */
  kind?: 'pointer' | 'bridge' | 'direct';
  vendor?: string;
  estSeconds?: number;
  feeUsd?: number;
  className?: string;
}

const labelByKind = {
  pointer: 'Pointer op · 0x1003',
  bridge: 'Bridge',
  direct: 'Same chain',
};

export function CrossVmRoute({
  from,
  to,
  kind: kindProp,
  vendor,
  estSeconds,
  feeUsd,
  className,
}: CrossVmRouteProps) {
  const kind = kindProp ?? classifyRoute(from, to);

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl bg-surface-1 border border-border-subtle p-4',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <ChainBadge chain={from} size="md" />
        <div className="relative flex-1 flex items-center justify-center">
          <div className="h-px flex-1 bg-border-default" />
          <div
            className={cn(
              'absolute flex items-center justify-center size-8 rounded-full border',
              kind === 'pointer' && 'bg-brand text-brand-foreground border-brand',
              kind === 'bridge' && 'bg-surface-2 text-warning border-border-default',
              kind === 'direct' && 'bg-surface-2 text-foreground-muted border-border-default',
            )}
          >
            {kind === 'pointer' ? (
              <Zap className="size-4" />
            ) : kind === 'bridge' ? (
              <Cable className="size-4" />
            ) : (
              <ArrowRight className="size-4" />
            )}
          </div>
        </div>
        <ChainBadge chain={to} size="md" />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground-muted">
          {labelByKind[kind]}
          {vendor && <span className="text-foreground-subtle"> · via {vendor}</span>}
        </span>
        <span className="tabular text-foreground-muted">
          {estSeconds !== undefined && (
            <>~{estSeconds < 60 ? `${estSeconds}s` : `${Math.round(estSeconds / 60)}m`}</>
          )}
          {feeUsd !== undefined && <span className="ml-2">${feeUsd.toFixed(4)}</span>}
        </span>
      </div>
    </div>
  );
}
