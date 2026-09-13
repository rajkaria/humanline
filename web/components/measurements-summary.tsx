import type { Measurements } from "@/lib/measure/collect";
import generated from "@/lib/generated/measurements.json";

/** `sync-artifacts` drops the per-transaction records and the latency series from the bundle. */
type Snapshot = Omit<Measurements, "relayTxs" | "latency"> & {
  relayTxCount: number;
  latency: Omit<Measurements["latency"], "series">;
};
const m = generated as unknown as Partial<Snapshot>;

const int = (v: number | null | undefined) => (v === null || v === undefined ? "–" : Math.round(v).toLocaleString("en-US"));
const minutes = (s: number | null | undefined) => (s === null || s === undefined ? "–" : `${(s / 60).toFixed(0)} min`);

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl p-4 ring-1 ring-foreground/10">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

/** Headline numbers from `evidence/measurements.json`; the full tables live in docs/MEASUREMENTS.md. */
export function MeasurementsSummary() {
  if (!m.generatedAt) {
    return <p className="text-sm text-muted-foreground">No measurements recorded yet.</p>;
  }
  const fit = m.probe?.fit ?? m.liveFit;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          label="Gas per World ID update"
          value={fit ? `${int(fit.slope)} / update` : "–"}
          detail={fit ? `base ${int(fit.intercept)}, R² ${fit.r2.toFixed(3)}, ${fit.n} batches` : "not enough batches yet"}
        />
        <Tile
          label="Batch cap"
          value={`10 ok · 11 ${m.cap?.elevenError ?? "?"}`}
          detail={`a full batch ≈ ${int(m.cap?.projectedGasAt10)} gas, ${m.cap?.headroomAt10 ?? "?"}× inside one block`}
        />
        <Tile
          label="Source block → root on Creditcoin"
          value={`${minutes(m.latency?.summary?.p50)} median`}
          detail={`p90 ${minutes(m.latency?.summary?.p90)} over ${m.latency?.summary?.count ?? 0} roots, ${m.latency?.spanHours?.toFixed(1) ?? "?"} h`}
        />
        <Tile
          label="Relay calldata"
          value={`${int(m.proofSizes?.calldata?.p50)} bytes median`}
          detail={`max ${int(m.proofSizes?.calldata?.max)} across ${m.relayTxCount ?? 0} relay transactions`}
        />
        <Tile
          label="0x0FD2 verify gas"
          value={m.anchors?.verifyFit ? `+${int(m.anchors.verifyFit.slope)} / continuity root` : "–"}
          detail={`attestation read ${int(m.anchors?.attestationReadGas)} gas, checkpoint read ${int(m.anchors?.checkpointReadGas)} gas`}
        />
        <Tile
          label="Share of BlockProver traffic"
          value={m.precompile ? `${(m.precompile.humanlineShare * 100).toFixed(2)}%` : "–"}
          detail={m.precompile ? `${int(m.precompile.txs)} proof txs from ${m.precompile.callers.length} contracts in ${m.precompile.hours.toFixed(0)} h` : ""}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Collected {m.generatedAt} by <code className="font-mono">bun run worker/src/cli.ts measure</code>; every table is in{" "}
        <a className="underline" href="https://github.com/rajkaria/humanline/blob/main/docs/MEASUREMENTS.md">docs/MEASUREMENTS.md</a>.
      </p>
    </div>
  );
}
