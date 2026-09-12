"use client";

import {
  IDKitRequestWidget,
  orbLegacy,
  type IDKitResult,
} from "@worldcoin/idkit";
import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FingerprintIcon,
  InfoIcon,
  Loader2Icon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";

import { HashLink } from "@/components/hash-link";
import { SelfRelayPanel } from "@/components/self-relay-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { humanRegistryAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import {
  WORLD_ACTION,
  WORLD_APP_ID,
  WORLD_SIMULATOR_URL,
} from "@/lib/contracts";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";
import { useRootStatus } from "@/lib/hooks/use-root-status";
import { useRpContext } from "@/lib/hooks/use-rp-context";
import { useSelfRelay } from "@/lib/hooks/use-self-relay";
import { useProfile } from "@/lib/profile-context";
import { useTx } from "@/lib/hooks/use-tx";
import { cn } from "@/lib/utils";
import { hashSignalAddress, toRegistrationProof, type RegistrationProof } from "@/lib/worldid";

/**
 * "Verify you're human", end to end.
 *
 * IDKit 4.x flow, using the `orbLegacy` preset with `allow_legacy_proofs` so the
 * widget returns a World ID 3.0 Semaphore proof — `merkle_root`, `nullifier` and
 * an ABI-encoded `uint256[8]` — which is exactly what the on-chain Groth16
 * verifier on Creditcoin consumes. The signal is the connected wallet address,
 * so the proof's `signalHash` equals the registry's
 * `hashToField(abi.encodePacked(msg.sender))` and the proof cannot be replayed
 * from another wallet.
 *
 * Documented at https://docs.world.org/world-id/idkit/integrate.
 *
 * The proof is *not* sent to World's cloud verify endpoint to decide anything:
 * `HumanRegistry.register` on Creditcoin is the verification.
 *
 * The card reads as three steps — prove, sync, verify — because the middle one
 * is the part people get stuck on: World issues a proof against its newest
 * Merkle root, and Creditcoin only accepts it once the relayer has carried that
 * root across. That wait is normal, so it is presented as progress (polling on
 * its own, with a toast when it lands), not as a warning.
 */
export function VerifyCard({ onRegistered }: { onRegistered?: () => void }) {
  const { address, chainId, isConnected } = useAccount();
  const { rpContext, loading: rpLoading, error: rpError, notConfigured, refresh } = useRpContext();

  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<RegistrationProof | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [proofError, setProofError] = useState<string | null>(null);

  const { profile } = useProfile();
  const registry = profile.deployment.contracts.humanRegistry.address;
  // The IDKit environment and the registry have to agree: a staging proof is not in
  // the Orb tree and an Orb proof is not in the staging tree, so verifying one
  // against the other's registry always reverts.
  const worldEnv = profile.worldEnv;
  const onRightChain = chainId === creditcoinTestnet.id;

  const tx = useTx({
    label: "Registering your World ID",
    onConfirmed: () => {
      setProof(null);
      onRegistered?.();
    },
  });

  // Whether the root this proof was minted against has reached Creditcoin yet.
  const rootStatus = useRootStatus(proof?.root);
  const rootNotRelayedYet = proof !== null && rootStatus.rootIsKnown === false;
  const rootConfirmed = proof !== null && rootStatus.rootIsKnown === true;

  // Nobody has to wait for our relayer: the same proof can be carried from this wallet.
  const sourceChainKey = profile.worldIdKey === "attestedWorldIDMainnet" ? 3 : 1;
  const selfRelay = useSelfRelay({
    chainKey: sourceChainKey,
    root: proof?.root,
    enabled: rootNotRelayedYet,
    onRelayed: () => void rootStatus.refetch(),
  });

  // Tell the user the moment the wait is over — they may have looked away.
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (rootNotRelayedYet) {
      wasWaiting.current = true;
      return;
    }
    if (wasWaiting.current && rootConfirmed) {
      wasWaiting.current = false;
      toast.success("Your proof reached Creditcoin", {
        description: "Step 3 is unlocked — verify whenever you are ready.",
      });
    }
  }, [rootNotRelayedYet, rootConfirmed]);

  const signalHash = useMemo(
    () => (address ? hashSignalAddress(address) : undefined),
    [address],
  );

  const handleResult = useCallback((result: IDKitResult) => {
    setProofError(null);

    if (result.protocol_version !== "3.0") {
      setProofError(
        "This credential is World ID 4.0; on-chain verification on Creditcoin currently supports 3.0 proofs. " +
          "Use a 3.0 credential or the staging simulator.",
      );
      return;
    }

    const response = result.responses?.[0];
    if (!response) {
      setProofError("World ID returned no credential response.");
      return;
    }

    try {
      setProof(toRegistrationProof(response));
      setReceivedAt(Math.floor(Date.now() / 1000));
    } catch (cause) {
      setProofError(cause instanceof Error ? cause.message : "Could not decode the proof.");
    }
  }, []);

  const submit = useCallback(async () => {
    if (!registry || !proof) return;
    await tx.send({
      address: registry,
      abi: humanRegistryAbi,
      functionName: "register",
      args: [proof.root, proof.nullifierHash, proof.proof],
      chainId: creditcoinTestnet.id,
    });
  }, [proof, registry, tx]);

  const startOver = useCallback(() => {
    setProof(null);
    setReceivedAt(0);
    setProofError(null);
    wasWaiting.current = false;
  }, []);

  const canOpenWidget =
    isConnected && onRightChain && Boolean(address) && Boolean(rpContext) && !rpLoading;

  const steps: [StepState, StepState, StepState] = !proof
    ? ["active", "upcoming", "upcoming"]
    : rootNotRelayedYet
      ? ["done", "working", "upcoming"]
      : !rootConfirmed
        ? ["done", "working", "upcoming"]
        : ["done", "done", tx.isBusy ? "working" : "active"];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <FingerprintIcon className="size-4 text-brand" />
              Verify you are a human
            </CardTitle>
            <CardDescription>
              One anonymous proof from World ID. Creditcoin never learns who you are — only that
              this wallet belongs to a unique human.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 capitalize"
            title={
              worldEnv === "staging"
                ? "Staging: proofs come from World's simulator, not a real Orb verification"
                : "Production: proofs come from Orb-verified World App users"
            }
          >
            {worldEnv}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <VerifySteps states={steps} />

        {!proof ? (
          <>
            {!isConnected ? (
              <Notice tone="info">
                Connect a wallet to start. Your proof is tied to that wallet, so it cannot be
                reused by anyone else.
              </Notice>
            ) : null}

            {isConnected && !onRightChain ? (
              <Notice tone="warn">
                Switch your wallet to Creditcoin CC3 testnet to continue.
              </Notice>
            ) : null}

            {notConfigured ? (
              <Notice tone="warn" title="World ID signing key not configured">
                {rpError}{" "}
                <span className="block pt-1">
                  Set{" "}
                  <code className="font-mono text-[11px]">WORLD_RP_SIGNER_PRIVATE_KEY</code> in{" "}
                  <code className="font-mono text-[11px]">web/.env.local</code> — it comes from the
                  repo-root <code className="font-mono text-[11px]">.secrets.env</code>. It is read
                  only on the server and never reaches the browser.
                </span>
              </Notice>
            ) : rpError ? (
              <Notice tone="warn" title="Could not prepare the proof request">
                {rpError}
                <Button variant="outline" size="sm" className="mt-2 self-start" onClick={refresh}>
                  <RefreshCwIcon />
                  Retry
                </Button>
              </Notice>
            ) : null}

            {proofError ? (
              <Notice tone="warn" title="That credential can't be used">
                {proofError}
              </Notice>
            ) : null}

            {!registry ? (
              <Notice tone="warn">
                HumanRegistry is not deployed on this profile yet, so a proof cannot be submitted.
                You can still produce one to try the flow.
              </Notice>
            ) : null}

            <div className="flex flex-col gap-2">
              <Button
                size="lg"
                disabled={!canOpenWidget}
                onClick={() => {
                  setProofError(null);
                  setOpen(true);
                }}
              >
                {rpLoading ? <Loader2Icon className="animate-spin" /> : <FingerprintIcon />}
                {rpLoading ? "Preparing…" : "Verify with World ID"}
              </Button>
              {worldEnv === "staging" ? (
                <p className="text-center text-xs text-muted-foreground">
                  Testing on staging? Scan the QR code with the{" "}
                  <a
                    href={WORLD_SIMULATOR_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-0.5 text-brand underline-offset-4 hover:underline"
                  >
                    World ID Simulator
                    <ExternalLinkIcon className="size-3" />
                  </a>{" "}
                  instead of World App.
                </p>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  Scan the QR code with World App. You need an Orb-verified World ID.
                </p>
              )}
            </div>
          </>
        ) : rootNotRelayedYet ? (
          <>
            <RelayWaitPanel receivedAt={receivedAt} onCheck={rootStatus.refetch}>
              <SelfRelayPanel
                plan={selfRelay.plan}
                planLoading={selfRelay.planLoading}
                planError={selfRelay.planError}
                phase={selfRelay.phase}
                progress={selfRelay.progress}
                txUrls={selfRelay.txUrls}
                error={selfRelay.error}
                busy={selfRelay.busy}
                canSend={isConnected && onRightChain}
                sourceLabel={sourceChainKey === 3 ? "Ethereum mainnet" : "Ethereum Sepolia"}
                onRelay={() => void selfRelay.run()}
                rewardPerRoot={selfRelay.rewardPerRoot}
                vaultAvailable={selfRelay.vaultAvailable}
              />
            </RelayWaitPanel>
            <Button size="lg" disabled>
              <LockIcon />
              Verify on Creditcoin
            </Button>
          </>
        ) : (
          <ReadyPanel
            confirming={!rootConfirmed}
            busy={tx.isBusy}
            disabled={!registry}
            error={tx.error}
            onVerify={() => void submit()}
          />
        )}

        {proof && !tx.isBusy ? (
          <button
            type="button"
            onClick={startOver}
            className="self-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Start over with a new proof
          </button>
        ) : null}

        <TechnicalDetails
          address={address}
          signalHash={signalHash}
          proof={proof}
          latestRoot={rootStatus.latestRoot}
        />

        {address && rpContext ? (
          <IDKitRequestWidget
            open={open}
            onOpenChange={setOpen}
            app_id={WORLD_APP_ID}
            action={WORLD_ACTION}
            rp_context={rpContext}
            allow_legacy_proofs
            environment={worldEnv}
            preset={orbLegacy({ signal: address })}
            onSuccess={handleResult}
            onError={(errorCode) => {
              if (errorCode === "user_rejected" || errorCode === "cancelled") return;
              setProofError(`World App returned "${errorCode}".`);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

type StepState = "done" | "active" | "working" | "upcoming";

const STEP_LABELS = ["Prove", "Sync", "Verify"] as const;

/** Three-segment progress: where the user is, and what is left. */
export function VerifySteps({ states }: { states: [StepState, StepState, StepState] }) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Verification progress">
      {STEP_LABELS.map((label, i) => {
        const state = states[i];
        const current = state === "active" || state === "working";
        return (
          <li key={label} className="flex min-w-0 flex-col gap-1.5" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "h-1 rounded-full transition-colors",
                state === "done" && "bg-success",
                current && "bg-brand",
                state === "working" && "animate-pulse",
                state === "upcoming" && "bg-muted",
              )}
              aria-hidden
            />
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  state === "done" && "bg-success/15 text-success",
                  current && "bg-brand/15 text-brand",
                  state === "upcoming" && "bg-muted text-muted-foreground",
                )}
                aria-hidden
              >
                {state === "done" ? (
                  <CheckIcon className="size-2.5" strokeWidth={3} />
                ) : state === "working" ? (
                  <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  "truncate text-xs font-medium",
                  state === "upcoming" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {label}
                <span className="sr-only">
                  {" "}
                  — {state === "done" ? "done" : state === "upcoming" ? "not started" : "in progress"}
                </span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Step 2: the proof exists, its root is still in transit. Normal, and self-resolving. */
export function RelayWaitPanel({
  receivedAt,
  onCheck,
  children,
}: {
  receivedAt: number;
  onCheck: () => Promise<void>;
  /** The self-relay option, rendered under the wait status. */
  children?: React.ReactNode;
}) {
  const now = useNow();
  const [checking, setChecking] = useState(false);
  const elapsed = now > 0 && receivedAt > 0 ? Math.max(0, now - receivedAt) : 0;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-brand/25 bg-brand/5 p-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <span className="relative mt-1 flex size-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Proof received — syncing to Creditcoin</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            World just added you to its latest update. Creditcoin accepts it once its attestors
            have followed Ethereum about 32 blocks past it (roughly 15 minutes), and then any
            relayer can carry it across. This step unlocks on its own — or relay it yourself below.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-brand/15 pt-2.5">
        <span className="text-xs text-muted-foreground tabular-nums">
          Waiting {formatDuration(elapsed)} · auto-checks every 20s
        </span>
        <div className="-mr-1.5 flex items-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                await onCheck();
              } finally {
                setChecking(false);
              }
            }}
          >
            <RefreshCwIcon className={checking ? "animate-spin" : undefined} />
            {checking ? "Checking…" : "Check now"}
          </Button>
          <a
            href="/relay"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-brand hover:bg-brand/10"
          >
            Watch live
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </div>

      {children}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <InfoIcon className="size-3 shrink-0" aria-hidden />
        Keep this tab open — your proof lives here until it is verified.
      </p>
    </div>
  );
}

/** Step 3: everything is in place; one transaction left. */
export function ReadyPanel({
  confirming,
  busy,
  disabled,
  error,
  onVerify,
}: {
  confirming: boolean;
  busy: boolean;
  disabled: boolean;
  error?: string | null;
  onVerify: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-success/25 bg-success/5 p-3">
        {confirming ? (
          <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin text-success" aria-hidden />
        ) : (
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            {confirming ? "Proof received — checking Creditcoin…" : "Your proof is ready"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            One transaction checks the proof on Creditcoin and links this wallet to your World ID.
            Only an anonymous nullifier is stored.
          </p>
        </div>
      </div>
      <Button size="lg" onClick={onVerify} disabled={disabled || busy}>
        {busy ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
        {busy ? "Confirm in your wallet…" : "Verify on Creditcoin"}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Everything a developer or judge wants to inspect, out of everyone else's way. */
export function TechnicalDetails({
  address,
  signalHash,
  proof,
  latestRoot,
}: {
  address: string | undefined;
  signalHash: bigint | undefined;
  proof: RegistrationProof | null;
  latestRoot: bigint | undefined;
}) {
  return (
    <details className="group rounded-lg bg-muted/30 text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        Technical details
        <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 border-t border-foreground/5 p-3">
        <dl className="grid gap-2 sm:grid-cols-2">
          <Field label="App id" value={WORLD_APP_ID} />
          <Field label="Action" value={WORLD_ACTION} />
          <Field label="Signal (your wallet)" value={address ?? "connect a wallet"} mono />
          <Field
            label="signalHash"
            value={signalHash === undefined ? "—" : `0x${signalHash.toString(16)}`}
            mono
            title="hashToField(abi.encodePacked(address)) — the registry recomputes this from msg.sender"
          />
        </dl>
        {proof ? (
          <dl className="grid gap-1.5 border-t border-foreground/5 pt-3">
            <ProofRow label="Proof Merkle root" value={proof.root} />
            <ProofRow label="Newest root on Creditcoin" value={latestRoot} />
            <ProofRow label="Nullifier hash" value={proof.nullifierHash} />
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Groth16 proof</dt>
              <dd className="font-mono text-xs">8 × uint256</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </details>
  );
}

function Field({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={title}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono text-[11px]" : "truncate text-[11px]"}>{value}</dd>
    </div>
  );
}

function ProofRow({ label, value }: { label: string; value: bigint | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value === undefined ? <span className="font-mono">…</span> : <HashLink value={value} kind="root" />}</dd>
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "info" | "warn";
  title?: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "warn" ? TriangleAlertIcon : InfoIcon;
  return (
    <div
      className={
        tone === "warn"
          ? "flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3"
          : "flex gap-2.5 rounded-lg border border-info/30 bg-info/5 p-3"
      }
    >
      <Icon
        className={tone === "warn" ? "mt-0.5 size-4 shrink-0 text-warning" : "mt-0.5 size-4 shrink-0 text-info"}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-0.5 text-xs">
        {title ? <p className="text-sm font-medium text-foreground">{title}</p> : null}
        <div className="flex flex-col text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
