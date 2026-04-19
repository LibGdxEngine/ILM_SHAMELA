'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Provides a single TanStack Query client per browser session.
 *
 * The client is held in `useState` so the same instance survives re-renders
 * but is freshly created on each browser session (and per-test in jsdom).
 * SSR is safe because instantiation is lazy and scoped to the client tree.
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
