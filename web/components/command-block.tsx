"use client";

import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/**
 * A copyable shell command, with the "why you would run this" line above it.
 *
 * `/judge` is built almost entirely out of these: the claim, then the exact
 * command that checks the claim without trusting this website.
 */
export function CommandBlock({
  title,
  description,
  command,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  command: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      <div className="group/cmd flex items-start gap-2 rounded-lg bg-background/70 p-3 ring-1 ring-foreground/10">
        <pre className="flex-1 overflow-x-auto font-mono text-[11.5px] leading-relaxed whitespace-pre">
          {command}
        </pre>
        <CopyButton value={command} label="Copy command" size="sm" className="mt-0.5" />
      </div>
    </div>
  );
}
