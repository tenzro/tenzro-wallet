'use client';

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as React from 'react';
import { cn } from '../utils/cn';

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-border-subtle',
      orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
      className,
    )}
    {...props}
  />
));
Separator.displayName = 'Separator';
