"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";

import { creditcoinTestnet } from "@/lib/chains";
import {
  describeSwitchError,
  type Eip1193Request,
  isRequestPending,
  networkName,
  switchWalletToCc3,
} from "@/lib/network";

type NetworkState = {
  /** Connected, and the wallet reports a chain other than CC3 testnet. */
  wrongNetwork: boolean;
  /** Readable name of the network the wallet is on right now. */
  currentNetwork: string;
  /** A switch prompt is open in the wallet. */
  switching: boolean;
  /** Why the last switch failed, while the wallet is still on the wrong network. */
  error: string | null;
  /** Prompt the wallet to switch to CC3, adding the network if it needs to. */
  switchToCc3: () => Promise<void>;
};

const NetworkContext = createContext<NetworkState | null>(null);

const TOAST_ID = "cc3-network";

/**
 * The single owner of "get this wallet onto CC3".
 *
 * `ConnectButton` renders in the header and again inside page cards, so the
 * switch cannot live in the button: two instances would each fire a prompt,
 * and the wallet rejects the second with "request already pending". Mounted
 * once in `Providers`, this prompts the wallet automatically the first time a
 * given wallet + address shows up on the wrong network, and every button reads
 * the same pending / error state.
 */
export function NetworkGuard({ children }: { children: React.ReactNode }) {
  const { connector, chainId, address, status } = useAccount();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef(false);
  const autoPrompted = useRef<string | null>(null);

  const wrongNetwork = status === "connected" && chainId !== creditcoinTestnet.id;

  const switchToCc3 = useCallback(async () => {
    const attempt = async (): Promise<void> => {
      if (!connector || inFlight.current) return;
      inFlight.current = true;
      setSwitching(true);
      setError(null);
      try {
        const provider = (await connector.getProvider()) as { request?: Eip1193Request } | undefined;
        if (!provider?.request) {
          throw new Error(`${connector.name} does not expose a provider Humanline can ask to switch networks.`);
        }
        const outcome = await switchWalletToCc3(provider.request.bind(provider));

        // MetaMask sometimes switches without emitting `chainChanged`
        // (metamask-extension#24247). Read the chain back and tell wagmi directly
        // so the page does not sit on "wrong network" after a successful switch.
        const now = await connector.getChainId().catch(() => undefined);
        if (now === creditcoinTestnet.id) connector.emitter.emit("change", { chainId: now });

        toast.success(
          outcome === "added"
            ? `Added ${creditcoinTestnet.name} to ${connector.name} and switched to it`
            : `Switched to ${creditcoinTestnet.name}`,
          { id: TOAST_ID },
        );
      } catch (err) {
        const message = describeSwitchError(err);
        setError(message);
        toast.error(message, {
          id: TOAST_ID,
          // A pending prompt is already in the wallet; a retry button would only stack another.
          action: isRequestPending(err) ? undefined : { label: "Try again", onClick: () => void attempt() },
        });
      } finally {
        inFlight.current = false;
        setSwitching(false);
      }
    };
    await attempt();
  }, [connector]);

  // Prompt once per wallet + address, not on every render or chain flip: a
  // user who declines and then deliberately moves to another network should
  // see the button, not a prompt that reopens every time they touch the wallet.
  useEffect(() => {
    if (status === "disconnected") {
      autoPrompted.current = null;
      return;
    }
    if (!wrongNetwork || !connector || !address) return;
    const key = `${connector.uid}:${address.toLowerCase()}`;
    if (autoPrompted.current === key) return;
    autoPrompted.current = key;
    void switchToCc3();
  }, [status, wrongNetwork, connector, address, switchToCc3]);

  const value = useMemo<NetworkState>(
    () => ({
      wrongNetwork,
      currentNetwork: networkName(chainId),
      switching,
      error: wrongNetwork ? error : null,
      switchToCc3,
    }),
    [wrongNetwork, chainId, switching, error, switchToCc3],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

/** Network state shared by every wallet control on the page. */
export function useNetwork(): NetworkState {
  const value = useContext(NetworkContext);
  if (!value) throw new Error("useNetwork must be used inside <NetworkGuard> (see components/providers.tsx)");
  return value;
}
