'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as React from 'react';
import { cn } from '../utils/cn';

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value?: number;
  variant?: 'brand' | 'success' | 'warning' | 'danger';
  showShimmer?: boolean;
}

const variantClass = {
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value = 0, variant = 'brand', showShimmer, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        'h-full transition-transform duration-500 ease-out',
        variantClass[variant],
        showShimmer && 'relative overflow-hidden',
      )}
      style={{ transform: `translateX(-${100 - value}%)` }}
    >
      {showShimmer && (
        <span className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent skeleton" />
      )}
    </ProgressPrimitive.Indicator>
  </ProgressPrimitive.Root>
));
Progress.displayName = 'Progress';
