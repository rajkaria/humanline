"use client";

import {
  CircleSlashIcon,
  FingerprintIcon,
  ShieldCheckIcon,
  UserRoundXIcon,
} from "lucide-react";

import { HashLink } from "@/components/hash-link";
import { StatRow } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatRelativeTime, formatTimestamp, formatUsd } from "@/lib/format";
import type { Line } from "@/lib/hooks/use-credit-line";
import type { HumanState } from "@/lib/hooks/use-human";
import { humanLabel } from "@/lib/worldid";

/**
 * The identity card at the top of `/app`.
 *
 * Three states: not connected, connected but not a human, and a registered human
 * with the line summary. The nullifier is shown as a short label plus the full
 * value on hover/copy — it is the account number of the whole product.
 */
export function HumanStatusCard({
  human,
  line,
  hasLine,
  available,
  loading,
  connected,
}: {
  human: HumanState;
  line: Line;
  hasLine: boolean;
  available: bigint;
  loading: boolean;
  connected: boolean;
}) {
  if (!connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRoundXIcon className="size-4 text-muted-foreground" />
            Not connected
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connect a wallet on Creditcoin CC3 testnet to see whether it belongs to a
            verified human, and to open a credit line if it does.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (!human.isHuman) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleSlashIcon className="size-4 text-muted-foreground" />
            Not a human yet
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            This wallet is not bound to a World ID nullifier yet. Verify below. It takes one
            proof and one transaction, and the credit line that follows belongs to you, not
            to this key.
          </p>
          {human.humanCount !== undefined ? (
            <p className="text-xs text-muted-foreground">
              {formatCount(human.humanCount)} human
              {human.humanCount === 1n ? "" : "s"} registered so far.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-success" />
            {humanLabel(human.nullifierHash)}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="gap-1 bg-success/15 text-success">
              <FingerprintIcon className="size-3" />
              Verified human
            </Badge>
            {line.frozen ? <Badge variant="destructive">Frozen</Badge> : null}
            {hasLine && !line.frozen ? <Badge variant="secondary">Line open</Badge> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col divide-y divide-foreground/10">
        <div className="pb-1">
          <StatRow
            label="Nullifier"
            value={<HashLink value={human.nullifierHash} kind="root" />}
            mono={false}
          />
          <StatRow
            label="Registered"
            value={
              human.registeredAt > 0n ? (
                <span title={formatTimestamp(human.registeredAt)}>
                  {formatRelativeTime(human.registeredAt)}
                </span>
              ) : (
                "–"
              )
            }
          />
        </div>

        {hasLine ? (
          <div className="pt-1">
            <StatRow label="Limit" value={`${formatUsd(line.limit)} hUSD`} />
            <StatRow label="Owed" value={`${formatUsd(line.principal)} hUSD`} />
            <StatRow label="Available" value={`${formatUsd(available)} hUSD`} />
            <StatRow
              label="History"
              value={`${line.loansRepaid} repaid · ${line.loansLate} late`}
            />
          </div>
        ) : (
          <p className="pt-3 text-sm text-muted-foreground">
            No credit line yet. Open one below. The first limit is set by the pool&rsquo;s{" "}
            <code className="font-mono text-xs">INITIAL_LIMIT</code>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
