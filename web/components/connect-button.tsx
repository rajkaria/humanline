"use client";

import { AlertTriangleIcon, LogOutIcon, WalletIcon } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { creditcoinTestnet } from "@/lib/chains";
import { useMounted } from "@/lib/hooks/use-mounted";
import { describeError, truncateAddress } from "@/lib/format";

/**
 * Connect / wrong-network / connected, in one control.
 *
 * The "wrong network" state calls `switchChain`, which wagmi implements as
 * `wallet_switchEthereumChain` with an automatic `wallet_addEthereumChain`
 * fallback built from the chain definition — so a judge whose MetaMask has
 * never seen Creditcoin gets the add-network prompt without extra plumbing.
 */
export function ConnectButton({ className }: { className?: string }) {
  const mounted = useMounted();

  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  // Rendered on the server and on the first client paint, before wagmi has
  // rehydrated — a skeleton avoids a hydration mismatch flash.
  if (!mounted) return <Skeleton className={className ?? "h-8 w-32"} />;

  const injectedConnector = connectors.find((c) => c.id === "injected") ?? connectors[0];

  if (!isConnected) {
    return (
      <div className={className}>
        <Button
          onClick={() => injectedConnector && connect({ connector: injectedConnector })}
          disabled={isPending || !injectedConnector}
          size="sm"
        >
          <WalletIcon />
          {isPending ? "Connecting…" : "Connect wallet"}
        </Button>
        {error ? (
          <p className="mt-1 max-w-56 text-xs text-destructive">{describeError(error)}</p>
        ) : null}
        {!injectedConnector ? (
          <p className="mt-1 max-w-56 text-xs text-muted-foreground">
            No injected wallet detected. Install MetaMask or Rabby to continue.
          </p>
        ) : null}
      </div>
    );
  }

  if (chainId !== creditcoinTestnet.id) {
    return (
      <Button
        variant="destructive"
        size="sm"
        className={className}
        disabled={isSwitching}
        onClick={() => switchChain({ chainId: creditcoinTestnet.id })}
      >
        <AlertTriangleIcon />
        {isSwitching ? "Switching…" : "Switch to CC3"}
      </Button>
    );
  }

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-muted/60 px-2.5 ring-1 ring-foreground/10">
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        <span className="font-mono text-xs">{truncateAddress(address ?? "")}</span>
      </span>
      <CopyButton value={address ?? ""} label="Copy address" size="sm" />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => disconnect()}
        aria-label="Disconnect wallet"
        title="Disconnect"
      >
        <LogOutIcon />
      </Button>
    </div>
  );
}
