"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { WagmiProvider } from "wagmi";

import { NetworkGuard } from "@/components/network-guard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  // One QueryClient per browser session. Chain reads are cheap and the relay
  // feed refreshes on its own timer, so the defaults stay conservative.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delay={200}>
            <NetworkGuard>{children}</NetworkGuard>
          </TooltipProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
