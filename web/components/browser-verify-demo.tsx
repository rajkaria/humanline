"use client";

import { CheckCircle2Icon, Loader2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import type { Hex } from "viem";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { sourceProofFromJson, type SourceProofStruct } from "@/lib/crosschain/core";
import { describeError, isTxHash } from "@/lib/format";
import { getPublicClient } from "@/lib/public-client";
import type { SingleProofJson } from "@/lib/relay/proof";
import { verifySourceProofInBrowser, type BrowserCheck } from "@/lib/relay/verify-proof";

/** A real Circle USDC transfer on Sepolia; its proof is one the contract tests replay. */
const SAMPLE_TX = "0x2e34a9030ece366901a54228bed260f20cedfd6db22253d005b0aaeb27e8c7cb";

type Row = { label: string; detail: string; result: BrowserCheck };

/** Flip one hex digit near the end of the receipt: a forged log value or status. */
function forgeReceipt(proof: SourceProofStruct): SourceProofStruct {
  const bytes = proof.encodedTransaction;
  const at = bytes.length - 20;
  const forged = `${bytes.slice(0, at)}${bytes[at] === "f" ? "e" : "f"}${bytes.slice(at + 1)}` as Hex;
  return { ...proof, encodedTransaction: forged };
}

/** Drop the last continuity root: the chain no longer ends where the attestors signed. */
function truncateContinuity(proof: SourceProofStruct): SourceProofStruct {
  return {
    ...proof,
    continuityProof: { ...proof.continuityProof, roots: proof.continuityProof.roots.slice(0, -1) },
  };
}

/**
 * Proof verification in the browser, no wallet: the genuine proof passes, and two forgeries are
 * refused before anything is sent: one before any network call, one by the ChainInfo `0x0FD3`
 * lookup. `/app` runs the same check before every relay, link, history import and repayment.
 */
export function BrowserVerifyDemo() {
  const [txHash, setTxHash] = useState(SAMPLE_TX);
  const [chainKey, setChainKey] = useState<1 | 3>(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setRows([]);
    try {
      const response = await fetch(`/api/attestcoin/proof?chainKey=${chainKey}&txHash=${txHash}`, { cache: "no-store" });
      const json = (await response.json()) as SingleProofJson & { message?: string };
      if (!response.ok) throw new Error(json.message ?? `proof builder HTTP ${response.status}`);
      const proof = sourceProofFromJson(json, txHash);
      const client = getPublicClient();
      const genuine = await verifySourceProofInBrowser(client, proof, json.txIndex);
      const receipt = await verifySourceProofInBrowser(client, forgeReceipt(proof), json.txIndex);
      const continuity = await verifySourceProofInBrowser(client, truncateContinuity(proof), json.txIndex);
      setRows([
        {
          label: "Genuine proof",
          detail: `${proof.merkleProof.siblings.length} Merkle siblings · ${proof.continuityProof.roots.length} continuity roots from block ${json.headerNumber}`,
          result: genuine,
        },
        { label: "Forged receipt", detail: "one hex digit of the transaction bytes changed", result: receipt },
        { label: "Truncated continuity", detail: "last continuity root removed", result: continuity },
      ]);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="browser-verify">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4" aria-hidden /> Verify a proof in your browser
        </CardTitle>
        <CardDescription>
          Recomputes the Merkle path from the transaction bytes and the continuity digest chain, then checks the final
          digest against the one Creditcoin&rsquo;s attestors signed (ChainInfo 0x0FD3). The same check runs before every
          relay, link, history import and repayment on /app.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={chainKey}
            onChange={(e) => setChainKey(Number(e.target.value) as 1 | 3)}
            aria-label="Source chain"
          >
            <option value={1}>Sepolia (chainKey 1)</option>
            <option value={3}>Ethereum (chainKey 3)</option>
          </select>
          <Input className="min-w-0 flex-1 font-mono text-xs" value={txHash} onChange={(e) => setTxHash(e.target.value.trim())} />
          <Button onClick={run} disabled={busy || !isTxHash(txHash)}>
            {busy ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />} Verify
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {rows.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-live="polite">
            {rows.map((row) => (
              <li key={row.label} className="flex items-start gap-2.5 rounded-lg px-3 py-2 ring-1 ring-foreground/10">
                {row.result.ok ? (
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {row.label}
                    <Badge variant={row.result.ok ? "secondary" : "destructive"}>{row.result.ok ? "accepted" : "refused"}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{row.detail}</p>
                  <p className="font-mono text-xs break-all">
                    {row.result.ok
                      ? `digest ${row.result.digest} = ${row.result.via} at block ${row.result.upperHeight}`
                      : row.result.reason}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
