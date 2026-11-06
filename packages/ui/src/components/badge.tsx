/**
 * Badge — neutral pills for status and metadata.
 *
 * Per-surface colored variants are gone — chain identity is the job
 * of ChainBadge (mono pill + colored logo dot). This Badge handles:
 *   - default      mono chip (for counts, generic labels)
 *   - outline      transparent with hairline border
 *   - agent        the only colored variant — agent-blue, used on
 *                  the AGENT chip in mandate cards exclusively
 *   - success/warning/danger/info  for explicit status states only
 */

import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium tracking-tight whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-surface-2 text-foreground-muted border border-border-subtle',
        outline: 'bg-transparent text-foreground-muted border border-border-default',
        agent: 'bg-agent-soft text-agent border border-agent/20',
        success: 'bg-success-soft text-success border border-success/20',
        warning: 'bg-warning-soft text-warning border border-warning/20',
        danger: 'bg-danger-soft text-danger border border-danger/20',
        info: 'bg-info-soft text-info border border-info/20',
      },
      size: {
        xs: 'h-5 px-1.5 text-[10px]',
        sm: 'h-6 px-2 text-[11px]',
        md: 'h-7 px-2.5 text-xs',
        lg: 'h-8 px-3 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, dot, children, ...props }, ref) => {
    return (
      <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props}>
        {dot && <span className="size-1.5 rounded-full bg-current" />}
        {children}
      </span>
    );
  },
);
Badge.displayName = 'Badge';
