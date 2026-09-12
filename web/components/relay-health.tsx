"use client";

import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, AlertTriangleIcon, CheckCircle2Icon, SirenIcon } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import { Stat } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SOURCE_CHAINS, type SourceChainKey } from "@/lib/chains";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import type { RelayReport } from "@/lib/relay/summary";
import { cn } from "@/lib/utils";

function pct(ratio: number): string {
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(ratio >= 0.9995 ? 0 : 1)}%`;
}

function dur(sec: number | null): string {
  return sec === null ? "—" : formatDuration(sec);
}

/**
 * The relay's liveness, measured from chain: the watchdog verdict, latency
 * percentiles, uptime against the 10-minute target, and who carried the roots.
 */
export function RelayHealth() {
  const query = useQuery({
    queryKey: ["relay-stats"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<RelayReport> => {
      const response = await fetch("/api/relay/stats", { cache: "no-store" });
      const body = (await response.json()) as RelayReport & { message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      return body;
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
        Relay statistics are unavailable right now ({query.error?.message ?? "no data"}). The feed below
        still reads the chain directly.
      </p>
    );
  }

  const r = query.data;
  const h = r.health;
  const tone = h.status === "ok" ? "success" : h.status === "late" ? "warning" : "destructive";
  const Icon = h.status === "ok" ? CheckCircle2Icon : h.status === "late" ? AlertTriangleIcon : SirenIcon;
  const others = r.relayers.filter((x) => !x.operator);
  const maxE2e = Math.max(1, ...r.recent.map((x) => x.endToEndSec));

  return (
    <div className="flex flex-col gap-4" data-testid="relay-health">
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4",
          tone === "success" && "border-success/30 bg-success/5",
          tone === "warning" && "border-warning/30 bg-warning/5",
          tone === "destructive" && "border-destructive/30 bg-destructive/5",
        )}
        role="status"
      >
        <div className="flex items-start gap-3">
          <Icon
            className={cn(
              "mt-0.5 size-5 shrink-0",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
              tone === "destructive" && "text-destructive",
            )}
            aria-hidden
          />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">
              Watchdog: {h.status === "ok" ? "healthy" : h.status === "late" ? "a root is late" : "relay stalled"}
            </p>
            <p className="text-xs text-muted-foreground">
              {h.reason} Target: every relayable root on Creditcoin within {formatDuration(r.sloSec)}.
              {h.lastRelayAgeSec !== null ? ` Last relay ${formatDuration(h.lastRelayAgeSec)} ago.` : ""}
            </p>
          </div>
        </div>
        <a
          href="/api/relay/health"
          className="font-mono text-[11px] text-muted-foreground underline-offset-4 hover:underline"
        >
          GET /api/relay/health
        </a>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ActivityIcon className="size-3.5 text-brand" />
              End to end
            </CardTitle>
            <CardDescription>Ethereum block → root usable on Creditcoin, {r.endToEndAll.count} roots</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="p50" value={dur(r.endToEndAll.p50)} emphasis />
              <Stat label="p95" value={dur(r.endToEndAll.p95)} />
              <Stat label="max" value={dur(r.endToEndAll.max)} />
            </dl>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Relay delay</CardTitle>
            <CardDescription>
              After the 32-block finality depth allowed it. The part the relayer controls.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="p50" value={dur(r.relayDelayAll.p50)} emphasis />
              <Stat label="p95" value={dur(r.relayDelayAll.p95)} />
              <Stat label="max" value={dur(r.relayDelayAll.max)} />
            </dl>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Uptime</CardTitle>
            <CardDescription>Share of time no relayable root waited past the target</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="24 h" value={pct(r.uptime24h.ratio)} emphasis />
              {r.chains.map((c) => (
                <Stat
                  key={c.chainKey}
                  label={`7 d · ${SOURCE_CHAINS[c.chainKey as SourceChainKey]?.label ?? c.chainKey}`}
                  value={pct(c.uptime7d.ratio)}
                />
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      {r.recent.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Latency per root, newest first</CardTitle>
            <CardDescription>
              Bar = end to end. Shaded part = relay delay; the rest is attestation and finality.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex h-24 items-end gap-[3px]" aria-label="Latency per relayed root">
              {r.recent
                .slice()
                .reverse()
                .map((x) => (
                  <li
                    key={`${x.creditcoinTxHash}-${x.sourceBlock}`}
                    className="relative flex-1 rounded-t bg-brand/25"
                    style={{ height: `${Math.max(4, (x.endToEndSec / maxE2e) * 100)}%` }}
                    title={`${SOURCE_CHAINS[x.chainKey as SourceChainKey]?.label ?? x.chainKey} block ${x.sourceBlock}: ${formatDuration(x.endToEndSec)} end to end, ${formatDuration(x.relayDelaySec)} relay delay · ${formatRelativeTime(BigInt(x.relayedAt))}`}
                  >
                    <span
                      className="absolute inset-x-0 top-0 rounded-t bg-brand"
                      style={{ height: `${Math.min(100, (x.relayDelaySec / Math.max(1, x.endToEndSec)) * 100)}%` }}
                    />
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Relayed by:</span>
        {r.relayers.map((x) => (
          <span key={x.relayer} className="inline-flex items-center gap-1.5">
            <HashLink value={x.relayer as `0x${string}`} scope="creditcoin" kind="address" copy={false} />
            <Badge variant={x.operator ? "secondary" : "default"}>
              {x.operator ? "operator" : "independent"} · {x.roots}
            </Badge>
          </span>
        ))}
        {others.length > 0 ? (
          <span>
            — {others.reduce((n, x) => n + x.roots, 0)} of {r.endToEndAll.count} roots carried by wallets that
            are not Humanline&rsquo;s.
          </span>
        ) : null}
      </div>
    </div>
  );
}
