/**
 * Logo — the Tenzro mark. Renders the cyan-teal "T" inside a rounded
 * rectangle with brand-violet glow.
 */

import * as React from 'react';
import { cn } from '../utils/cn';

export interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

export function Logo({ size = 28, withWordmark = false, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Tenzro"
        role="img"
      >
        <defs>
          <linearGradient
            id="tenzro-mark-bg"
            x1="0"
            y1="0"
            x2="32"
            y2="32"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="oklch(0.7 0.18 285)" />
            <stop offset="1" stopColor="oklch(0.62 0.2 295)" />
          </linearGradient>
          <linearGradient
            id="tenzro-mark-fg"
            x1="0"
            y1="0"
            x2="32"
            y2="32"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="oklch(0.95 0.06 195)" />
            <stop offset="1" stopColor="oklch(0.78 0.14 195)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="32" height="32" rx="8" fill="url(#tenzro-mark-bg)" />
        <path
          d="M8 9.5h16M16 10v13M11 14.5h10"
          stroke="url(#tenzro-mark-fg)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {withWordmark && (
        <span className="text-base font-semibold tracking-tight text-foreground">tenzro</span>
      )}
    </span>
  );
}
