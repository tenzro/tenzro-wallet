/**
 * Tabs — Radix-backed segmented control with the "pill that travels"
 * micro-interaction. We don't actually animate the indicator with a
 * shared element here (Motion's layoutId would be needed) — instead we
 * use absolute-positioned data attribute styling. Cheap, smooth.
 */

'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '../utils/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-10 items-center gap-1 rounded-xl border border-border-subtle bg-surface-1 p-1',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-foreground-muted',
      'transition-all duration-200 cursor-pointer',
      'hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-surface-3 data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_0_0_1px_var(--color-border-default)]',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'focus-visible:outline-none',
      'data-[state=active]:animate-in data-[state=active]:fade-in-50',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
