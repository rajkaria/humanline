"use client";

import { ExternalLinkIcon } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import {
  explorerName,
  explorerUrl,
  type ExplorerScope,
} from "@/lib/chains";
import { toHex32, truncateAddress, truncateHex } from "@/lib/format";
import { cn } from "@/lib/utils";

type Kind = "tx" | "address" | "block" | "root" | "raw";

type HashLinkProps = {
  /** The value to show. `bigint` is rendered as a 32-byte hex word. */
  value: string | bigint | number;
  /** Which explorer to link to. Omit for values that have no explorer page. */
  scope?: ExplorerScope;
  kind?: Kind;
  /** Override the truncated display text (e.g. a contract name). */
  label?: string;
  /** Show the full value instead of truncating. */
  full?: boolean;
  copy?: boolean;
  className?: string;
};

/**
 * The single way Humanline renders a hash, address, root or block number.
 *
 * Every one of them is truncated, monospaced, copyable, and — where the value
 * exists on a chain we know about — a link to the right explorer: Blockscout for
 * Creditcoin, Etherscan for Ethereum mainnet, Sepolia Etherscan for staging.
 */
export function HashLink({
  value,
  scope,
  kind = "raw",
  label,
  full = false,
  copy = true,
  className,
}: HashLinkProps) {
  const raw =
    typeof value === "bigint"
      ? kind === "root"
        ? toHex32(value)
        : value.toString()
      : String(value);

  const display =
    label ??
    (full
      ? raw
      : kind === "address"
        ? truncateAddress(raw)
        : kind === "block"
          ? raw
          : truncateHex(raw));

  const href = (() => {
    if (!scope) return undefined;
    if (kind === "tx") return explorerUrl(scope, "tx", raw);
    if (kind === "address") return explorerUrl(scope, "address", raw);
    if (kind === "block") return explorerUrl(scope, "block", raw);
    return undefined;
  })();

  const body = href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={`${raw} · open on ${explorerName(scope!)}`}
      className={cn(
        "group/hash inline-flex items-center gap-1 font-mono text-xs text-foreground/90 underline-offset-4",
        "decoration-foreground/25 hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      <span className="truncate">{display}</span>
      <ExternalLinkIcon
        className="size-3 shrink-0 text-muted-foreground transition-colors group-hover/hash:text-brand"
        aria-hidden
      />
    </a>
  ) : (
    <span title={raw} className="truncate font-mono text-xs text-foreground/90">
      {display}
    </span>
  );

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      {body}
      {copy ? <CopyButton value={raw} label={`Copy ${kind}`} /> : null}
    </span>
  );
}
