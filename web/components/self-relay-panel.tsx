"use client";

import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  RadioTowerIcon,
  TimerIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import type { SelfRelayPhase, SelfRelayProgress } from "@/lib/hooks/use-self-relay";
import type { RelayPlan } from "@/lib/relay/plan";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<SelfRelayPhase, string> = {
  idle: "",
  funding: "Topping up gas from the Humanline faucet…",
  proving: "Fetching the Attestcoin proof…",
  simulating: "Dry-running on Creditcoin…",
  signing: "Confirm the relay in your wallet…",
  confirming: "Waiting for Creditcoin to include it…",
  done: "Relayed. Your root is on Creditcoin.",
  error: "",
};

/**
 * The "don't wait, relay it yourself" half of the Sync step.
 *
 * Presentational only: `useSelfRelay` owns the plan, proof, simulation and send.
 * Split out so every state (loading, waiting on attestation, ready, running,
 * failed, done) can be rendered and checked without a wallet.
 */
export function SelfRelayPanel({
  plan,
  planLoading,
  planError,
  phase,
  progress,
  txUrls,
  error,
  busy,
  canSend,
  sourceLabel,
  onRelay,
}: {
  plan: RelayPlan | undefined;
  planLoading: boolean;
  planError: string | null;
  phase: SelfRelayPhase;
  progress: SelfRelayProgress | null;
  txUrls: string[];
  error: string | null;
  busy: boolean;
  /** A wallet on CC3 is connected. */
  canSend: boolean;
  /** "Ethereum Sepolia", "Ethereum mainnet". */
  sourceLabel: string;
  onRelay: () => void;
}) {
  const ready = plan?.status === "ready";
  const waiting = plan?.status === "waiting";
  const updates = ready || waiting ? plan.chain.length : 0;
  const batches = ready || waiting ? plan.batches.length : 0;

  return (
    <div className="flex flex-col gap-2.5 border-t border-brand/15 pt-2.5" data-testid="self-relay">
      <div className="flex items-start gap-2.5">
        <RadioTowerIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Or relay it yourself, right now</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Relaying is permissionless. Your wallet sends the Attestcoin proof of World&rsquo;s update
            on {sourceLabel}; Creditcoin&rsquo;s 0x0FD2 precompile checks it, so it does not matter
            who sends it.
          </p>
        </div>
      </div>

      {planLoading ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
          Finding World&rsquo;s update on {sourceLabel}…
        </p>
      ) : planError ? (
        <p className="text-xs text-muted-foreground">
          Could not plan a relay right now ({planError}). The scheduled relayer will still carry it.
        </p>
      ) : plan && (plan.status === "not-found" || plan.status === "stale" || plan.status === "gap") ? (
        <p className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden />
          {plan.reason}
        </p>
      ) : waiting ? (
        <AttestationWait plan={plan} sourceLabel={sourceLabel} />
      ) : ready ? (
        <p className="text-xs text-muted-foreground" data-testid="self-relay-summary">
          {updates === 1 ? "1 World ID update" : `${updates} World ID updates`} to carry ·{" "}
          {batches === 1 ? "1 transaction" : `${batches} transactions`} · under 0.001 tCTC gas
          (topped up for you if the wallet is empty)
        </p>
      ) : null}

      {busy || phase === "done" ? (
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs",
            phase === "done" ? "text-success" : "text-foreground",
          )}
          role="status"
          aria-live="polite"
        >
          {phase === "done" ? (
            <CheckCircle2Icon className="size-3.5" aria-hidden />
          ) : (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          )}
          {PHASE_LABEL[phase]}
          {progress && progress.of > 1 ? ` (transaction ${progress.batch} of ${progress.of})` : ""}
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {txUrls.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {txUrls.map((url, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs font-medium text-brand underline-offset-4 hover:underline"
            >
              Relay tx {txUrls.length > 1 ? i + 1 : ""}
              <ExternalLinkIcon className="size-3" aria-hidden />
            </a>
          ))}
        </div>
      ) : null}

      {phase !== "done" ? (
        <Button
          variant={ready ? "default" : "outline"}
          size="sm"
          className="self-start"
          disabled={!ready || !canSend || busy}
          onClick={onRelay}
          data-testid="self-relay-button"
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <RadioTowerIcon />}
          {busy
            ? "Relaying…"
            : waiting
              ? `Relay unlocks in ~${formatDuration(plan.etaSeconds)}`
              : error
                ? "Try the relay again"
                : "Relay it now from your wallet"}
        </Button>
      ) : null}
    </div>
  );
}

function AttestationWait({
  plan,
  sourceLabel,
}: {
  plan: Extract<RelayPlan, { status: "waiting" }>;
  sourceLabel: string;
}) {
  // The update's own block is where the wait starts; `needHeight` is where it ends.
  const lastBlock = plan.chain[plan.chain.length - 1]!.blockNumber;
  const span = Math.max(1, plan.needHeight - lastBlock);
  const covered = Math.max(0, Math.min(1, (plan.attestedTip - lastBlock) / span));
  return (
    <div className="flex flex-col gap-1.5" data-testid="self-relay-waiting">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <TimerIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
        Creditcoin&rsquo;s attestors are {plan.blocksToGo} {sourceLabel} blocks short of the depth
        the contract requires (attested {plan.attestedTip.toLocaleString()} of{" "}
        {plan.needHeight.toLocaleString()}). Roughly {formatDuration(plan.etaSeconds)} to go.
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-brand/60 transition-all" style={{ width: `${covered * 100}%` }} />
      </div>
    </div>
  );
}
