"use client";

/**
 * "You have no gas" is where a real user stops.
 *
 * Registering binds the World ID proof to `msg.sender`, so the human must send that
 * transaction themselves — a freshly created wallet with 0 tCTC cannot use Humanline
 * at all. This card watches the connected wallet's native balance and, when it is too
 * low to register, drips enough from the deployment's gas faucet to finish the flow.
 *
 * Shown only when it is needed: a funded wallet never sees it.
 */

import { FuelIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { formatEther } from "viem";
import { useAccount, useBalance } from "wagmi";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { creditcoinTestnet } from "@/lib/chains";

/** Matches ELIGIBILITY_CEILING in `app/api/gas/route.ts`. */
const LOW_BALANCE = 25n * 10n ** 16n; // 0.25 tCTC

export function GasCard() {
  const { address, isConnected, chainId } = useAccount();
  const balance = useBalance({
    address,
    chainId: creditcoinTestnet.id,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });

  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const request = useCallback(async () => {
    if (!address) return;
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/gas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = (await response.json()) as { hash?: string; error?: string; detail?: string };
      if (!response.ok) {
        setError(
          data.error === "already_funded"
            ? "This wallet already has enough gas."
            : data.error === "faucet_empty"
              ? "The gas faucet is empty — use the public Creditcoin faucet below."
              : data.error === "not_configured"
                ? "This deployment has no gas faucet configured — use the public faucet below."
                : (data.detail ?? "Could not send gas."),
        );
        setState("idle");
        return;
      }
      setHash(data.hash ?? null);
      setState("sent");
      // The balance query is on a 10s timer; nudge it so the card disappears promptly.
      setTimeout(() => void balance.refetch(), 4_000);
    } catch {
      setError("Could not reach the gas faucet.");
      setState("idle");
    }
  }, [address, balance]);

  const onRightChain = chainId === creditcoinTestnet.id;
  const value = balance.data?.value;
  const needsGas = isConnected && onRightChain && value !== undefined && value < LOW_BALANCE;

  if (!needsGas && state !== "sent") return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-1">
        <div className="flex items-start gap-2.5">
          <FuelIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">
              {state === "sent" ? "Gas sent" : "This wallet cannot pay for gas yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {state === "sent" ? (
                <>
                  1 tCTC is on its way — enough to register, borrow and repay many times
                  over. {hash ? <span className="font-mono text-[11px]">{hash.slice(0, 14)}…</span> : null}
                </>
              ) : (
                <>
                  Your proof is bound to your address, so you send the registration
                  transaction yourself — which needs a little CC3 testnet gas. Balance:{" "}
                  <span className="font-mono">
                    {value === undefined ? "…" : Number(formatEther(value)).toFixed(4)} tCTC
                  </span>
                  .
                </>
              )}
            </p>
          </div>
        </div>

        {state !== "sent" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={request} disabled={state === "sending"}>
              <FuelIcon />
              {state === "sending" ? "Sending…" : "Send me 1 tCTC"}
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
