/**
 * Card — the elevated surface used for every grouping in the wallet.
 *
 * Two variants only — restraint per Coinbase / Revolut convention:
 *   - flat   (default): for grouped lists, dense panels
 *   - raised: for primary panels (portfolio summary, send composer,
 *     agent mandate review). One small visual lift via subtle elevation.
 *
 * No more per-surface coloured top-line — chain identity lives on the
 * row level (ChainBadge / ChainLogo), not on container chrome.
 */

import * as React from 'react';
import { cn } from '../utils/cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'flat' | 'raised';
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'flat', interactive, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-2xl bg-surface-1 border border-border-subtle',
          variant === 'raised' && 'border-border-default',
          interactive &&
            'transition-colors duration-200 hover:border-border-default cursor-pointer',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = 'Card';

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 px-5 pt-4 pb-3', className)} {...props} />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn('text-base font-semibold tracking-tight text-foreground', className)}
    {...props}
  />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-sm text-foreground-muted', className)} {...props} />
);

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pb-4', className)} {...props} />
);

export const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center gap-3 px-5 pb-4', className)} {...props} />
);
