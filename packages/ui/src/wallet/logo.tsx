/**
 * Logo — the Tenzro mark. One design language with tenzro.com: a
 * concentric monochrome ring + filled center dot drawn in `currentColor`,
 * paired with the capitalized "Tenzro" wordmark. No gradients, no hue —
 * the mark inherits whatever text color it sits on.
 */

import * as React from 'react';
import { cn } from '../utils/cn';

export interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

export function Logo({ size = 20, withWordmark = false, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Tenzro"
        role="img"
        className="shrink-0"
      >
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1" />
        <circle cx="10" cy="10" r="3.5" fill="currentColor" />
      </svg>
      {withWordmark && (
        <span className="text-base font-medium tracking-tight text-foreground">Tenzro</span>
      )}
    </span>
  );
}
