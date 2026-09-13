"use client";

import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/utils";

/**
 * A live countdown to a unix deadline.
 *
 * On the demo deployment the loan term is minutes long, so this ticks every
 * second; on a 30-day production term it still reads sensibly because
 * `formatDuration` collapses to the two largest units.
 *
 * Renders a placeholder until the shared clock has a value, so the server and
 * the hydrating client agree on the first paint.
 */
export function Countdown({
  deadline,
  className,
  overdueLabel = "overdue",
}: {
  deadline: bigint;
  className?: string;
  overdueLabel?: string;
}) {
  const now = useNow(1000);

  if (deadline === 0n) return <span className={className}>–</span>;
  if (now === 0) return <span className={cn("tabular-nums", className)}>…</span>;

  const remaining = Number(deadline) - now;
  if (remaining <= 0) {
    return (
      <span className={cn("text-destructive tabular-nums", className)}>
        {formatDuration(-remaining)} {overdueLabel}
      </span>
    );
  }

  const urgent = remaining < 3600;
  return (
    <span className={cn("tabular-nums", urgent && "text-warning", className)}>
      {formatDuration(remaining)}
    </span>
  );
}
