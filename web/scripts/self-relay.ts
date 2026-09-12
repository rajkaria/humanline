#!/usr/bin/env bun
/**
 * Self-relay from the command line, through exactly the code the verify card uses.
 *
 *   bun run scripts/self-relay.ts                       # plan + proof + eth_call simulation, no tx
 *   bun run scripts/self-relay.ts --root <uint256>      # a specific proof root
 *   bun run scripts/self-relay.ts --send --fresh        # a brand-new wallet, funded by the gas
 *                                                       # faucet, relays from its own balance
 *
 * Options: --chain-key 1|3 (default 1), --env-file <path> (default ../.secrets.env),
 *          --evidence <path> (default ../evidence/self-relay.jsonl).
 *
 * `--fresh` is the point: it proves "anyone can relay" with an address that has never
 * touched Humanline, holding nothing but faucet gas.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createWalletClient,
  decodeEventLog,
  formatEther,
  http,
  parseEther,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { attestedWorldIdAbi } from "@/lib/abi";
import { creditcoinTestnet, type SourceChainKey } from "@/lib/chains";
import { getPublicClient } from "@/lib/public-client";
import { attestedWorldIdFor, buildRelayPlan, newestFinalRoot } from "@/lib/relay/build-plan";
import { toExecuteBatchArgs } from "@/lib/relay/proof";
import { fetchRelayProof } from "@/lib/relay/prover";
import { readRootState } from "@/lib/relay/source";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

const here = import.meta.dir;
loadEnv(resolve(arg("env-file") ?? resolve(here, "..", "..", ".secrets.env")));

const chainKey = Number(arg("chain-key") ?? 1) as SourceChainKey;
const send = flag("send");
const fresh = flag("fresh");
const evidencePath = resolve(arg("evidence") ?? resolve(here, "..", "..", "evidence", "self-relay.jsonl"));
const log = (...parts: unknown[]) => console.log(...parts);

const client = getPublicClient();
const contract = attestedWorldIdFor(chainKey);
if (!contract) throw new Error(`no AttestedWorldID for chainKey ${chainKey}`);

let root = arg("root") ? BigInt(arg("root")!) : undefined;
if (root === undefined) {
  const state = await readRootState(client, contract, chainKey, 1n);
  const newest = await newestFinalRoot(chainKey, state);
  if (!newest) throw new Error("no final World ID update found on the source chain");
  root = newest.postRoot;
  log(`target: newest final update, block ${newest.blockNumber} tx ${newest.txHash}`);
}

const started = Date.now();
const built = await buildRelayPlan({ client, chainKey, root, contract });
log(`plan (${Date.now() - started} ms): ${built.plan.status}`);
log(`  creditcoin latestRoot ${built.state.latestRoot}`);
log(`  attested tip ${built.state.attestedTip}, finality depth ${built.state.finalityDepth}, source head ${built.sourceHead}`);

const plan = built.plan;
if (plan.status !== "ready" && plan.status !== "waiting") {
  log(plan.status === "known" ? "  root already valid on Creditcoin — nothing to relay" : `  ${plan.reason}`);
  process.exit(0);
}
log(`  ${plan.chain.length} update(s) in ${plan.batches.length} batch(es); blocks to go ${plan.blocksToGo} (~${plan.etaSeconds}s)`);
for (const [i, b] of plan.batches.entries()) {
  log(`  batch ${i + 1}: ${b.changes.length} tx, blocks ${b.fromBlock}..${b.toBlock}, final=${b.final}`);
}

let account = privateKeyToAccount(
  (process.env.GAS_FAUCET_PRIVATE_KEY ?? process.env.RELAYER_PRIVATE_KEY ?? generatePrivateKey()) as Hex,
);
const faucetKey = process.env.GAS_FAUCET_PRIVATE_KEY as Hex | undefined;
if (fresh) {
  account = privateKeyToAccount(generatePrivateKey());
  log(`fresh relayer wallet ${account.address}`);
}
const rpc = creditcoinTestnet.rpcUrls.default.http[0];
const wallet = createWalletClient({ account, chain: creditcoinTestnet, transport: http(rpc) });

if (send && fresh) {
  if (!faucetKey) throw new Error("--fresh --send needs GAS_FAUCET_PRIVATE_KEY to fund the new wallet");
  const faucet = createWalletClient({
    account: privateKeyToAccount(faucetKey),
    chain: creditcoinTestnet,
    transport: http(rpc),
  });
  const drip = parseEther("0.05");
  const hash = await faucet.sendTransaction({ to: account.address, value: drip });
  await client.waitForTransactionReceipt({ hash });
  log(`  funded with ${formatEther(drip)} tCTC from the gas faucet (${hash})`);
}

for (const [i, batch] of plan.batches.entries()) {
  if (!batch.final) {
    log(`batch ${i + 1}: not final yet, stopping here`);
    break;
  }
  const hashes = batch.changes.map((c) => c.txHash);
  const t0 = Date.now();
  const proof = await fetchRelayProof(chainKey, hashes);
  const args = toExecuteBatchArgs(proof);
  log(`batch ${i + 1}: proof in ${Date.now() - t0} ms (${proof.members.length} members)`);

  const simulated = await client
    .simulateContract({ account: account.address, address: contract, abi: attestedWorldIdAbi, functionName: "executeBatch", args })
    .then(() => "ok")
    .catch((e: Error) => `reverted: ${e.message.split("\n")[0]}`);
  log(`  eth_call executeBatch: ${simulated}`);
  if (simulated !== "ok") process.exit(1);

  const gas = await client.estimateContractGas({
    account: account.address,
    address: contract,
    abi: attestedWorldIdAbi,
    functionName: "executeBatch",
    args,
  });
  log(`  gas estimate ${gas}`);
  if (!send) continue;

  const hash = await wallet.writeContract({
    address: contract,
    abi: attestedWorldIdAbi,
    functionName: "executeBatch",
    args,
    gas: (gas * 13n) / 10n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const relayed = receipt.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: attestedWorldIdAbi, data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .filter((e) => e?.eventName === "RootRelayed");
  log(`  ${receipt.status} ${creditcoinTestnet.blockExplorers.default.url}/tx/${hash} gasUsed ${receipt.gasUsed} roots ${relayed.length}`);

  const line = {
    kind: "self-relay",
    at: new Date().toISOString(),
    chainKey,
    contract,
    relayer: account.address,
    freshWallet: fresh,
    cc3TxHash: hash,
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    sourceTxHashes: hashes,
    postRoots: batch.changes.map((c) => `0x${c.postRoot.toString(16).padStart(64, "0")}`),
    roots: relayed.length,
  };
  appendFileSync(evidencePath, `${JSON.stringify(line)}\n`);
  log(`  evidence → ${evidencePath}`);
}
