import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StatProps = {
  label: string;
  value: ReactNode;
  /** Small line under the value: units, context, or a secondary number. */
  hint?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  /** Renders the value in the brand gradient. Use for one hero number per view. */
  emphasis?: boolean;
  className?: string;
};

/**
 * A single number with a label. Used for every counter on the site so the
 * typography and spacing of "roots relayed", "humans", "credit extended",
 * "pool utilisation" and the precompile guard values all agree.
 */
export function Stat({
  label,
  value,
  hint,
  icon,
  loading = false,
  emphasis = false,
  className,
}: StatProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl bg-card/60 p-4 ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex items-start gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {icon ? <span className="mt-0.5 shrink-0 text-muted-foreground/80">{icon}</span> : null}
        {/* Wraps rather than truncating: "ROOTS RELAYED · ETHEREUM" loses its
            meaning the moment the chain name is the part that gets cut. */}
        <span className="min-w-0 text-balance">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-1 h-8 w-24" />
      ) : (
        <div
          className={cn(
            "font-mono text-2xl leading-tight font-semibold tabular-nums",
            emphasis && "text-gradient",
          )}
        >
          {value}
        </div>
      )}
      {hint ? (
        <div className="text-xs text-muted-foreground">{loading ? <Skeleton className="h-3 w-16" /> : hint}</div>
      ) : null}
    </div>
  );
}

/** Label/value row used inside cards where a full `Stat` would be too loud. */
export function StatRow({
  label,
  value,
  loading = false,
  mono = true,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  loading?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-4 w-20" />
      ) : (
        <span className={cn("text-sm font-medium", mono && "font-mono tabular-nums")}>{value}</span>
      )}
    </div>
  );
}
