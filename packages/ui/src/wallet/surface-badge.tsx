/**
 * SurfaceBadge — kept for kernel-internal places that genuinely need
 * the four-surface taxonomy (the consent-receipts inspector, the
 * ports debugger). For user-facing UI, use ChainBadge instead — the
 * user thinks in chains, not surfaces.
 */

import * as React from 'react';
import { Badge } from '../components/badge';
import type { SurfaceKind } from '../tokens/index';

const LABELS: Record<SurfaceKind, string> = {
  native: 'Native',
  evm: 'EVM',
  svm: 'SVM',
  canton: 'Canton',
};

export interface SurfaceBadgeProps {
  surface: SurfaceKind;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export function SurfaceBadge({ surface, size = 'sm', className }: SurfaceBadgeProps) {
  return (
    <Badge variant="outline" size={size} className={className}>
      {LABELS[surface]}
    </Badge>
  );
}
