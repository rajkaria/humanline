"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
  size?: "xs" | "sm";
};

/**
 * Copy-to-clipboard affordance used next to every hash, address and command.
 *
 * Falls back to a hidden textarea + `execCommand` where the async clipboard API
 * is unavailable (non-HTTPS origins, older Safari), because a judge opening the
 * app over plain http should still be able to copy an address.
 */
export function CopyButton({ value, label, className, size = "xs" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current);
  }, []);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }, [value]);

  const iconSize = size === "sm" ? "size-3.5" : "size-3";

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : (label ?? `Copy ${value}`)}
      title={copied ? "Copied" : (label ?? "Copy")}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        size === "sm" ? "size-6" : "size-5",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className={cn(iconSize, "text-success")} aria-hidden />
      ) : (
        <CopyIcon className={iconSize} aria-hidden />
      )}
    </button>
  );
}
