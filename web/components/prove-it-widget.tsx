"use client";

import {
  CheckCircle2Icon,
  Loader2Icon,
  SearchCheckIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import { CopyButton } from "@/components/copy-button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nativeQueryVerifierAbi } from "@/lib/abi";
import {
  PRECOMPILES,
  PROOF_BUILDER_URL,
  scopeForChainKey,
  SOURCE_CHAIN_LIST,
  type SourceChainKey,
} from "@/lib/chains";
import { describeError, isTxHash } from "@/lib/format";
import { getPublicClient } from "@/lib/public-client";

type ProverProof = {
  chainKey: number;
  headerNumber: number;
  txIndex: number;
  txHash: `0x${string}`;
  txBytes: `0x${string}`;
  continuityProof: { lowerEndpointDigest: `0x${string}`; roots: `0x${string}`[] };
  merkleProof: { root: `0x${string}`; siblings: Array<{ hash: `0x${string}`; isLeft?: boolean }> };
  cached?: boolean;
  generatedAt?: string;
};

type Outcome =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "verifying"; proof: ProverProof }
  | { kind: "done"; proof: ProverProof; verified: boolean; txIndexOnChain?: bigint }
  | { kind: "error"; message: string; proof?: ProverProof };

/**
 * Prove any Ethereum transaction to Creditcoin, live, without a wallet.
 *
 * Two steps, both visible:
 *
 *  1. Ask the CC3 proof builder for an inclusion + continuity proof of the
 *     transaction (`GET /api/v1/proof-by-tx/{chainKey}/{txHash}`, proxied by
 *     `/api/attestcoin/proof` because the builder sends no CORS headers).
 *  2. `eth_call` the 0x0FD2 BlockProver precompile's read-only `verify` overload
 *     with that proof. No transaction, no gas, no signer — the same verification
 *     `AttestedWorldID` performs, minus the state write.
 *
 * A judge can paste World's own `registerIdentities` transaction hash from
 * Etherscan and watch the precompile agree.
 */
export function ProveItWidget() {
  const [chainKey, setChainKey] = useState<SourceChainKey>(3);
  const [txHash, setTxHash] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const run = useCallback(async () => {
    const hash = txHash.trim();
    if (!isTxHash(hash)) {
      setOutcome({ kind: "error", message: "That is not a 32-byte transaction hash." });
      return;
    }

    setOutcome({ kind: "building" });

    let proof: ProverProof;
    try {
      const response = await fetch(
        `/api/attestcoin/proof?chainKey=${chainKey}&txHash=${hash}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as ProverProof & { message?: string };
      if (!response.ok) {
        setOutcome({
          kind: "error",
          message: data.message ?? "The proof builder could not produce a proof.",
        });
        return;
      }
      proof = data;
    } catch (error) {
      setOutcome({ kind: "error", message: describeError(error) });
      return;
    }

    setOutcome({ kind: "verifying", proof });

    try {
      const client = getPublicClient();
      const merkleProof = {
        root: proof.merkleProof.root,
        siblings: proof.merkleProof.siblings.map((s) => ({
          hash: s.hash,
          isLeft: Boolean(s.isLeft),
        })),
      } as const;

      const [verified, txIndexOnChain] = await Promise.all([
        client.readContract({
          address: PRECOMPILES.blockProver,
          abi: nativeQueryVerifierAbi,
          functionName: "verify",
          args: [
            BigInt(proof.chainKey),
            BigInt(proof.headerNumber),
            proof.txBytes,
            merkleProof,
            {
              lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest,
              roots: proof.continuityProof.roots,
            },
          ],
        }) as Promise<boolean>,
        client
          .readContract({
            address: PRECOMPILES.blockProver,
            abi: nativeQueryVerifierAbi,
            functionName: "calculateTxIndex",
            args: [merkleProof],
          })
          .then((v) => v as bigint)
          .catch(() => undefined),
      ]);

      setOutcome({ kind: "done", proof, verified, txIndexOnChain });
    } catch (error) {
      setOutcome({ kind: "error", message: describeError(error), proof });
    }
  }, [chainKey, txHash]);

  const busy = outcome.kind === "building" || outcome.kind === "verifying";
  const proof = "proof" in outcome ? outcome.proof : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SearchCheckIcon className="size-4 text-brand" />
          Prove it yourself
        </CardTitle>
        <CardDescription>
          Paste any Ethereum transaction hash. We fetch an Attestcoin proof from the CC3
          proof builder and <code className="font-mono text-xs">eth_call</code> the 0x0FD2
          precompile&rsquo;s read-only <code className="font-mono text-xs">verify</code>. No
          wallet, no gas, no trust in us.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="flex flex-wrap gap-2">
            {SOURCE_CHAIN_LIST.map((chain) => (
              <Button
                key={chain.chainKey}
                type="button"
                size="sm"
                variant={chainKey === chain.chainKey ? "default" : "outline"}
                onClick={() => setChainKey(chain.chainKey)}
              >
                {chain.name} · chainKey {chain.chainKey}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prove-tx-hash">Transaction hash</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="prove-tx-hash"
                placeholder="0x81ece311…"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                className="font-mono"
                spellCheck={false}
                aria-invalid={txHash !== "" && !isTxHash(txHash)}
              />
              <Button type="submit" disabled={busy || !isTxHash(txHash)} className="sm:w-40">
                {busy ? <Loader2Icon className="animate-spin" /> : <SearchCheckIcon />}
                {outcome.kind === "building"
                  ? "Building proof…"
                  : outcome.kind === "verifying"
                    ? "Verifying…"
                    : "Prove on Creditcoin"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Try a{" "}
              <code className="font-mono">registerIdentities</code> transaction from World&rsquo;s
              sequencer on{" "}
              <HashLink
                value={SOURCE_CHAIN_LIST.find((c) => c.chainKey === chainKey)!.identityManager}
                scope={scopeForChainKey(chainKey)}
                kind="address"
                label="the identity manager"
                copy={false}
              />
              . Proof builder: <code className="font-mono">{PROOF_BUILDER_URL}</code>
            </p>
          </div>
        </form>

        {outcome.kind === "error" ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {outcome.message}
          </p>
        ) : null}

        {outcome.kind === "done" ? (
          <div
            className={
              outcome.verified
                ? "flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-3"
                : "flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
            }
          >
            {outcome.verified ? (
              <CheckCircle2Icon className="size-5 shrink-0 text-success" />
            ) : (
              <XCircleIcon className="size-5 shrink-0 text-destructive" />
            )}
            <div className="flex flex-col gap-0.5 text-sm">
              <span className="font-medium">
                {outcome.verified
                  ? "0x0FD2 verified this transaction."
                  : "0x0FD2 rejected this proof."}
              </span>
              <span className="text-xs text-muted-foreground">
                {outcome.verified
                  ? "Inclusion and continuity both check out against Creditcoin's attested view of the source chain."
                  : "The precompile returned false. The transaction may not be attested yet, or the proof is for a different chain."}
                {outcome.txIndexOnChain === undefined
                  ? null
                  : ` calculateTxIndex → ${outcome.txIndexOnChain}.`}
              </span>
            </div>
          </div>
        ) : null}

        {proof ? (
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
              <Row label="chainKey" value={String(proof.chainKey)} />
              <Row label="headerNumber" value={String(proof.headerNumber)} />
              <Row label="txIndex" value={String(proof.txIndex)} />
              <Row label="merkle siblings" value={String(proof.merkleProof.siblings.length)} />
              <Row label="continuity roots" value={String(proof.continuityProof.roots.length)} />
              <Row label="txBytes" value={`${proof.txBytes.length / 2 - 1} bytes`} />
            </div>

            <details className="rounded-lg bg-muted/30 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Proof-builder JSON
              </summary>
              <div className="mt-2 flex items-start gap-2">
                <pre className="max-h-72 flex-1 overflow-auto rounded-md bg-background/60 p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(proof, null, 2)}
                </pre>
                <CopyButton
                  value={JSON.stringify(proof, null, 2)}
                  label="Copy proof JSON"
                  size="sm"
                />
              </div>
            </details>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            0x0FD2
          </Badge>
          <span>
            verify(uint64, uint64, bytes, (bytes32,(bytes32,bool)[]), (bytes32,bytes32[])) → bool
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
