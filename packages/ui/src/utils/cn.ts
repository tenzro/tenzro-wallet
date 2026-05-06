/**
 * Tailwind-aware classname merger. Combines clsx (conditional joins) with
 * tailwind-merge (last-write-wins for conflicting utility classes — so
 * `cn("p-4", isCompact && "p-2")` actually drops `p-4` when compact).
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
