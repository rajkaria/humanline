"use client";

import {
  IDKitRequestWidget,
  orbLegacy,
  type IDKitResult,
} from "@worldcoin/idkit";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  FingerprintIcon,
  InfoIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { HashLink } from "@/components/hash-link";
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
  CONTRACTS,
  WORLD_ACTION,
  WORLD_APP_ID,
  WORLD_ENV,
  WORLD_SIMULATOR_URL,
} from "@/lib/contracts";
import { useRpContext } from "@/lib/hooks/use-rp-context";
import { useTx } from "@/lib/hooks/use-tx";
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
 */
export function VerifyCard({ onRegistered }: { onRegistered?: () => void }) {
  const { address, chainId, isConnected } = useAccount();
  const { rpContext, loading: rpLoading, error: rpError, notConfigured, refresh } = useRpContext();

  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<RegistrationProof | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  const registry = CONTRACTS.humanRegistry.address;
  const onRightChain = chainId === creditcoinTestnet.id;

  const tx = useTx({
    label: "Registering your World ID",
    onConfirmed: () => {
      setProof(null);
      onRegistered?.();
    },
  });

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

  const canOpenWidget =
    isConnected && onRightChain && Boolean(address) && Boolean(rpContext) && !rpLoading;

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
              A zero-knowledge proof from World App. Nothing that identifies you leaves your
              device — Creditcoin only ever sees a nullifier.
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 capitalize">
            {WORLD_ENV}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
          <Field label="App id" value={WORLD_APP_ID} />
          <Field label="Action" value={WORLD_ACTION} />
          <Field
            label="Signal (your wallet)"
            value={address ?? "connect a wallet"}
            mono
          />
          <Field
            label="signalHash"
            value={signalHash === undefined ? "—" : `0x${signalHash.toString(16)}`}
            mono
            title="hashToField(abi.encodePacked(address)) — the registry recomputes this from msg.sender"
          />
        </dl>

        {!isConnected ? (
          <Notice tone="info">
            Connect a wallet first. The proof is bound to your address, so Humanline needs to
            know which one before it can ask World App for anything.
          </Notice>
        ) : null}

        {isConnected && !onRightChain ? (
          <Notice tone="warn">
            Switch to Creditcoin CC3 testnet (chainId {creditcoinTestnet.id}) before verifying.
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
            <Button variant="outline" size="sm" className="mt-2" onClick={refresh}>
              <RefreshCwIcon />
              Retry
            </Button>
          </Notice>
        ) : null}

        {proofError ? <Notice tone="warn" title="Unusable credential">{proofError}</Notice> : null}

        {!registry ? (
          <Notice tone="warn">
            HumanRegistry is not deployed yet, so a proof cannot be submitted. You can still
            produce one to check the flow.
          </Notice>
        ) : null}

        {proof ? (
          <div className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2Icon className="size-4 text-success" />
              Proof received. It has not been verified yet — that happens on Creditcoin.
            </div>
            <dl className="grid gap-1.5 text-xs">
              <ProofRow label="Merkle root" value={proof.root} />
              <ProofRow label="Nullifier hash" value={proof.nullifierHash} />
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Groth16 proof</dt>
                <dd className="font-mono text-xs">8 × uint256</dd>
              </div>
            </dl>
            <Button onClick={submit} disabled={!registry || tx.isBusy}>
              <ShieldCheckIcon />
              {tx.isBusy ? "Verifying on Creditcoin…" : "Verify on Creditcoin"}
            </Button>
            {tx.error ? <p className="text-xs text-destructive">{tx.error}</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              disabled={!canOpenWidget}
              onClick={() => {
                setProofError(null);
                setOpen(true);
              }}
            >
              <FingerprintIcon />
              {rpLoading ? "Preparing proof request…" : "Verify with World ID"}
            </Button>
            {WORLD_ENV === "staging" ? (
              <p className="text-xs text-muted-foreground">
                On staging, scan the QR code with the{" "}
                <a
                  href={WORLD_SIMULATOR_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-0.5 text-brand underline-offset-4 hover:underline"
                >
                  World ID Simulator
                  <ExternalLinkIcon className="size-3" />
                </a>{" "}
                rather than World App. The proof it issues is a real Semaphore proof against
                the staging tree, and it is verified on-chain exactly like a production one.
              </p>
            ) : null}
          </div>
        )}

        {address && rpContext ? (
          <IDKitRequestWidget
            open={open}
            onOpenChange={setOpen}
            app_id={WORLD_APP_ID}
            action={WORLD_ACTION}
            rp_context={rpContext}
            allow_legacy_proofs
            environment={WORLD_ENV}
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

function ProofRow({ label, value }: { label: string; value: bigint }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <HashLink value={value} kind="root" />
      </dd>
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
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
