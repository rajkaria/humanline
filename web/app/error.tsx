"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { PageShell } from "@/components/page-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { describeError } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Route-level error boundary.
 *
 * Individual panels have their own boundaries (`components/error-boundary.tsx`);
 * this catches whatever escapes them so a judge never sees a blank page.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[humanline] route error", error);
  }, [error]);

  return (
    <PageShell width="prose" className="flex flex-col items-start gap-6 py-24">
      <span className="inline-flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlertIcon className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Well, that broke.</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Nine times out of ten this is the testnet RPC refusing a request. Reload and it
          usually comes back. If it doesn&rsquo;t, every chain read on{" "}
          <Link href="/judge" className="text-brand underline-offset-4 hover:underline">
            /judge
          </Link>{" "}
          can be run from a terminal instead.
        </p>
        <p className="font-mono text-xs break-words text-muted-foreground">
          {describeError(error)}
          {error.digest ? ` · digest ${error.digest}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reset}>
          <RefreshCwIcon />
          Try again
        </Button>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to the start
        </Link>
      </div>
    </PageShell>
  );
}
