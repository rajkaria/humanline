import { ShieldCheckIcon, ShieldXIcon } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { runAttacks, type AttackInputs, type AttackResult } from "@/lib/attacks/core";
import { creditcoinTestnet } from "@/lib/chains";
import generated from "@/lib/generated/attacks.json";

type Recorded = { at: string; attestedTip: string; attestors: number | null; results: AttackResult[] };
const data = generated as unknown as { inputs?: AttackInputs; recorded?: Recorded };

const RPC = creditcoinTestnet.rpcUrls.default.http[0];

async function fireLive(inputs: AttackInputs) {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000));
  return Promise.race([runAttacks(inputs, { rpcUrl: RPC, timeoutMs: 20_000 }), timeout]).catch(() => null);
}

/**
 * The twelve attacks, fired at CC3 testnet as `eth_call`s while this page renders. No wallet, no gas:
 * each row is the live contract (or the live 0x0FD2 precompile) refusing a real, hostile call.
 * Falls back to the last recorded run when the RPC is unreachable, and says so.
 */
export async function LiveAttacks() {
  if (!data.inputs) {
    return <p className="text-sm text-muted-foreground">No attack inputs recorded yet (run the worker&apos;s attack command).</p>;
  }
  const live = await fireLive(data.inputs);
  const results = live?.results ?? data.recorded?.results ?? [];
  const refused = results.filter((r) => r.outcome === "refused").length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {live ? (
          <>
            Fired live just now against Creditcoin CC3 testnet: <strong className="text-foreground">{refused} of {results.length}</strong>{" "}
            refused with the expected named revert. Sepolia attested tip {live.attestedTip}, {live.attestors ?? "?"} bonded attestors.
          </>
        ) : (
          <>
            CC3 did not answer in time, so this is the recorded run from {data.recorded?.at ?? "an earlier run"}:{" "}
            <strong className="text-foreground">{refused} of {results.length}</strong> refused.
          </>
        )}
      </p>
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Attack</TableHead>
              <TableHead className="hidden lg:table-cell">What it tries</TableHead>
              <TableHead>Refused with</TableHead>
              <TableHead className="hidden md:table-cell">Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    {r.outcome === "refused" ? (
                      <ShieldCheckIcon className="size-3.5 shrink-0 text-success" aria-label="refused" />
                    ) : (
                      <ShieldXIcon className="size-3.5 shrink-0 text-destructive" aria-label={r.outcome} />
                    )}
                    {r.title}
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-md text-xs text-muted-foreground lg:table-cell">
                  {r.threat}
                  {r.note ? <span className="mt-1 block opacity-80">{r.note}</span> : null}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {r.outcome === "refused" || r.outcome === "wrong-error" ? (
                    <>
                      {r.error}
                      {r.args && r.args.length > 0 ? (
                        <span className="text-muted-foreground">({r.args.map((a) => (a.length > 18 ? `${a.slice(0, 10)}…` : a)).join(", ")})</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-destructive">{r.outcome}</span>
                  )}
                </TableCell>
                <TableCell className="hidden font-mono text-xs md:table-cell">
                  {r.target ? <HashLink value={r.target} scope="creditcoin" kind="address" /> : "–"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
