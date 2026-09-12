"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from "lucide-react";
import { useState } from "react";

import { HashLink } from "@/components/hash-link";
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
import { humanRegistryAbi } from "@/lib/abi";
import { CONTRACTS, WORLD_ACTION, WORLD_APP_ID } from "@/lib/contracts";
import { describeError, isAddress, toHex32 } from "@/lib/format";
import { getPublicClient } from "@/lib/public-client";
import { externalNullifierHash, hashSignalAddress } from "@/lib/worldid";

const SAMPLE = "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3";

/**
 * Cross-check the browser's World ID hashing against the deployed contract.
 *
 * Two values decide whether a Semaphore proof verifies:
 *
 *   signalHash            = hashToField(abi.encodePacked(msg.sender))
 *   externalNullifierHash = hashToField(abi.encodePacked(hashToField(app_id), action))
 *
 * `lib/worldid.ts` computes both in the browser; `HumanRegistry` computes the
 * first in `signalHashOf` and stores the second at construction. If they ever
 * disagreed, every registration would fail with an unreadable Groth16 error — so
 * this widget calls the contract and compares, live, in front of a judge.
 */
export function SignalHashCheck() {
  const [wallet, setWallet] = useState(SAMPLE);
  const registry = CONTRACTS.humanRegistry.address;
  const valid = isAddress(wallet);

  const query = useQuery({
    queryKey: ["signal-hash-check", registry, wallet.trim().toLowerCase()],
    enabled: Boolean(registry) && valid,
    staleTime: Infinity,
    queryFn: async () => {
      const client = getPublicClient();
      const address = wallet.trim() as `0x${string}`;
      const [onChainSignal, onChainExternal, appId, action] = await Promise.all([
        client.readContract({
          address: registry!,
          abi: humanRegistryAbi,
          functionName: "signalHashOf",
          args: [address],
        }) as Promise<bigint>,
        client.readContract({
          address: registry!,
          abi: humanRegistryAbi,
          functionName: "EXTERNAL_NULLIFIER_HASH",
        }) as Promise<bigint>,
        client.readContract({
          address: registry!,
          abi: humanRegistryAbi,
          functionName: "APP_ID",
        }) as Promise<string>,
        client.readContract({
          address: registry!,
          abi: humanRegistryAbi,
          functionName: "ACTION",
        }) as Promise<string>,
      ]);

      return {
        onChainSignal,
        onChainExternal,
        appId,
        action,
        localSignal: hashSignalAddress(address),
        localExternal: externalNullifierHash(appId, action),
        localExternalFromEnv: externalNullifierHash(WORLD_APP_ID, WORLD_ACTION),
      };
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>World ID hashing, checked against the contract</CardTitle>
        <CardDescription>
          The browser and <code className="font-mono text-xs">HumanRegistry</code> must
          compute the same <code className="font-mono text-xs">signalHash</code> and{" "}
          <code className="font-mono text-xs">externalNullifierHash</code>, or no proof can
          ever verify. This calls the deployed contract and compares.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signal-wallet">Any wallet address</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="signal-wallet"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              className="font-mono"
              spellCheck={false}
              aria-invalid={wallet !== "" && !valid}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setWallet(SAMPLE)}
              className="sm:w-32"
            >
              Reset
            </Button>
          </div>
        </div>

        {!registry ? (
          <p className="text-sm text-muted-foreground">
            HumanRegistry is not deployed yet, so there is nothing to compare against.
          </p>
        ) : !valid ? (
          <p className="text-sm text-muted-foreground">Enter a 20-byte address.</p>
        ) : query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Reading the contract…
          </p>
        ) : query.error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {describeError(query.error)}
          </p>
        ) : query.data ? (
          <div className="flex flex-col gap-3">
            <Comparison
              label="signalHash"
              hint="hashToField(abi.encodePacked(wallet))"
              local={query.data.localSignal}
              onChain={query.data.onChainSignal}
            />
            <Comparison
              label="externalNullifierHash"
              hint={`hashToField(abi.encodePacked(hashToField("${query.data.appId}"), "${query.data.action}"))`}
              local={query.data.localExternal}
              onChain={query.data.onChainExternal}
            />
            {query.data.localExternalFromEnv === query.data.onChainExternal ? null : (
              <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
                The app id and action this front end is configured with (
                <code className="font-mono">{WORLD_APP_ID}</code> /{" "}
                <code className="font-mono">{WORLD_ACTION}</code>) do not derive the external
                nullifier the registry stores. Proofs produced by this widget would not
                verify — set <code className="font-mono">NEXT_PUBLIC_WORLD_APP_ID</code> and{" "}
                <code className="font-mono">NEXT_PUBLIC_WORLD_ACTION</code> to the values the
                contract was deployed with.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Comparison({
  label,
  hint,
  local,
  onChain,
}: {
  label: string;
  hint: string;
  local: bigint;
  onChain: bigint;
}) {
  const agree = local === onChain;
  return (
    <div
      className={
        agree
          ? "flex flex-col gap-2 rounded-lg border border-success/30 bg-success/5 p-3"
          : "flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
      }
    >
      <div className="flex items-center gap-2">
        {agree ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-success" />
        ) : (
          <XCircleIcon className="size-4 shrink-0 text-destructive" />
        )}
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          {agree ? "browser and contract agree" : "MISMATCH"}
        </span>
      </div>
      <p className="font-mono text-[11px] break-all text-muted-foreground">{hint}</p>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">in this browser</dt>
          <dd>
            <HashLink value={toHex32(local)} />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">on Creditcoin</dt>
          <dd>
            <HashLink value={toHex32(onChain)} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
