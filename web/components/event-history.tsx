"use client";

import { HistoryIcon } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeError, formatRelativeTime, formatUsd } from "@/lib/format";
import { useLineEvents, type LineEventKind } from "@/lib/hooks/use-line-events";

const TONE: Record<LineEventKind, string> = {
  LineOpened: "bg-info/15 text-info",
  Borrowed: "bg-brand/15 text-brand",
  Repaid: "bg-success/15 text-success",
  LimitChanged: "bg-secondary text-secondary-foreground",
  Defaulted: "bg-destructive/15 text-destructive",
};

const AMOUNT_LABEL: Record<LineEventKind, string> = {
  LineOpened: "limit",
  Borrowed: "borrowed",
  Repaid: "repaid",
  LimitChanged: "new limit",
  Defaulted: "written off",
};

/** The connected human's loan history, straight out of the chain's logs. */
export function EventHistory({ human }: { human: bigint }) {
  const { data, isLoading, error } = useLineEvents(human, { limit: 25 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" />
          Loan history
        </CardTitle>
        <CardDescription>
          Every event keyed to your nullifier, read from Creditcoin logs. These are the same
          events a lender consumes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {describeError(error)}
          </p>
        ) : isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No activity yet. Open a line and borrow to start a history that follows you
            across wallets.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden sm:table-cell">Detail</TableHead>
                  <TableHead>Tx</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((event) => (
                  <TableRow key={`${event.txHash}-${event.logIndex}`}>
                    <TableCell>
                      <Badge className={TONE[event.kind]}>{event.kind}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {event.amount === undefined ? "—" : formatUsd(event.amount)}
                      <span className="pl-1 text-[10px] text-muted-foreground">
                        {AMOUNT_LABEL[event.kind]}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {formatDetail(event.kind, event.detail)}
                    </TableCell>
                    <TableCell>
                      <HashLink value={event.txHash} scope="creditcoin" kind="tx" copy={false} />
                    </TableCell>
                    <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
                      {event.timestamp
                        ? formatRelativeTime(event.timestamp)
                        : `block ${event.blockNumber}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Amounts embedded in the detail string are base units; render them as hUSD. */
function formatDetail(kind: LineEventKind, detail: string): string {
  const numeric = detail.match(/^(\D*)(\d+)(.*)$/);
  if (!numeric) return detail;
  if (kind !== "Borrowed" && kind !== "Repaid") return detail;
  return `${numeric[1]}${formatUsd(BigInt(numeric[2]))}${numeric[3]}`;
}
