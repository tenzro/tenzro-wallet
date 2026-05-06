/**
 * EmptyState — used for "no transactions yet", "no agents connected",
 * "no dApps", etc. The illustration is a simple gradient orbit.
 */

import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../utils/cn';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center gap-3 px-6 py-12',
        className,
      )}
    >
      <div className="relative flex items-center justify-center size-16 rounded-2xl bg-surface-2 border border-border-subtle">
        <div className="absolute inset-0 rounded-2xl bg-linear-to-br from-brand/10 to-transparent" />
        <Icon className="size-7 text-foreground-muted relative" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground tracking-tight">{title}</h3>
        {description && (
          <p className="text-sm text-foreground-muted mt-1 max-w-md">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
