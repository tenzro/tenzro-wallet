/**
 * Button — the workhorse interactive primitive.
 *
 * Variants are designed for crypto-wallet density:
 *   - primary: brand-glow, used for "send", "approve", "confirm"
 *   - secondary: outlined, used for "cancel", "back"
 *   - ghost: chromeless, used inline (chip rows, table cells)
 *   - surface: tied to a Tenzro execution surface (native/evm/svm/canton)
 *   - danger: destructive ops only (revoke, delete, reject)
 *   - agent: agentic-stack actions (approve mandate, sign session key)
 *
 * `pending` and `success` are first-class — wallet UIs need a visible
 * "in flight" state for every signature, and the API encourages it
 * rather than forcing every consumer to spin up their own loader.
 */

'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { Check, Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '../utils/cn';

const buttonVariants = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium tracking-tight',
    'transition-all duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'select-none cursor-pointer active:scale-[0.98]',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-brand text-brand-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_8px_24px_-8px_var(--color-brand-glow)]',
          'hover:bg-brand-hover hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset,0_12px_36px_-8px_var(--color-brand-glow)]',
        ],
        secondary: [
          'bg-surface-2 text-foreground border border-border-default',
          'hover:bg-surface-3 hover:border-border-strong',
        ],
        ghost: ['text-foreground-muted hover:text-foreground hover:bg-surface-2'],
        outline: [
          'border border-border-default bg-transparent text-foreground',
          'hover:bg-surface-2 hover:border-border-strong',
        ],
        danger: [
          'bg-danger-soft text-danger border border-danger/30',
          'hover:bg-danger hover:text-white',
        ],
        agent: [
          'bg-agent-soft text-agent border border-agent/30',
          'hover:bg-agent hover:text-white',
        ],
        surface: [
          'bg-surface-2 text-foreground border border-border-default',
          'hover:border-border-strong',
        ],
      },
      size: {
        xs: 'h-7 px-2.5 text-xs rounded-md',
        sm: 'h-8 px-3 text-sm rounded-lg',
        md: 'h-10 px-4 text-sm rounded-xl',
        lg: 'h-12 px-6 text-base rounded-xl',
        xl: 'h-14 px-8 text-base rounded-2xl',
        icon: 'h-10 w-10 rounded-xl',
        'icon-sm': 'h-8 w-8 rounded-lg',
      },
      width: {
        auto: '',
        full: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      width: 'auto',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  pending?: boolean;
  success?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      width,
      asChild,
      pending,
      success,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isBusy = pending || success;
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, width }), className)}
        disabled={disabled || pending}
        data-state={success ? 'success' : pending ? 'pending' : 'idle'}
        {...props}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : success ? (
          <Check className="size-4" aria-hidden />
        ) : (
          leftIcon
        )}
        <Slottable>
          <span className={cn('contents', isBusy && 'opacity-90')}>{children}</span>
        </Slottable>
        {!isBusy && rightIcon}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
