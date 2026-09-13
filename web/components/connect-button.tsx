"use client";

import { ArrowLeftRightIcon, Loader2Icon, LogOutIcon, WalletIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type Connector, useAccount, useConnect, useDisconnect } from "wagmi";

import { CopyButton } from "@/components/copy-button";
import { useNetwork } from "@/components/network-guard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { creditcoinTestnet } from "@/lib/chains";
import { useMounted } from "@/lib/hooks/use-mounted";
import { describeError, truncateAddress } from "@/lib/format";

/**
 * Connect / wrong-network / connected, in one control.
 *
 * Switching is owned by `NetworkGuard`, which prompts the wallet on its own the
 * moment it connects on another network; this button is the manual retry. The
 * wallet list comes from EIP-6963 discovery, so with MetaMask, Rabby and Phantom
 * all installed the prompt goes to the wallet the user picked — not to whichever
 * extension won the race to overwrite `window.ethereum`.
 */
export function ConnectButton({ className }: { className?: string }) {
  const mounted = useMounted();

  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const network = useNetwork();

  // Rendered on the server and on the first client paint, before wagmi has
  // rehydrated — a skeleton avoids a hydration mismatch flash.
  if (!mounted) return <Skeleton className={className ?? "h-8 w-32"} />;

  if (!isConnected) return <ConnectWallet className={className} />;

  const disconnectButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => disconnect()}
      aria-label="Disconnect wallet"
      title="Disconnect"
    >
      <LogOutIcon />
    </Button>
  );

  if (network.wrongNetwork) {
    return (
      <div className={`flex items-center gap-1 ${className ?? ""}`}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                className="bg-warning text-background hover:bg-warning/90"
                disabled={network.switching}
                onClick={() => void network.switchToCc3()}
              />
            }
          >
            {network.switching ? <Loader2Icon className="animate-spin" /> : <ArrowLeftRightIcon />}
            {network.switching ? "Confirm in wallet…" : "Switch to CC3"}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Your wallet is on {network.currentNetwork}. Humanline runs on {creditcoinTestnet.name}{" "}
            (chainId {creditcoinTestnet.id}).
          </TooltipContent>
        </Tooltip>
        {disconnectButton}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-muted/60 px-2.5 ring-1 ring-foreground/10">
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        <span className="font-mono text-xs">{truncateAddress(address ?? "")}</span>
      </span>
      <CopyButton value={address ?? ""} label="Copy address" size="sm" />
      {disconnectButton}
    </div>
  );
}

/** "Connect wallet", with a picker when more than one wallet is installed. */
function ConnectWallet({ className }: { className?: string }) {
  const { connectors, connect, isPending, variables } = useConnect();
  const [open, setOpen] = useState(false);

  // EIP-6963 announces each installed wallet as its own connector (id = rdns).
  // The generic `injected` connector is only a fallback for wallets too old to
  // announce themselves.
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const choices = announced.length > 0 ? announced : connectors;
  const hasProvider =
    announced.length > 0 || (typeof window !== "undefined" && "ethereum" in window && Boolean(window.ethereum));

  // Failures go to a toast, not inline text: this button sits in the header,
  // where a wrapped paragraph under it pushes the whole nav out of line.
  const connectTo = (connector: Connector) => {
    setOpen(false);
    connect(
      { connector },
      { onError: (err) => toast.error("Could not connect", { description: describeError(err) }) },
    );
  };

  const onClick = () => {
    if (!hasProvider) {
      toast.error("No browser wallet detected", {
        description: "Install MetaMask or Rabby, then reload this page.",
      });
      return;
    }
    if (choices.length > 1) setOpen(true);
    else if (choices[0]) connectTo(choices[0]);
  };

  const pendingName = isPending ? (variables?.connector as Connector | undefined)?.name : undefined;

  return (
    <div className={className}>
      <Button onClick={onClick} disabled={isPending} size="sm">
        {isPending ? <Loader2Icon className="animate-spin" /> : <WalletIcon />}
        {isPending ? `Connecting${pendingName ? ` ${pendingName}` : ""}…` : "Connect wallet"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a wallet</DialogTitle>
            <DialogDescription>
              Pick the wallet to use. It will then ask to switch to {creditcoinTestnet.name}, and
              to add the network first if it has never seen it.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5">
            {choices.map((connector) => (
              <li key={connector.uid}>
                <Button
                  variant="outline"
                  className="h-11 w-full justify-start gap-3 px-3"
                  onClick={() => connectTo(connector)}
                >
                  {connector.icon ? (
                    // EIP-6963 icons are data: URIs supplied by the wallet; next/image adds nothing here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={connector.icon} alt="" className="size-6 rounded-md" />
                  ) : (
                    <WalletIcon className="size-6" />
                  )}
                  <span className="font-medium">
                    {connector.id === "injected" ? "Browser wallet" : connector.name}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
