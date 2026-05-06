/**
 * KeyStat — labelled large number tile, used for things like "Active
 * mandates", "Pending signatures", "Cycles confirmed today".
 */

import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../utils/cn';

export interface KeyStatProps {
  label: string;
  value: string;
  delta?: { value: string; positive?: boolean };
  icon?: LucideIcon;
  accent?: 'brand' | 'native' | 'evm' | 'svm' | 'canton' | 'agent' | 'success';
  className?: string;
}

const accentMap = {
  brand: 'text-brand',
  native: 'text-surface-native',
  evm: 'text-surface-evm',
  svm: 'text-surface-svm',
  canton: 'text-surface-canton',
  agent: 'text-agent',
  success: 'text-success',
};

export function KeyStat({
  label,
  value,
  delta,
  icon: Icon,
  accent = 'brand',
  className,
}: KeyStatProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border-subtle bg-surface-1 p-4 hover:border-border-default transition-colors',
        className,
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-foreground-subtle font-medium">
          {label}
        </span>
        {Icon && <Icon className={cn('size-4', accentMap[accent])} />}
      </div>
      <div className="tabular text-2xl font-semibold text-foreground tracking-tight">{value}</div>
      {delta && (
        <div
          className={cn(
            'tabular text-xs mt-1',
            delta.positive === false ? 'text-danger' : 'text-success',
          )}
        >
          {delta.value}
        </div>
      )}
    </div>
  );
}
