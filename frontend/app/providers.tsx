'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { IdentityProvider } from '@/lib/identity-context';

/**
 * wagmi + RainbowKit are gone (§6 Phase 4.1). There is no EVM chain to connect
 * to and no browser wallet in the §4 identity design, so the provider tree is
 * just react-query plus the WebCrypto identity context.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <IdentityProvider>{children}</IdentityProvider>
    </QueryClientProvider>
  );
}
