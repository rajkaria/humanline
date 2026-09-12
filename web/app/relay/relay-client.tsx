"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, RadioIcon, ShieldIcon, TimerIcon } from "lucide-react";

import { ErrorBoundary } from "@/components/error-boundary";
import { HashLink } from "@/components/hash-link";
import { NotDeployedBanner } from "@/components/not-deployed-banner";
import { SectionHeading } from "@/components/page-shell";
import { Stat } from "@/components/stat";
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
import { attestedWorldIdAbi } from "@/lib/abi";
import {
  scopeForChainKey,
  SOURCE_CHAINS,
  SOURCE_CHAIN_LIST,
  type SourceChainKey,
} from "@/lib/chains";
import { CONTRACTS, WORLD_ID_INSTANCES } from "@/lib/contracts";
import { describeError, formatCount, formatRelativeTime, truncateUint256 } from "@/lib/format";
import { usePrecompiles } from "@/lib/hooks/use-precompiles";
import { useRelayFeed, type RelayRow } from "@/lib/hooks/use-relay-feed";
import { getPublicClient } from "@/lib/public-client";

export function RelayClient() {
  return (
    <div className="flex flex-col gap-10">
      <NotDeployedBanner need={["attestedWorldIDMainnet", "attestedWorldIDSepolia"]} />

      <ErrorBoundary title="Instance headers">
        <InstanceHeaders />
      </ErrorBoundary>

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Precompile guards"
          description="Read live from 0x0FD3 and 0x0FD4 with no wallet. These are the values AttestedWorldID checks before it accepts a root."
        />
        <ErrorBoundary title="Precompile guards">
          <PrecompileCards />
        </ErrorBoundary>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Roots relayed"
          description="Newest first, both source chains, refreshed every 15 seconds."
        />
        <ErrorBoundary title="Relay feed">
          <RelayTable />
        </ErrorBoundary>
      </section>
    </div>
  );
}

/** `latestRoot`, `rootCount` and `humansAddedTotal` for each instance. */
function InstanceHeaders() {
  const query = useQuery({
    queryKey: ["relay-instance-headers"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const client = getPublicClient();
      const instances = WORLD_ID_INSTANCES.map((i) => ({
        chainKey: i.chainKey,
        address: CONTRACTS[i.key].address,
      })).filter((i) => Boolean(i.address));

      return Promise.all(
        instances.map(async (instance) => {
          const read = <T,>(functionName: string) =>
            client
              .readContract({
                address: instance.address!,
                abi: attestedWorldIdAbi,
                functionName: functionName as "latestRoot",
              })
              .then((r) => r as T)
              .catch(() => undefined);

          const [latestRoot, rootCount, humansAddedTotal, finalityDepth, minAttestors] =
            await Promise.all([
              read<bigint>("latestRoot"),
              read<bigint>("rootCount"),
              read<bigint>("humansAddedTotal"),
              read<bigint>("FINALITY_DEPTH"),
              read<number>("MIN_ATTESTORS"),
            ]);

          return {
            chainKey: instance.chainKey,
            address: instance.address!,
            latestRoot,
            rootCount,
            humansAddedTotal,
            finalityDepth,
            minAttestors,
          };
        }),
      );
    },
  });

  if (query.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (query.error) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {describeError(query.error)}
      </p>
    );
  }

  if (!query.data || query.data.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {query.data.map((instance) => {
        const chain = SOURCE_CHAINS[instance.chainKey as SourceChainKey];
        return (
          <Card key={instance.address}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2">
                    <RadioIcon className="size-4 text-brand" />
                    AttestedWorldID · {chain.name}
                  </CardTitle>
                  <CardDescription>
                    chainKey {chain.chainKey} · identity manager{" "}
                    <HashLink
                      value={chain.identityManager}
                      scope={scopeForChainKey(chain.chainKey)}
                      kind="address"
                      copy={false}
                    />
                  </CardDescription>
                </div>
                <Badge variant={chain.tier === "production" ? "default" : "secondary"}>
                  {chain.tier}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-3">
                <Stat
                  label="Roots relayed"
                  value={instance.rootCount === undefined ? "—" : formatCount(instance.rootCount)}
                  emphasis
                />
                <Stat
                  label="Identities carried"
                  value={
                    instance.humansAddedTotal === undefined
                      ? "—"
                      : formatCount(instance.humansAddedTotal)
                  }
                />
              </dl>

              <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Latest root</span>
                  {instance.latestRoot === undefined || instance.latestRoot === 0n ? (
                    <span className="font-mono text-muted-foreground">none yet</span>
                  ) : (
                    <HashLink value={instance.latestRoot} kind="root" />
                  )}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Contract</span>
                  <HashLink value={instance.address} scope="creditcoin" kind="address" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Guards</span>
                  <span className="font-mono">
                    {instance.finalityDepth === undefined
                      ? "—"
                      : `${instance.finalityDepth} blocks`}{" "}
                    ·{" "}
                    {instance.minAttestors === undefined
                      ? "—"
                      : `≥${instance.minAttestors} attestors`}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function PrecompileCards() {
  const { data, isLoading, error } = usePrecompiles();

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (error || !data?.available) {
    return (
      <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
        The ChainInfo precompile at 0x0FD3 did not answer. This page reads it directly over
        JSON-RPC, so this usually means the RPC endpoint is unreachable rather than that the
        precompile is missing.
      </p>
    );
  }

  if (data.chains.length === 0) {
    return (
      <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
        This node attests no chain with chainKey 1 or 3 right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {data.chains.map((chain) => {
          const known = SOURCE_CHAIN_LIST.find((c) => c.chainKey === chain.chainKey);
          return (
            <Card key={chain.chainKey} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldIcon className="size-3.5 text-brand-2" />
                  {known?.name ?? chain.chainName} · chainKey {chain.chainKey}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3">
                  <Stat
                    label="Attested tip"
                    value={chain.attestedTip === undefined ? "—" : formatCount(chain.attestedTip)}
                    hint={
                      chain.attestedTipSource === "proof-builder"
                        ? "CC3 proof builder"
                        : "0x0FD3 ChainInfo"
                    }
                  />
                  <Stat
                    label="Attestors"
                    value={chain.attestors === undefined ? "—" : formatCount(chain.attestors)}
                    hint="0x0FD4 AttestorStash"
                  />
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {data.heightGetterUnavailable ? (
        <p className="text-xs text-muted-foreground">
          The attested-height getter on 0x0FD3 did not resolve by name on this node, so the tip
          above comes from the CC3 proof builder instead (or is blank if that is unreachable
          too). It is shown for context only: the finality guard is enforced on-chain by{" "}
          <code className="font-mono">AttestedWorldID</code> reading the precompile directly,
          and this page only mirrors it.
        </p>
      ) : null}
    </div>
  );
}

function RelayTable() {
  const { data, isLoading, error, isFetching } = useRelayFeed({ limit: 50 });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {describeError(error)}
      </p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <TimerIcon className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No roots relayed yet. World&rsquo;s sequencer updates the mainnet tree roughly
            hourly; the worker relays each update as soon as it is deep enough behind the
            attested tip.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Ethereum tx</TableHead>
              <TableHead className="hidden md:table-cell">Block · txIndex</TableHead>
              <TableHead>pre → post root</TableHead>
              <TableHead className="text-right">Humans</TableHead>
              <TableHead>Creditcoin tx</TableHead>
              <TableHead className="hidden lg:table-cell">Relayer</TableHead>
              <TableHead className="text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <RelayTableRow key={`${row.creditcoinTxHash}-${row.logIndex}`} row={row} />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {data.length} root{data.length === 1 ? "" : "s"} shown
        {isFetching ? " · refreshing…" : " · refreshes every 15s"}
      </p>
    </div>
  );
}

function RelayTableRow({ row }: { row: RelayRow }) {
  const chain = SOURCE_CHAINS[row.chainKey];
  const scope = scopeForChainKey(row.chainKey);

  return (
    <TableRow>
      <TableCell>
        <Badge variant={chain.tier === "production" ? "default" : "secondary"}>
          {chain.label}
        </Badge>
      </TableCell>

      <TableCell>
        {row.sourceTxHash ? (
          <HashLink value={row.sourceTxHash} scope={scope} kind="tx" copy={false} />
        ) : (
          // The event records the source block and Attestcoin's derived txIndex,
          // not the source hash. Link the block; the evidence log fills in the
          // hash when the worker recorded it.
          <HashLink
            value={row.sourceBlock}
            scope={scope}
            kind="block"
            label={`block ${row.sourceBlock} · #${row.sourceTxIndex}`}
            copy={false}
          />
        )}
      </TableCell>

      <TableCell className="hidden font-mono text-xs whitespace-nowrap text-muted-foreground md:table-cell">
        {row.sourceBlock.toString()} · #{row.sourceTxIndex.toString()}
      </TableCell>

      <TableCell>
        <span className="flex items-center gap-1.5 font-mono text-xs whitespace-nowrap">
          <span className="text-muted-foreground" title={row.preRoot.toString()}>
            {truncateUint256(row.preRoot, 4, 4)}
          </span>
          <ArrowRightIcon className="size-3 text-muted-foreground" aria-hidden />
          <HashLink value={row.postRoot} kind="root" />
        </span>
      </TableCell>

      <TableCell className="text-right font-mono tabular-nums">
        {row.kind === 0 ? "+" : ""}
        {formatCount(row.humansAdded)}
      </TableCell>

      <TableCell>
        <HashLink value={row.creditcoinTxHash} scope="creditcoin" kind="tx" copy={false} />
      </TableCell>

      <TableCell className="hidden lg:table-cell">
        <HashLink value={row.relayer} scope="creditcoin" kind="address" copy={false} />
      </TableCell>

      <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
        {row.timestamp ? formatRelativeTime(row.timestamp) : `block ${row.creditcoinBlock}`}
      </TableCell>
    </TableRow>
  );
}
