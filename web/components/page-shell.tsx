import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Consistent page gutters and max width across every route. */
export function PageShell({
  children,
  className,
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: "default" | "wide" | "prose";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6",
        width === "wide" && "max-w-7xl",
        width === "default" && "max-w-6xl",
        width === "prose" && "max-w-4xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Page title block: eyebrow, heading, one-line description. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-foreground/10 pt-10 pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2">
        {eyebrow ? (
          <span className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-pretty text-muted-foreground sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Section heading used inside pages. */
export function SectionHeading({
  title,
  description,
  id,
  actions,
}: {
  title: string;
  description?: ReactNode;
  id?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      id={id}
      className="flex flex-col gap-2 scroll-mt-20 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
