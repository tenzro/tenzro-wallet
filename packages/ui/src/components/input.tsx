/**
 * Input + amount-input + address-input.
 *
 * Wallet inputs are special: they're either monetary (need tabular nums,
 * MAX button, USD echo) or addresses (need monospace, copy/paste, ENS
 * resolution). We expose three components rather than a single overloaded
 * Input so consumers don't reach for the wrong defaults.
 */

import * as React from 'react';
import { cn } from '../utils/cn';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  invalid?: boolean;
  /** Renamed away from HTML `prefix` attribute to allow ReactNode */
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, prefix, suffix, containerClassName, ...props }, ref) => {
    return (
      <div
        className={cn(
          'group relative flex items-center gap-2 rounded-xl border border-border-default bg-surface-1 px-3.5 transition-all',
          'focus-within:border-brand focus-within:bg-surface-2 focus-within:shadow-[0_0_0_3px_var(--color-brand-soft)]',
          invalid &&
            'border-danger focus-within:border-danger focus-within:shadow-[0_0_0_3px_var(--color-danger-soft)]',
          containerClassName,
        )}
      >
        {prefix && <span className="text-foreground-muted">{prefix}</span>}
        <input
          ref={ref}
          className={cn(
            'h-11 flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground-disabled outline-none disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        {suffix && <span className="text-foreground-muted">{suffix}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';

export interface AmountInputProps
  extends Omit<
    InputProps,
    'type' | 'inputMode' | 'prefix' | 'suffix' | 'invalid' | 'containerClassName'
  > {
  symbol: string;
  usdValue?: string;
  onMax?: () => void;
  available?: string;
}

export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ className, symbol, usdValue, onMax, available, ...props }, ref) => {
    return (
      <div className="rounded-2xl border border-border-default bg-surface-1 p-4 transition-all focus-within:border-brand focus-within:bg-surface-2 focus-within:shadow-[0_0_0_3px_var(--color-brand-soft)]">
        <div className="flex items-baseline gap-3">
          <input
            ref={ref}
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            className={cn(
              'tabular w-full bg-transparent text-3xl font-medium tracking-tight text-foreground placeholder:text-foreground-disabled outline-none',
              className,
            )}
            {...props}
          />
          <span className="text-lg font-medium text-foreground-muted">{symbol}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="tabular text-foreground-subtle">{usdValue ? `≈ ${usdValue}` : ''}</span>
          {available !== undefined && (
            <button
              type="button"
              onClick={onMax}
              className="rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand hover:bg-brand/20 transition-colors cursor-pointer"
            >
              {available} MAX
            </button>
          )}
        </div>
      </div>
    );
  },
);
AmountInput.displayName = 'AmountInput';
