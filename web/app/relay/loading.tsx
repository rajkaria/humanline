import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading skeleton, shown while a server component streams. */
export default function Loading() {
  return (
    <PageShell className="flex flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-2/3 max-w-md" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </PageShell>
  );
}
