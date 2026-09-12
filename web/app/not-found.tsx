import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <PageShell width="prose" className="flex flex-col items-start gap-6 py-24">
      <span className="font-mono text-sm text-brand">404</span>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Nothing here</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          That page does not exist. The four that do: the app, the relay feed, the judge
          page, and the docs.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/app" className={cn(buttonVariants())}>
          Open the app
        </Link>
        <Link href="/relay" className={cn(buttonVariants({ variant: "outline" }))}>
          Relay feed
        </Link>
        <Link href="/judge" className={cn(buttonVariants({ variant: "outline" }))}>
          Judge
        </Link>
        <Link href="/docs" className={cn(buttonVariants({ variant: "ghost" }))}>
          Docs
        </Link>
      </div>
    </PageShell>
  );
}
