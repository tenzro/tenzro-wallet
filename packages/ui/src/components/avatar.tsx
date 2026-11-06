/**
 * Avatar — supports either an image URL or a deterministic gradient
 * derived from a seed (DID, address, agent ID).
 *
 * Wallets need account avatars *fast* and without CORS. The gradient
 * fallback is computed from a 32-bit hash of the seed and yields a
 * unique two-stop linear gradient — same input always renders the same
 * gradient, like Blockie but prettier.
 */

'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as React from 'react';
import { cn } from '../utils/cn';

function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return h >>> 0;
}

function gradientFor(seed: string): string {
  const angle = hashSeed(seed) % 360;
  return `linear-gradient(${angle}deg, oklch(0.55 0 0), oklch(0.3 0 0))`;
}

interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  src?: string | undefined;
  seed?: string | undefined;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  initials?: string | undefined;
}

const sizeMap = { xs: 'size-5', sm: 'size-7', md: 'size-9', lg: 'size-11', xl: 'size-14' };

export const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, src, seed, size = 'md', initials, ...props }, ref) => {
    const bg = seed ? gradientFor(seed) : undefined;
    return (
      <AvatarPrimitive.Root
        ref={ref}
        className={cn(
          'relative flex shrink-0 overflow-hidden rounded-full ring-1 ring-border-subtle',
          sizeMap[size],
          className,
        )}
        {...props}
      >
        {src && (
          <AvatarPrimitive.Image src={src} className="aspect-square size-full object-cover" />
        )}
        <AvatarPrimitive.Fallback
          className="flex size-full items-center justify-center text-[10px] font-semibold text-white"
          style={bg ? { background: bg } : undefined}
        >
          {initials ?? (seed ? seed.slice(0, 2).toUpperCase() : '?')}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
    );
  },
);
Avatar.displayName = 'Avatar';
