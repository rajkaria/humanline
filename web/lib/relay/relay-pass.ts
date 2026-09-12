/**
 * One scheduled relay pass, run from a serverless function. Server-only.
 *
 * For each source chain: find the newest World ID update the finality guard
 * already accepts, plan the chain of updates from Creditcoin's tip to it with the
 * same planner the verify card uses, prove each batch, dry-run it, and send.
 * Deliberately the self-relay path with an operator key, so there is exactly one
 * relay implementation in the web app to reason about (the Bun worker remains the
 * long-running reference implementation).
 */

import {
  createWalletClient,
  decodeEventLog,
  http,
  type Hex,
  type LocalAccount,
  type PublicClient,
} from "viem";

import { attestedWorldIdAbi, nativeQueryVerifierAbi } from "@/lib/abi";
import { creditcoinTestnet, PRECOMPILES, type SourceChainKey } from "@/lib/chains";
import { attestedWorldIdFor, buildRelayPlan, newestFinalRoot } from "@/lib/relay/build-plan";
import { toExecuteBatchArgs } from "@/lib/relay/proof";
import { fetchRelayProof } from "@/lib/relay/prover";
import { readRootState } from "@/lib/relay/source";

export type PassStatus = "up-to-date" | "relayed" | "waiting" | "blocked" | "failed" | "dry-run";

export type PassOutcome = {
  chainKey: SourceChainKey;
  status: PassStatus;
  /** RootRelayed events emitted by this pass. */
  roots: number;
  txHashes: Hex[];
  detail?: string;
  ms: number;
};

const ALREADY_RELAYED = /QueryAlreadyProcessed|CannotOverwriteRoot|Query already processed/;

function rootRelayedCount(logs: ReadonlyArray<{ data: Hex; topics: readonly Hex[] }>): number {
  let n = 0;
  for (const log of logs) {
    try {
      const event = decodeEventLog({ abi: attestedWorldIdAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (event.eventName === "RootRelayed") n += 1;
    } catch {
      // not ours
    }
  }
  return n;
}

export async function relayPass(options: {
  client: PublicClient;
  account: LocalAccount;
  chainKeys?: SourceChainKey[];
  dryRun?: boolean;
  /** Stop starting new batches after this many ms; a function has a wall clock. */
  budgetMs?: number;
}): Promise<PassOutcome[]> {
  const { client, account, dryRun = false } = options;
  const chainKeys = options.chainKeys ?? [1, 3];
  const deadline = Date.now() + (options.budgetMs ?? 240_000);
  const wallet = createWalletClient({
    account,
    chain: creditcoinTestnet,
    transport: http(creditcoinTestnet.rpcUrls.default.http[0]),
  });

  const outcomes: PassOutcome[] = [];
  for (const chainKey of chainKeys) {
    const started = Date.now();
    const outcome: PassOutcome = { chainKey, status: "up-to-date", roots: 0, txHashes: [], ms: 0 };
    try {
      const contract = attestedWorldIdFor(chainKey);
      if (!contract) throw new Error(`no AttestedWorldID for chainKey ${chainKey}`);

      const state = await readRootState(client, contract, chainKey, 1n);
      const newest = await newestFinalRoot(chainKey, state);
      if (!newest || newest.postRoot === state.latestRoot) {
        outcome.detail = newest ? "latest final root already relayed" : "no final update in range";
        outcomes.push({ ...outcome, ms: Date.now() - started });
        continue;
      }

      const { plan } = await buildRelayPlan({ client, chainKey, root: newest.postRoot, contract });
      if (plan.status === "known") {
        outcome.detail = "root already valid";
      } else if (plan.status !== "ready" && plan.status !== "waiting") {
        outcome.status = "blocked";
        outcome.detail = `${plan.status}: ${plan.reason}`;
      } else {
        for (const batch of plan.batches) {
          if (!batch.final) {
            outcome.status = outcome.roots > 0 ? "relayed" : "waiting";
            break;
          }
          if (Date.now() > deadline) {
            outcome.detail = "time budget spent; the next pass continues";
            break;
          }
          const proof = await fetchRelayProof(chainKey, batch.changes.map((c) => c.txHash));
          const args = toExecuteBatchArgs(proof);

          // Free preflight through the precompile's view `verify`, before any gas estimate.
          const valid = await client.readContract({
            address: PRECOMPILES.blockProver,
            abi: nativeQueryVerifierAbi,
            functionName: "verify",
            args,
          });
          if (!valid) throw new Error("0x0FD2 verify() returned false for a freshly built proof");

          let gas: bigint;
          try {
            gas = await client.estimateContractGas({
              account: account.address,
              address: contract,
              abi: attestedWorldIdAbi,
              functionName: "executeBatch",
              args,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (ALREADY_RELAYED.test(message)) continue; // a user or another relayer got there first
            throw new Error(`dry run refused: ${message.split("\n")[0]}`);
          }

          if (dryRun) {
            outcome.status = "dry-run";
            continue;
          }
          const hash = await wallet.writeContract({
            address: contract,
            abi: attestedWorldIdAbi,
            functionName: "executeBatch",
            args,
            gas: (gas * 13n) / 10n,
          });
          const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
          if (receipt.status !== "success") throw new Error(`relay tx ${hash} reverted`);
          outcome.txHashes.push(hash);
          outcome.roots += rootRelayedCount(receipt.logs);
          outcome.status = "relayed";
        }
      }
    } catch (error) {
      outcome.status = "failed";
      outcome.detail = error instanceof Error ? error.message.slice(0, 300) : String(error);
    }
    outcomes.push({ ...outcome, ms: Date.now() - started });
  }
  return outcomes;
}
