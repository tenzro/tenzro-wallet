/**
 * ChainBadge + ChainLogo — the restrained chain-identity primitives.
 *
 * Replaces the colored SurfaceBadge that splashed accent fills across
 * the chrome. Chain identity comes from a small chain-colored *logo
 * dot* sitting in a neutral pill. The surrounding card stays mono.
 *
 *   <ChainBadge chain="ethereum" />        → ⬡ Ethereum (mono pill)
 *   <ChainLogo chain="ethereum" size={20}/> → just the logo
 *
 * Pull the chain meta from `chain.ts` so consumers never hardcode
 * names or colors.
 */

import * as React from 'react';
import { cn } from '../utils/cn';
import { CHAINS, type ChainId } from './chain';

export interface ChainLogoProps {
  chain: ChainId;
  size?: number;
  className?: string;
}

export function ChainLogo({ chain, size = 18, className }: ChainLogoProps) {
  const meta = CHAINS[chain];
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={{ color: meta.color, width: size, height: size }}
      aria-label={meta.name}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG path strings are static, defined inline in CHAINS metadata.
        dangerouslySetInnerHTML={{ __html: meta.logo }}
      />
    </span>
  );
}

export interface ChainBadgeProps {
  chain: ChainId;
  size?: 'xs' | 'sm' | 'md';
  withName?: boolean;
  className?: string;
}

const sizeMap = {
  xs: { h: 'h-5', text: 'text-[10px]', logo: 10, gap: 'gap-1', pad: 'px-1.5' },
  sm: { h: 'h-6', text: 'text-[11px]', logo: 12, gap: 'gap-1.5', pad: 'px-2' },
  md: { h: 'h-7', text: 'text-xs', logo: 14, gap: 'gap-1.5', pad: 'px-2.5' },
} as const;

export function ChainBadge({ chain, size = 'sm', withName = true, className }: ChainBadgeProps) {
  const meta = CHAINS[chain];
  const s = sizeMap[size];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-surface-2 border border-border-subtle text-foreground-muted font-medium tracking-tight',
        s.h,
        s.text,
        s.gap,
        s.pad,
        className,
      )}
    >
      <ChainLogo chain={chain} size={s.logo} />
      {withName && <span>{meta.name}</span>}
    </span>
  );
}
