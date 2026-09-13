/**
 * Find the real inputs the live attacks need: a reverted Sepolia transaction, a World ID tree
 * update from before the relay's history, and a wallet already registered as a human, each with a
 * genuine Attestcoin proof from the CC3 proof builder.
 *
 * Network-heavy (CC3 logs, Sepolia receipts, the proof builder), so it runs from the worker CLI and
 * its output is committed as `evidence/attack-inputs.json`; `/judge` reuses that file and only
 * fires the calls.
 */

import { createPublicClient, encodePacked, http, keccak256, type Address, type Hex, type PublicClient } from "viem";

import { attestedWorldIdAbi, humanRegistryAbi } from "../abi";
import type { SingleProofJson } from "../relay/proof";
import { TREE_CHANGED_TOPIC, type AttackInputs } from "./core";

export type DiscoverOptions = {
  cc3Rpc: string;
  sepoliaRpc: string;
  proverUrl: string;
  sepoliaRelay: Address;
  mainnetRelay: Address;
  registry: Address;
  /** CC3 blocks the relay and the registry were deployed in; log scans start there. */
  relayDeployBlock: bigint;
  registryDeployBlock: bigint;
  /** The Sepolia identity manager the relay mirrors. */
  identityManager: Address;
  /** A relayed tree update and a non-World-ID transaction, from `contracts/test/fixtures/`. */
  relayed: SingleProofJson;
  foreign: SingleProofJson;
  log?: (line: string) => void;
};

const CC3_LOG_WINDOW = 5_000n;

async function proofFor(proverUrl: string, chainKey: number, txHash: string): Promise<SingleProofJson> {
  const response = await fetch(`${proverUrl}/api/v1/proof-by-tx/${chainKey}/${txHash}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`proof builder HTTP ${response.status} for ${txHash}`);
  return (await response.json()) as SingleProofJson;
}

type Receipt = { transactionHash: Hex; status: Hex; type: Hex; to: Address | null };

/** The digest a continuity proof folds to: keccak(uint64 height ‖ root ‖ previous), from the lower endpoint up. */
export function foldDigest(proof: SingleProofJson): { upperHeight: number; digest: Hex } {
  let digest = proof.continuityProof.lowerEndpointDigest as Hex;
  proof.continuityProof.roots.forEach((root, i) => {
    digest = keccak256(encodePacked(["uint64", "bytes32", "bytes32"], [BigInt(Number(proof.headerNumber) + i), root as Hex, digest]));
  });
  return { upperHeight: Number(proof.headerNumber) + proof.continuityProof.roots.length - 1, digest };
}

/** Whether the proof's continuity chain ends at a checkpoint Creditcoin recorded, which does not expire. */
export async function checkpointAnchored(client: Pick<PublicClient, "readContract">, proof: SingleProofJson): Promise<boolean> {
  const { upperHeight, digest } = foldDigest(proof);
  const checkpoint = await client.readContract({
    address: "0x0000000000000000000000000000000000000fD3",
    abi: [
      {
        type: "function",
        name: "get_checkpoint_for_height",
        stateMutability: "view",
        inputs: [
          { name: "chainKey", type: "uint64" },
          { name: "height", type: "uint64" },
        ],
        outputs: [
          {
            type: "tuple",
            components: [
              { name: "hash", type: "bytes32" },
              { name: "exists", type: "bool" },
            ],
          },
        ],
      },
    ] as const,
    functionName: "get_checkpoint_for_height",
    args: [BigInt(proof.chainKey), BigInt(upperHeight)],
  });
  return checkpoint.exists && checkpoint.hash.toLowerCase() === digest.toLowerCase();
}

export async function discoverAttackInputs(o: DiscoverOptions): Promise<AttackInputs> {
  const log = o.log ?? (() => {});
  const cc3 = createPublicClient({ transport: http(o.cc3Rpc, { timeout: 30_000, retryCount: 2 }) });
  const sepolia = createPublicClient({ transport: http(o.sepoliaRpc, { timeout: 30_000, retryCount: 2 }) });
  const head = await cc3.getBlockNumber();

  // ------------------------------------------------ a wallet that is already a human
  let registered: AttackInputs["registered"];
  for (let to = head; to >= o.registryDeployBlock && !registered; to -= CC3_LOG_WINDOW) {
    const from = to - CC3_LOG_WINDOW + 1n > o.registryDeployBlock ? to - CC3_LOG_WINDOW + 1n : o.registryDeployBlock;
    const events = await cc3.getContractEvents({
      address: o.registry,
      abi: humanRegistryAbi,
      eventName: "HumanRegistered",
      fromBlock: from,
      toBlock: to,
    });
    for (const event of events.reverse()) {
      const { nullifierHash, wallet } = event.args as { nullifierHash: bigint; wallet: Address };
      const bound = await cc3.readContract({ address: o.registry, abi: humanRegistryAbi, functionName: "humanOf", args: [wallet] });
      if (bound === nullifierHash) {
        registered = { wallet, nullifierHash: nullifierHash.toString() };
        break;
      }
    }
  }
  log(`registered wallet: ${registered?.wallet ?? "none found"}`);

  // ------------------------------------------------ a tree update from before the history
  let firstSourceBlock: bigint | undefined;
  for (let from = o.relayDeployBlock; from <= head && firstSourceBlock === undefined; from += CC3_LOG_WINDOW) {
    const to = from + CC3_LOG_WINDOW - 1n < head ? from + CC3_LOG_WINDOW - 1n : head;
    const events = await cc3.getContractEvents({
      address: o.sepoliaRelay,
      abi: attestedWorldIdAbi,
      eventName: "RootRelayed",
      fromBlock: from,
      toBlock: to,
    });
    const blocks = events.map((e) => (e.args as { sourceBlock: bigint }).sourceBlock);
    if (blocks.length > 0) firstSourceBlock = blocks.reduce((a, b) => (a < b ? a : b));
  }
  let stale: SingleProofJson | undefined;
  if (firstSourceBlock !== undefined) {
    const logs = await sepolia.getLogs({
      address: o.identityManager,
      fromBlock: firstSourceBlock - 20_000n,
      toBlock: firstSourceBlock - 1n,
    });
    const candidates = logs.filter((l) => l.topics[0] === TREE_CHANGED_TOPIC).reverse();
    for (const candidate of candidates.slice(1, 8)) {
      const preRoot = BigInt(candidate.topics[1] ?? "0x0");
      const seen = await cc3.readContract({
        address: o.sepoliaRelay,
        abi: attestedWorldIdAbi,
        functionName: "rootHistory",
        args: [preRoot],
      });
      if (seen !== 0n) continue;
      try {
        const proof = await proofFor(o.proverUrl, 1, candidate.transactionHash!);
        if (!(await checkpointAnchored(cc3, proof))) {
          log(`stale candidate ${candidate.transactionHash}: continuity ends at an attestation, not a checkpoint; skipping`);
          continue;
        }
        stale = proof;
        break;
      } catch (error) {
        log(`stale candidate ${candidate.transactionHash}: ${String(error)}`);
      }
    }
  }
  log(`pre-history tree update: ${stale?.txHash ?? "none found"} (relay history starts at Sepolia block ${firstSourceBlock})`);

  // ------------------------------------------------ a reverted transaction in the attested range
  const tip = await cc3.readContract({
    address: "0x0000000000000000000000000000000000000fD3",
    abi: [
      {
        type: "function",
        name: "get_latest_attestation_height_and_hash",
        stateMutability: "view",
        inputs: [{ name: "chainKey", type: "uint64" }],
        outputs: [
          {
            name: "result",
            type: "tuple",
            components: [
              { name: "height", type: "uint64" },
              { name: "hash", type: "bytes32" },
              { name: "isAttestation", type: "bool" },
              { name: "exists", type: "bool" },
            ],
          },
        ],
      },
    ] as const,
    functionName: "get_latest_attestation_height_and_hash",
    args: [1n],
  });
  // Recorded inputs are replayed for weeks by /judge and CI, so a proof is kept only when its
  // continuity chain ends at a checkpoint. One that ends at the then-latest attestation stops
  // verifying once the attestation bound moves on, and the attack would fail for the wrong reason.
  let reverted: SingleProofJson | undefined;
  for (let block = tip.height - 600n; block > tip.height - 3_000n && !reverted; block -= 1n) {
    const receipts = (await sepolia.request({
      method: "eth_getBlockReceipts" as never,
      params: [`0x${block.toString(16)}`] as never,
    })) as Receipt[] | null;
    const failed = (receipts ?? []).find((r) => r.status === "0x0" && (r.type === "0x0" || r.type === "0x2") && r.to);
    if (!failed) continue;
    try {
      const proof = await proofFor(o.proverUrl, 1, failed.transactionHash);
      if (await checkpointAnchored(cc3, proof)) reverted = proof;
      else log(`reverted candidate ${failed.transactionHash}: continuity ends at an attestation, not a checkpoint; skipping`);
    } catch (error) {
      log(`reverted candidate ${failed.transactionHash}: ${String(error)}`);
    }
  }
  log(`reverted transaction: ${reverted?.txHash ?? "none found"}`);

  return {
    generatedAt: new Date().toISOString(),
    sepoliaRelay: o.sepoliaRelay,
    mainnetRelay: o.mainnetRelay,
    registry: o.registry,
    relayed: o.relayed,
    foreign: o.foreign,
    reverted,
    stale,
    registered,
  };
}
