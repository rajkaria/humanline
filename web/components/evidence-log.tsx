import { FileClockIcon } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { HashLink } from "@/components/hash-link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { scopeForChainKey, SOURCE_CHAINS, type SourceChainKey } from "@/lib/chains";
import { EVIDENCE, hasEvidence } from "@/lib/evidence";
import { formatCount, formatTimestamp, truncateUint256 } from "@/lib/format";

/**
 * `evidence/relay-log.jsonl`, rendered.
 *
 * Present when the worker has run and committed its log; absent otherwise, with
 * copy that says so rather than an empty table pretending to be a full one.
 */
export function EvidenceLog() {
  if (!hasEvidence) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileClockIcon className="size-4 text-muted-foreground" />
            No evidence log committed yet
          </CardTitle>
          <CardDescription>
            The worker writes one JSON object per relayed root to{" "}
            <code className="font-mono text-xs">evidence/relay-log.jsonl</code>. It is
            snapshotted into this build by{" "}
            <code className="font-mono text-xs">web/scripts/sync-artifacts.ts</code>, so it
            appears here as soon as the file exists at build time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Until then, the <a href="/relay" className="text-brand underline-offset-4 hover:underline">relay feed</a>{" "}
            reads the same facts straight from the chain&rsquo;s{" "}
            <code className="font-mono text-xs">RootRelayed</code> logs, which is the stronger
            evidence anyway.
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows = EVIDENCE.slice(-50).reverse();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {formatCount(EVIDENCE.length)} entr{EVIDENCE.length === 1 ? "y" : "ies"} in{" "}
          <code className="font-mono text-xs">evidence/relay-log.jsonl</code>
          {EVIDENCE.length > rows.length ? `, showing the newest ${rows.length}` : ""}.
        </p>
        <CopyButton
          value={EVIDENCE.map((e) => JSON.stringify(e.raw)).join("\n")}
          label="Copy the whole evidence log"
          size="sm"
        />
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Ethereum tx</TableHead>
              <TableHead>Creditcoin tx</TableHead>
              <TableHead>postRoot</TableHead>
              <TableHead className="text-right">Humans</TableHead>
              <TableHead className="hidden md:table-cell">Recorded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((entry, index) => {
              const chain =
                entry.chainKey === 1 || entry.chainKey === 3
                  ? SOURCE_CHAINS[entry.chainKey as SourceChainKey]
                  : undefined;
              return (
                <TableRow key={`${entry.queryId ?? index}-${index}`}>
                  <TableCell>
                    <Badge variant={chain?.tier === "production" ? "default" : "secondary"}>
                      {chain?.label ?? `chainKey ${entry.chainKey ?? "?"}`}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {entry.sourceTxHash && chain ? (
                      <HashLink
                        value={entry.sourceTxHash}
                        scope={scopeForChainKey(chain.chainKey)}
                        kind="tx"
                        copy={false}
                      />
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">
                        {entry.sourceBlock === undefined
                          ? "—"
                          : `block ${entry.sourceBlock} · #${entry.sourceTxIndex ?? "?"}`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.creditcoinTxHash ? (
                      <HashLink
                        value={entry.creditcoinTxHash}
                        scope="creditcoin"
                        kind="tx"
                        copy={false}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.postRoot === undefined ? "—" : truncateUint256(entry.postRoot)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {entry.humansAdded ? formatCount(entry.humansAdded) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground md:table-cell">
                    {entry.timestamp ? formatTimestamp(entry.timestamp) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
