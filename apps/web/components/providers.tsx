/**
 * Providers — TanStack Query + (eventually) the kernel React context.
 *
 * For now we wire QueryClient with sensible defaults for crypto data:
 *   - staleTime 30s for balances (fast enough for casual viewing,
 *     slow enough that we don't hammer the RPC during a tab switch)
 *   - retry once for read methods (don't bury the user in retries
 *     when the RPC is genuinely down)
 */

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
