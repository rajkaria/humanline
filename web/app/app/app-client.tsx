"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAccount } from "wagmi";

import { ConnectButton } from "@/components/connect-button";
import { CreditPanel } from "@/components/credit-panel";
import { CrossChainPanel } from "@/components/cross-chain-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { EventHistory } from "@/components/event-history";
import { GasCard } from "@/components/gas-card";
import { HumanStatusCard } from "@/components/human-status-card";
import { LenderPanel } from "@/components/lender-panel";
import { useNetwork } from "@/components/network-guard";
import { NotDeployedBanner } from "@/components/not-deployed-banner";
import { ProfileSwitch } from "@/components/profile-switch";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VerifyCard } from "@/components/verify-card";
import { creditcoinTestnet } from "@/lib/chains";
import { useCreditLine } from "@/lib/hooks/use-credit-line";
import { useMounted } from "@/lib/hooks/use-mounted";
import { useHuman } from "@/lib/hooks/use-human";
import { useProfile } from "@/lib/profile-context";

/**
 * The whole borrower + lender surface.
 *
 * Everything below the fold is driven by two batched reads (`useHuman`,
 * `useCreditLine`) so a confirmed transaction refreshes the entire page state
 * with one call rather than a cascade of independent refetches.
 */
export function AppClient() {
  const { isConnected, chainId } = useAccount();
  const mounted = useMounted();
  const { profile } = useProfile();
  const network = useNetwork();

  const human = useHuman();
  const credit = useCreditLine(human.nullifierHash);

  // After any confirmed transaction, drop every cached chain read at once.
  // Invalidating through the query client is both simpler and less fragile than
  // threading individual refetchers through five components.
  const queryClient = useQueryClient();
  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const connected = mounted && isConnected;
  const onRightChain = chainId === creditcoinTestnet.id;

  return (
    <div className="flex flex-col gap-6">
      <NotDeployedBanner
        need={["humanRegistry", "creditLine", "husd"]}
        deployment={profile.deployment}
      />

      <ProfileSwitch />

      <GasCard />

      {mounted && !isConnected ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Connect a wallet on Creditcoin CC3 testnet (chainId {creditcoinTestnet.id}) to
              begin. Everything on this page is readable without one — see{" "}
              <a href="/judge" className="text-brand underline-offset-4 hover:underline">
                /judge
              </a>
              .
            </p>
            <ConnectButton />
          </CardContent>
        </Card>
      ) : null}

      {connected && !onRightChain ? (
        <Card className="ring-warning/40">
          <CardContent className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Your wallet is on{" "}
              <span className="font-medium text-foreground">{network.currentNetwork}</span>.
              Humanline runs on Creditcoin CC3 testnet (chainId {creditcoinTestnet.id}). Approve
              the switch in your wallet — if it has never seen CC3, it asks to add the network
              first.
            </p>
            <ConnectButton />
            {network.error ? (
              <p className="text-xs text-destructive" role="alert">
                {network.error}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-6">
          <ErrorBoundary title="Human status">
            <HumanStatusCard
              human={human}
              line={credit.line}
              hasLine={credit.hasLine}
              available={credit.available}
              loading={connected && human.isLoading}
              connected={connected}
            />
          </ErrorBoundary>

          {connected && !human.isHuman ? (
            <ErrorBoundary title="World ID verification">
              <VerifyCard onRegistered={refreshAll} />
            </ErrorBoundary>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Tabs defaultValue="borrow">
            <TabsList>
              <TabsTrigger value="borrow">Borrow</TabsTrigger>
              <TabsTrigger value="lend">Lend</TabsTrigger>
            </TabsList>

            <TabsContent value="borrow" className="flex flex-col gap-6 pt-2">
              {connected && human.isHuman ? (
                <>
                  <ErrorBoundary title="Credit line">
                    <CreditPanel
                      human={human.nullifierHash}
                      line={credit.line}
                      hasLine={credit.hasLine}
                      available={credit.available}
                      inDefault={credit.inDefault}
                      terms={credit.terms}
                      balance={credit.balance}
                      allowance={credit.allowance}
                      symbol={credit.symbol}
                      faucetAvailableAt={credit.faucetAvailableAt}
                      faucetAmount={credit.faucetAmount}
                      loading={credit.isLoading}
                      onChanged={refreshAll}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary title="Ethereum history">
                    <CrossChainPanel
                      human={human.nullifierHash}
                      owed={credit.line.principal}
                      onChanged={refreshAll}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary title="Loan history">
                    <EventHistory human={human.nullifierHash} />
                  </ErrorBoundary>
                </>
              ) : (
                <Card>
                  <CardContent className="py-6 text-sm text-muted-foreground">
                    Verify with World ID first. A credit line is opened against a human, not
                    against an address, so there is nothing to open until this wallet is
                    bound to a nullifier.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="lend" className="pt-2">
              <ErrorBoundary title="Lender pool">
                <LenderPanel
                  pool={credit.pool}
                  balance={credit.balance}
                  allowance={credit.allowance}
                  symbol={credit.symbol}
                  onChanged={refreshAll}
                />
              </ErrorBoundary>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
