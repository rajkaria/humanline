"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { Hex } from "viem";
import { useAccount, useReadContracts, useWriteContract } from "wagmi";

import { attestedWorldIdAbi, nativeQueryVerifierAbi, relayRewardAbi } from "@/lib/abi";
import { CONTRACTS } from "@/lib/contracts";
import { creditcoinTestnet, explorerUrl, PRECOMPILES, type SourceChainKey } from "@/lib/chains";
import { describeError } from "@/lib/format";
import { getPublicClient } from "@/lib/public-client";
import { planFromJson, type RelayPlan, type RelayPlanJson } from "@/lib/relay/plan";
import { argsFromJson, type ExecuteBatchArgsJson } from "@/lib/relay/proof";

export type SelfRelayPhase =
  | "idle"
  | "funding"
  | "proving"
  | "simulating"
  | "signing"
  | "confirming"
  | "done"
  | "error";

export type SelfRelayProgress = { batch: number; of: number };

type PlanResponse = {
  contract: Hex;
  latestRoot: string | null;
  attestedTip: number;
  finalityDepth: number;
  targetAttested: boolean | null;
  plan: RelayPlanJson;
};

/**
 * A wallet that has less than this cannot pay for a relay, so ask the faucet first.
 * A ten-root batch uses about 1.2M gas at CC3's 0.5 gwei, which is well under 0.001 tCTC.
 */
const MIN_RELAY_BALANCE = 5n * 10n ** 15n; // 0.005 tCTC

/** Contract errors that mean "someone else already carried this": success, not failure. */
const ALREADY_RELAYED = /QueryAlreadyProcessed|CannotOverwriteRoot|Query already processed/;

/**
 * "Relay it yourself": carry every World ID update between Creditcoin's newest root
 * and the proof's root, from the connected wallet.
 *
 * The server builds the plan and the proof (it can reach the source chain and the
 * proof builder; the browser cannot). The wallet sends `AttestedWorldID.executeBatch`,
 * which re-checks every claim through the 0x0FD2 precompile, so a user can never
 * be tricked into relaying a false root: a bad proof simply reverts.
 */
export function useSelfRelay(options: {
  chainKey: SourceChainKey;
  root: bigint | undefined;
  enabled: boolean;
  onRelayed?: () => void;
}) {
  const { chainKey, root, enabled, onRelayed } = options;
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const vault = CONTRACTS.relayReward.address;
  const vaultReads = useReadContracts({
    contracts: vault
      ? ([
          { address: vault, abi: relayRewardAbi, functionName: "REWARD_PER_ROOT", chainId: creditcoinTestnet.id },
          { address: vault, abi: relayRewardAbi, functionName: "available", chainId: creditcoinTestnet.id },
        ] as const)
      : [],
    query: { enabled: Boolean(vault) && enabled, refetchInterval: 60_000 },
  });
  const rewardPerRoot =
    vaultReads.data?.[0]?.status === "success" ? (vaultReads.data[0].result as bigint) : undefined;
  const vaultAvailable =
    vaultReads.data?.[1]?.status === "success" ? (vaultReads.data[1].result as bigint) : undefined;

  const [phase, setPhase] = useState<SelfRelayPhase>("idle");
  const [progress, setProgress] = useState<SelfRelayProgress | null>(null);
  const [txs, setTxs] = useState<Hex[]>([]);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const query = useQuery({
    queryKey: ["relay-plan", chainKey, root?.toString()],
    enabled: enabled && root !== undefined && root > 0n,
    refetchInterval: (q) => {
      const status = q.state.data?.plan.status;
      if (status === "known") return false;
      return status === "waiting" ? 15_000 : 30_000;
    },
    queryFn: async (): Promise<PlanResponse & { parsed: RelayPlan }> => {
      const response = await fetch(`/api/relay/plan?chainKey=${chainKey}&root=${root!.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as PlanResponse & { message?: string };
      if (!response.ok) throw new Error(body.message ?? `Relay plan failed (HTTP ${response.status}).`);
      return { ...body, parsed: planFromJson(body.plan) };
    },
  });

  const ensureGas = useCallback(async (account: Hex) => {
    const client = getPublicClient();
    const balance = await client.getBalance({ address: account });
    if (balance >= MIN_RELAY_BALANCE) return;
    setPhase("funding");
    const response = await fetch("/api/gas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: account }),
    });
    const body = (await response.json()) as { hash?: Hex; error?: string; detail?: string };
    if (!response.ok || !body.hash) {
      throw new Error(
        body.error === "faucet_empty" || body.error === "not_configured"
          ? "This wallet has no tCTC for gas and the faucet cannot top it up right now. Get tCTC from the public Creditcoin faucet and try again."
          : (body.detail ?? "Could not get gas for the relay."),
      );
    }
    await client.waitForTransactionReceipt({ hash: body.hash, timeout: 90_000 });
  }, []);

  const run = useCallback(async () => {
    if (running.current || !address) return;
    running.current = true;
    setError(null);
    setTxs([]);
    try {
      const fresh = await query.refetch();
      if (fresh.error) throw fresh.error;
      const data = fresh.data;
      if (!data) throw new Error("Could not load the relay plan.");
      const plan = data.parsed;
      if (plan.status === "known") {
        setPhase("done");
        onRelayed?.();
        return;
      }
      if (plan.status !== "ready") {
        throw new Error(
          plan.status === "waiting"
            ? "World's update is not attested deeply enough yet; the button unlocks when it is."
            : plan.reason,
        );
      }

      await ensureGas(address);
      const client = getPublicClient();

      for (const [i, batch] of plan.batches.entries()) {
        setProgress({ batch: i + 1, of: plan.batches.length });

        setPhase("proving");
        const response = await fetch("/api/relay/proof", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chainKey, txHashes: batch.changes.map((c) => c.txHash) }),
        });
        const body = (await response.json()) as { args?: ExecuteBatchArgsJson; message?: string };
        if (!response.ok || !body.args) {
          throw new Error(body.message ?? `The proof builder could not prove this update (HTTP ${response.status}).`);
        }
        const args = argsFromJson(body.args);

        // Free preflight: ask the 0x0FD2 precompile itself, with a view call, whether this proof
        // is valid before anything else happens. A stale or tampered proof stops here with a
        // plain answer instead of an opaque revert later.
        setPhase("simulating");
        const valid = await client.readContract({
          address: PRECOMPILES.blockProver,
          abi: nativeQueryVerifierAbi,
          functionName: "verify",
          args,
        });
        if (!valid) {
          throw new Error("The 0x0FD2 precompile says this proof does not verify (it may have gone stale). Try again for a fresh proof.");
        }

        // Through the RelayReward vault when one is deployed (the user is paid for fresh roots),
        // straight to AttestedWorldID otherwise. Dry-run first either way: a revert here costs
        // nothing, and it names the reason.
        setPhase("simulating");
        const vaultArgs = [data.contract, ...args] as const;
        let gas: bigint;
        try {
          gas = vault
            ? await client.estimateContractGas({
                account: address,
                address: vault,
                abi: relayRewardAbi,
                functionName: "relay",
                args: vaultArgs,
              })
            : await client.estimateContractGas({
                account: address,
                address: data.contract,
                abi: attestedWorldIdAbi,
                functionName: "executeBatch",
                args,
              });
        } catch (cause) {
          const message = describeError(cause);
          if (ALREADY_RELAYED.test(message) || ALREADY_RELAYED.test(String((cause as Error)?.message))) {
            continue; // another relayer beat us to this batch
          }
          throw new Error(`Creditcoin would refuse this relay: ${message}`);
        }

        setPhase("signing");
        const limit = (gas * 13n) / 10n;
        const hash = vault
          ? await writeContractAsync({
              address: vault,
              abi: relayRewardAbi,
              functionName: "relay",
              args: vaultArgs,
              chainId: creditcoinTestnet.id,
              gas: limit,
            })
          : await writeContractAsync({
              address: data.contract,
              abi: attestedWorldIdAbi,
              functionName: "executeBatch",
              args,
              chainId: creditcoinTestnet.id,
              gas: limit,
            });
        setTxs((prev) => [...prev, hash]);

        setPhase("confirming");
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success") throw new Error("The relay transaction reverted on Creditcoin.");
      }

      setPhase("done");
      toast.success("You relayed World's update to Creditcoin", {
        description: "Your proof's root is now on-chain. Step 3 is unlocked.",
      });
      onRelayed?.();
      void query.refetch();
    } catch (cause) {
      const message = describeError(cause);
      if (/user rejected|denied transaction|rejected the request/i.test(message)) {
        setPhase("idle");
      } else {
        setError(message);
        setPhase("error");
      }
    } finally {
      running.current = false;
      setProgress(null);
    }
  }, [address, chainKey, ensureGas, onRelayed, query, vault, writeContractAsync]);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTxs([]);
  }, []);

  return {
    plan: query.data?.parsed,
    planError: query.error ? describeError(query.error) : null,
    planLoading: query.isLoading,
    attestedTip: query.data?.attestedTip,
    /** Whether 0x0FD3 already has a continuity proof reaching the target update's block. */
    targetAttested: query.data?.targetAttested ?? undefined,
    phase,
    progress,
    txs,
    txUrls: txs.map((h) => explorerUrl("creditcoin", "tx", h)),
    error,
    /** tCTC wei the RelayReward vault pays per fresh root, when a vault is deployed. */
    rewardPerRoot,
    /** The vault's unreserved balance; a reward is capped by it. */
    vaultAvailable,
    busy: phase !== "idle" && phase !== "done" && phase !== "error",
    run,
    reset,
    refetchPlan: query.refetch,
  };
}
