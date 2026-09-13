#!/usr/bin/env bun
/**
 * Seed the reproducible (staging-tree) deployment with demo humans, end to end and on chain.
 *
 * Every step is the real product path, nothing is mocked: a World ID Simulator identity proves
 * itself against a Sepolia root Attestcoin relayed, `HumanRegistry.register` verifies the Groth16
 * proof on Creditcoin, and the new human opens a CreditLine v3 line, borrows and repays on time.
 * Each wallet is fresh, funded with gas by the deployer, and recorded in `evidence/seed-demo.jsonl`
 * so nobody mistakes seeded activity for organic users.
 *
 *   bun run scripts/seed-demo.ts human <identity#>     # prints the IDKit URI to paste into the simulator
 *   bun run scripts/seed-demo.ts poll                   # first HumanPoll, every seeded human votes
 *
 * Secrets come from SECRETS_FILE (default ../.secrets.env). Wallet keys are kept in WALLETS_FILE,
 * which must live outside the repository.
 */

import { IDKit, orbLegacy } from "@worldcoin/idkit-core";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  formatUnits,
  http,
  parseAbi,
  parseEther,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { creditcoinTestnet } from "@/lib/chains";

const repoRoot = resolve(import.meta.dir, "..", "..");
const secretsFile = process.env.SECRETS_FILE ?? resolve(repoRoot, ".secrets.env");
const walletsFile = process.env.WALLETS_FILE;
if (!walletsFile || walletsFile.startsWith(repoRoot)) throw new Error("set WALLETS_FILE to a path outside the repository");

const secrets = Object.fromEntries(
  readFileSync(secretsFile, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const dep = JSON.parse(readFileSync(resolve(repoRoot, "deployments", "cc3-testnet.json"), "utf8"));
const C = dep.contracts as Record<string, Hex>;
const EVIDENCE = resolve(repoRoot, "evidence", "seed-demo.jsonl");

const transport = http(creditcoinTestnet.rpcUrls.default.http[0]);
const client = createPublicClient({ chain: creditcoinTestnet, transport });
const deployer = privateKeyToAccount(secrets.CREDITCOIN_WALLET_PRIVATE_KEY as Hex);

const registryAbi = parseAbi([
  "function register(uint256 root, uint256 nullifierHash, uint256[8] proof)",
  "function humanOf(address) view returns (uint256)",
]);
const worldIdAbi = parseAbi(["function isValidRoot(uint256) view returns (bool)"]);
const lineAbi = parseAbi([
  "function openLine()",
  "function borrow(uint256)",
  "function repay(uint256)",
  "function markDefault(uint256 human)",
  "function lineOf(uint256) view returns ((uint256 limit,uint256 principal,uint64 dueAt,uint64 openedAt,uint32 loansRepaid,uint32 loansLate,bool frozen))",
  "function lineOfWallet(address) view returns ((uint256 limit,uint256 principal,uint64 dueAt,uint64 openedAt,uint32 loansRepaid,uint32 loansLate,bool frozen))",
  "error LineFrozen(uint256 human)",
]);
const erc20Abi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function faucet()",
]);
const pollAbi = parseAbi([
  "function createPoll(string question, string[] options, uint64 duration) returns (uint256)",
  "function vote(uint256 pollId, uint256 option)",
  "function pollCount() view returns (uint256)",
]);

type Wallets = Record<string, Hex>;
const wallets: Wallets = existsSync(walletsFile) ? JSON.parse(readFileSync(walletsFile, "utf8")) : {};

function walletFor(identity: string): PrivateKeyAccount {
  if (!wallets[identity]) {
    wallets[identity] = generatePrivateKey();
    writeFileSync(walletsFile!, JSON.stringify(wallets, null, 2), { mode: 0o600 });
  }
  return privateKeyToAccount(wallets[identity]!);
}

async function send(account: PrivateKeyAccount, label: string, request: Record<string, unknown>): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: creditcoinTestnet, transport });
  const hash = await wallet.writeContract({ account, chain: creditcoinTestnet, ...request } as never);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`  ${label}: ${hash} ${receipt.status} gas=${receipt.gasUsed}`);
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  return hash;
}

async function fund(account: PrivateKeyAccount): Promise<Hex | null> {
  const balance = await client.getBalance({ address: account.address });
  if (balance >= parseEther("0.2")) return null;
  const wallet = createWalletClient({ account: deployer, chain: creditcoinTestnet, transport });
  const hash = await wallet.sendTransaction({ account: deployer, chain: creditcoinTestnet, to: account.address, value: parseEther("0.5") });
  await client.waitForTransactionReceipt({ hash });
  console.log(`  gas 0.5 tCTC from deployer: ${hash}`);
  return hash;
}

async function proveAndRegister(identity: string, account: PrivateKeyAccount): Promise<{ human: bigint; tx: Hex | null }> {
  const existing = await client.readContract({ address: C.HumanRegistry, abi: registryAbi, functionName: "humanOf", args: [account.address] });
  if (existing !== 0n) return { human: existing, tx: null };

  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: secrets.WORLD_RP_SIGNER_PRIVATE_KEY!, action: dep.config.action });
  const request = await IDKit.request({
    app_id: secrets.WORLD_APP_ID as `app_${string}`,
    action: dep.config.action,
    rp_context: { rp_id: secrets.WORLD_RP_ID!, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig },
    allow_legacy_proofs: true,
    environment: "staging",
  }).preset(orbLegacy({ signal: account.address }));
  console.log(`  paste into the simulator (identity #${identity}):\nURI ${request.connectorURI}`);
  const completion = await request.pollUntilCompletion({ pollInterval: 2_000, timeout: 20 * 60_000 });
  if (!completion.success) throw new Error(`World ID request failed: ${JSON.stringify(completion.error)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = completion.result;
  const response = result.responses?.[0] ?? result;
  const root = BigInt(response.merkle_root);
  const nullifier = BigInt(response.nullifier ?? response.nullifier_hash);
  const proof =
    typeof response.proof === "string"
      ? [...decodeAbiParameters([{ type: "uint256[8]" }], response.proof as Hex)[0]]
      : (response.proof as string[]).map((x) => BigInt(x));
  console.log(`  proof for root 0x${root.toString(16).slice(0, 12)}…, nullifier 0x${nullifier.toString(16).slice(0, 12)}…`);

  for (let i = 0; ; i++) {
    if (await client.readContract({ address: C.AttestedWorldIDSepolia, abi: worldIdAbi, functionName: "isValidRoot", args: [root] })) break;
    if (i >= 120) throw new Error("root never reached Creditcoin");
    if (i % 4 === 0) console.log(`  waiting for the root to be relayed…`);
    await Bun.sleep(30_000);
  }
  const tx = await send(account, "register (Groth16 on CC3)", {
    address: C.HumanRegistry,
    abi: registryAbi,
    functionName: "register",
    args: [root, nullifier, proof as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]],
  });
  return { human: nullifier, tx };
}

async function creditLoop(
  account: PrivateKeyAccount,
  human: bigint,
): Promise<{ txs: Record<string, Hex>; limitBefore: string; principal: string; limitAfter: string }> {
  const txs: Record<string, Hex> = {};
  let line = await client.readContract({ address: C.CreditLine, abi: lineAbi, functionName: "lineOf", args: [human] });
  if (line.openedAt === 0n) txs.openLine = await send(account, "openLine", { address: C.CreditLine, abi: lineAbi, functionName: "openLine" });
  line = await client.readContract({ address: C.CreditLine, abi: lineAbi, functionName: "lineOf", args: [human] });
  const limitBefore = line.limit;
  if (line.principal === 0n) {
    const amount = (line.limit * 4n) / 5n; // 80% of the limit
    txs.borrow = await send(account, `borrow ${formatUnits(amount, 6)} hUSD`, { address: C.CreditLine, abi: lineAbi, functionName: "borrow", args: [amount] });
    line = await client.readContract({ address: C.CreditLine, abi: lineAbi, functionName: "lineOf", args: [human] });
  }
  const balance = await client.readContract({ address: C.HUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (balance < line.principal) {
    // The 1% term fee comes from the borrower's own funds: the test stablecoin's public faucet.
    txs.feeFaucet = await send(account, "hUSD faucet for the 1% fee", { address: C.HUSD, abi: erc20Abi, functionName: "faucet" });
  }
  const principal = line.principal;
  txs.approve = await send(account, "approve", { address: C.HUSD, abi: erc20Abi, functionName: "approve", args: [C.CreditLine, line.principal] });
  txs.repay = await send(account, `repay ${formatUnits(line.principal, 6)} hUSD on time`, { address: C.CreditLine, abi: lineAbi, functionName: "repay", args: [line.principal] });
  line = await client.readContract({ address: C.CreditLine, abi: lineAbi, functionName: "lineOf", args: [human] });
  console.log(`  line: limit ${formatUnits(line.limit, 6)} hUSD, loans repaid ${line.loansRepaid}`);
  return { txs, limitBefore: String(limitBefore), principal: String(principal), limitAfter: String(line.limit) };
}

const [command, arg] = process.argv.slice(2);
if (command === "human" && arg) {
  const account = walletFor(arg);
  console.log(`identity #${arg} → wallet ${account.address}`);
  const gasTx = await fund(account);
  const { human, tx } = await proveAndRegister(arg, account);
  const { txs, ...limits } = await creditLoop(account, human);
  appendFileSync(
    EVIDENCE,
    JSON.stringify({
      kind: "seed-demo-human",
      at: new Date().toISOString(),
      profile: dep.profile,
      simulatorIdentity: Number(arg),
      wallet: account.address,
      human: `0x${human.toString(16).padStart(64, "0")}`,
      ...limits,
      txs: { gas: gasTx, register: tx, ...txs },
    }) + "\n",
  );
} else if (command === "default" && arg) {
  // A default follows the person: borrow, miss the term and the grace period, get marked in
  // default, then come back from a brand-new wallet with the same World ID and find the line frozen.
  const first = walletFor(arg);
  console.log(`identity #${arg} → wallet ${first.address}`);
  const txs: Record<string, Hex | null> = { gas: await fund(first) };
  const { human, tx } = await proveAndRegister(arg, first);
  txs.register = tx;
  let line = await client.readContract({ address: C.CreditLine, abi: lineAbi, functionName: "lineOf", args: [human] });
  if (line.openedAt === 0n) txs.openLine = await send(first, "openLine", { address: C.CreditLine, abi: lineAbi, functionName: "openLine" });
  line = await client.readContract({ address: C.CreditLine, abi: lineAbi, functionName: "lineOf", args: [human] });
  if (!line.frozen && line.principal === 0n) {
    // Principal plus the term fee must fit the limit, so draw the largest amount that does.
    const amount = (line.limit * 10_000n) / (10_000n + BigInt(dep.config.feeBps));
    txs.borrow = await send(first, `borrow ${formatUnits(amount, 6)} hUSD and never repay`, {
      address: C.CreditLine,
      abi: lineAbi,
      functionName: "borrow",
      args: [amount],
    });
    line = await client.readContract({ address: C.CreditLine, abi: lineAbi, functionName: "lineOf", args: [human] });
  }
  if (!line.frozen) {
    const deadline = Number(line.dueAt) + Number(dep.config.graceSeconds);
    for (;;) {
      const block = await client.getBlock();
      if (Number(block.timestamp) > deadline) break;
      console.log(`  due ${new Date(Number(line.dueAt) * 1000).toISOString()}, grace ends in ${deadline - Number(block.timestamp)} s`);
      await Bun.sleep(Math.min(60_000, (deadline - Number(block.timestamp) + 15) * 1000));
    }
    // Anyone can call markDefault; the deployer does, from a wallet unrelated to the borrower.
    txs.markDefault = await send(deployer, "markDefault (called by a stranger)", { address: C.CreditLine, abi: lineAbi, functionName: "markDefault", args: [human] });
  }

  const second = walletFor(`${arg}b`);
  console.log(`same person, new wallet ${second.address}`);
  txs.gasNewWallet = await fund(second);
  const rebind = await proveAndRegister(arg, second);
  if (rebind.human !== human) throw new Error("the simulator produced a different human; select the same identity");
  txs.registerNewWallet = rebind.tx;
  const inherited = await client.readContract({ address: C.CreditLine, abi: lineAbi, functionName: "lineOfWallet", args: [second.address] });
  let borrowRefusal = "";
  try {
    await client.simulateContract({ account: second, address: C.CreditLine, abi: lineAbi, functionName: "borrow", args: [1_000_000n] });
    throw new Error("borrow from the new wallet was not refused");
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = (error as any)?.cause?.data as { errorName?: string; args?: readonly unknown[] } | undefined;
    borrowRefusal = decoded?.errorName
      ? `${decoded.errorName}(${(decoded.args ?? []).map((a) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a))).join(",")})`
      : error instanceof Error
        ? error.message.slice(0, 120)
        : String(error);
  }
  console.log(`  new wallet inherits frozen=${inherited.frozen}; borrow refused: ${borrowRefusal}`);
  if (!inherited.frozen) throw new Error("the new wallet's line is not frozen");
  appendFileSync(
    EVIDENCE,
    JSON.stringify({
      kind: "seed-demo-default",
      at: new Date().toISOString(),
      profile: dep.profile,
      human: `0x${human.toString(16).padStart(64, "0")}`,
      firstWallet: first.address,
      newWallet: second.address,
      frozenOnNewWallet: inherited.frozen,
      borrowFromNewWallet: borrowRefusal,
      txs: Object.fromEntries(Object.entries(txs).filter(([, v]) => v)),
    }) + "\n",
  );
} else if (command === "rebind-deployer") {
  // Bind a simulator identity back to the deployer wallet (the wallet in evidence/e2e-worldid-staging.md).
  const { human, tx } = await proveAndRegister("deployer", deployer);
  console.log(`  deployer is human 0x${human.toString(16).slice(0, 12)}…, register ${tx ?? "(already bound)"}`);
} else if (command === "link" && arg) {
  // HumanLinks, live: a brand-new Ethereum key signs the EIP-712 Link naming this human and their
  // Creditcoin wallet, and the Creditcoin wallet submits it. The same signature on Sepolia or
  // mainnet is what lets CreditHistory and EthRepay credit that wallet's activity to the human.
  const account = walletFor(arg);
  const human = await client.readContract({ address: C.HumanRegistry, abi: registryAbi, functionName: "humanOf", args: [account.address] });
  if (human === 0n) throw new Error(`seed human ${arg} is not registered`);
  const ethereum = walletFor(`eth-${arg}`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await ethereum.signTypedData({
    domain: { name: "Humanline HumanLinks", version: "1", chainId: creditcoinTestnet.id, verifyingContract: C.HumanLinks },
    types: { Link: [{ name: "human", type: "uint256" }, { name: "creditcoinWallet", type: "address" }, { name: "wallet", type: "address" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Link",
    message: { human, creditcoinWallet: account.address, wallet: ethereum.address, deadline },
  });
  const linksAbi = parseAbi([
    "function linkBySignature(address wallet, uint256 deadline, bytes signature)",
    "function humanOfWallet(address) view returns (uint256)",
    "function linkCount(uint256) view returns (uint256)",
  ]);
  const tx = await send(account, `linkBySignature ${ethereum.address}`, { address: C.HumanLinks, abi: linksAbi, functionName: "linkBySignature", args: [ethereum.address, deadline, signature] });
  const linkedTo = await client.readContract({ address: C.HumanLinks, abi: linksAbi, functionName: "humanOfWallet", args: [ethereum.address] });
  const count = await client.readContract({ address: C.HumanLinks, abi: linksAbi, functionName: "linkCount", args: [human] });
  console.log(`  humanOfWallet = ${linkedTo === human ? "this human" : linkedTo}; links ${count}`);
  appendFileSync(
    EVIDENCE,
    JSON.stringify({ kind: "seed-demo-link", at: new Date().toISOString(), profile: dep.profile, human: `0x${human.toString(16).padStart(64, "0")}`, creditcoinWallet: account.address, linkedWallet: ethereum.address, method: "signature", tx, linkCount: Number(count) }) + "\n",
  );
} else if (command === "aave-repay") {
  // Repay the linked wallet's Aave V3 Sepolia USDC debt in full, once CreditHistory's minimum gap
  // (MIN_GAP_BLOCKS source blocks after the proven borrow) has passed. Then run `prove repay`.
  const [, borrowBlockRaw] = process.argv.slice(2);
  const { createPublicClient: pub, createWalletClient: wal, http: h, maxUint256 } = await import("viem");
  const { sepolia } = await import("viem/chains");
  const eth = walletFor("eth-2");
  const sep = pub({ chain: sepolia, transport: h("https://ethereum-sepolia-rpc.publicnode.com") });
  const sepWallet = wal({ account: eth, chain: sepolia, transport: h("https://ethereum-sepolia-rpc.publicnode.com") });
  const POOL = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951" as const;
  const AAVE_USDC = "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8" as const;
  const FAUCET = "0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D" as const;
  const minGap = BigInt(dep.config.crossChain.minGapBlocks);
  const earliest = BigInt(borrowBlockRaw ?? "0") + minGap;
  const head = await sep.getBlockNumber();
  if (head < earliest) throw new Error(`too soon: Sepolia head ${head}, the repay must land at or after block ${earliest} (${Number(earliest - head) * 12}s)`);
  const sendSep = async (label: string, request: Record<string, unknown>) => {
    const hash = await sepWallet.writeContract({ account: eth, chain: sepolia, ...request } as never);
    const receipt = await sep.waitForTransactionReceipt({ hash });
    console.log(`  ${label}: ${hash} ${receipt.status} block ${receipt.blockNumber}`);
    if (receipt.status !== "success") throw new Error(`${label} reverted`);
    return hash;
  };
  const erc = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
  // One extra USDC from Aave's public testnet faucet covers the interest accrued since the borrow.
  await sendSep("Aave faucet: 1 USDC for interest", { address: FAUCET, abi: parseAbi(["function mint(address token, address to, uint256 amount) returns (uint256)"]), functionName: "mint", args: [AAVE_USDC, eth.address, 1_000_000n] });
  await sendSep("approve the Aave pool", { address: AAVE_USDC, abi: erc, functionName: "approve", args: [POOL, maxUint256] });
  const repayTx = await sendSep("Aave repay (full variable debt)", {
    address: POOL,
    abi: parseAbi(["function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)"]),
    functionName: "repay",
    args: [AAVE_USDC, maxUint256, 2n, eth.address],
  });
  console.log(`next: bun run scripts/seed-demo.ts prove repay ${repayTx} <borrowId from the seed-demo-borrow row>`);
} else if (command === "prove" && arg) {
  // Cross-chain, live: an Attestcoin proof of a Sepolia transaction the linked wallet sent, verified
  // by the Creditcoin contract that consumes it. `arg` is ethrepay | borrow | repay; then the tx hash
  // (and the borrowId for repay). Waits until the transaction is attested and past finality.
  const [, , txHash, borrowId] = process.argv.slice(2) as [string, string, Hex, Hex | undefined];
  const account = walletFor("2");
  const { PROOF_BUILDER_URL } = await import("@/lib/chains");
  const { sourceProofFromJson, findLogIndex, TRANSFER_TOPIC, BORROW_TOPIC, REPAY_TOPIC } = await import("@/lib/crosschain/core");
  const { ethRepayAbi, creditHistoryAbi } = await import("@/lib/abi");
  const topic = arg === "ethrepay" ? TRANSFER_TOPIC : arg === "borrow" ? BORROW_TOPIC : REPAY_TOPIC;
  const target =
    arg === "ethrepay"
      ? { address: C.EthRepay, abi: ethRepayAbi, functionName: "creditRepayment" }
      : { address: C.CreditHistory, abi: creditHistoryAbi, functionName: arg === "borrow" ? "proveBorrow" : "proveRepay" };

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${PROOF_BUILDER_URL}/api/v1/proof-by-tx/1/${txHash}`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (response?.ok) {
      const proof = sourceProofFromJson(await response.json(), txHash);
      const logIndex = findLogIndex(proof.encodedTransaction, (log) => log.topics[0]?.toLowerCase() === topic.toLowerCase());
      if (logIndex < 0) throw new Error(`no ${arg} log in ${txHash}`);
      const args = arg === "repay" ? [proof, BigInt(logIndex), borrowId!] : [proof, BigInt(logIndex)];
      try {
        await client.simulateContract({ account, ...target, args } as never);
        const tx = await send(account, `${target.functionName} (Attestcoin proof of Sepolia ${txHash.slice(0, 10)}…, log ${logIndex})`, { ...target, args });
        const receipt = await client.getTransactionReceipt({ hash: tx });
        appendFileSync(
          EVIDENCE,
          JSON.stringify({
            kind: `seed-demo-${arg}`,
            at: new Date().toISOString(),
            profile: dep.profile,
            human: `0x${(await client.readContract({ address: C.HumanRegistry, abi: registryAbi, functionName: "humanOf", args: [account.address] })).toString(16).padStart(64, "0")}`,
            sepoliaTx: txHash,
            sourceBlock: Number(proof.blockHeight),
            logIndex,
            creditcoinTx: tx,
            gasUsed: Number(receipt.gasUsed),
            events: receipt.logs.filter((l) => l.address.toLowerCase() === target.address.toLowerCase()).map((l) => ({ topic0: l.topics[0], data: l.data, topics: l.topics.slice(1) })),
          }) + "\n",
        );
        break;
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reason = (error as any)?.cause?.data?.errorName ?? (error instanceof Error ? error.message.split("\n")[0] : String(error));
        if (attempt % 3 === 0) console.log(`  not yet: ${reason}`);
        if (!/NotFinal|attest|Continuity|checkpoint/i.test(String(reason)) && attempt > 30) throw error;
      }
    } else if (attempt % 3 === 0) {
      console.log(`  proof builder has no proof yet (HTTP ${response?.status ?? "timeout"})`);
    }
    await Bun.sleep(60_000);
  }
} else if (command === "poll") {
  const humans = Object.keys(wallets).sort();
  if (humans.length === 0) throw new Error("seed humans first");
  const creator = walletFor(humans[0]!);
  const pollId = await client.readContract({ address: C.HumanPoll, abi: pollAbi, functionName: "pollCount" });
  const createTx = await send(creator, "createPoll", {
    address: C.HumanPoll,
    abi: pollAbi,
    functionName: "createPoll",
    args: [
      "Which should Humanline build next?",
      ["Repay from mobile money", "Lender-controlled cure path for defaults", "More source chains for credit history"],
      BigInt(30 * 24 * 3600),
    ],
  });
  const votes: Record<string, Hex> = {};
  for (const [i, id] of humans.entries()) {
    votes[id] = await send(walletFor(id), `vote from identity #${id}`, { address: C.HumanPoll, abi: pollAbi, functionName: "vote", args: [pollId, BigInt(i % 3)] });
  }
  appendFileSync(EVIDENCE, JSON.stringify({ kind: "seed-demo-poll", at: new Date().toISOString(), profile: dep.profile, pollId: Number(pollId), createTx, votes }) + "\n");
} else {
  console.log("usage: seed-demo.ts human <identity#> | poll");
  process.exit(1);
}
