#!/usr/bin/env bun
/**
 * Credit loop against CreditLine v2 on CC3, showing the security budget in action:
 * read the live cap (AttestorStash 0x0FD4 through `securityBudget`), open a line,
 * borrow (the draw re-reads the cap on-chain), repay, and print every tx.
 *
 *   bun --env-file=../.secrets.env run scripts/e2e-credit-v2.ts [--profile demo|production]
 *
 * Needs CREDITCOIN_WALLET_PRIVATE_KEY for a wallet already registered as a human in that
 * profile's HumanRegistry (the demo deployer is, from the World ID staging e2e).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { creditcoinTestnet } from "@/lib/chains";

const profile = process.argv.includes("--profile") ? process.argv[process.argv.indexOf("--profile") + 1] : "demo";
const file = profile === "production" ? "cc3-testnet.production.json" : "cc3-testnet.json";
const dep = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "..", "deployments", file), "utf8"));
const key = process.env.CREDITCOIN_WALLET_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("CREDITCOIN_WALLET_PRIVATE_KEY is not set");

const account = privateKeyToAccount(key);
const rpc = http(creditcoinTestnet.rpcUrls.default.http[0]);
const client = createPublicClient({ chain: creditcoinTestnet, transport: rpc });
const wallet = createWalletClient({ account, chain: creditcoinTestnet, transport: rpc });

const line = parseAbi([
  "function securityBudget() view returns (uint32 attestors, uint128 minBond, uint256 cap)",
  "function totalBorrowed() view returns (uint256)",
  "function openLine()",
  "function borrow(uint256)",
  "function repay(uint256)",
  "function withdraw(uint256) returns (uint256)",
  "function sharesOf(address) view returns (uint256)",
  "function lineOf(uint256) view returns ((uint256 limit,uint256 principal,uint64 dueAt,uint64 openedAt,uint32 loansRepaid,uint32 loansLate,bool frozen))",
]);
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function faucet()"]);
const registry = parseAbi(["function humanOf(address) view returns (uint256)"]);

const CL = dep.contracts.CreditLine as Hex;
const HUSD = dep.contracts.HUSD as Hex;
const usd = (v: bigint) => `${formatUnits(v, 6)} hUSD`;

async function send(label: string, request: Parameters<typeof wallet.writeContract>[0]) {
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`${label}: ${hash} status=${receipt.status} gas=${receipt.gasUsed}`);
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
}

console.log(`profile ${profile}  CreditLine v2 ${CL}  wallet ${account.address}`);
const human = await client.readContract({ address: dep.contracts.HumanRegistry, abi: registry, functionName: "humanOf", args: [account.address] });
if (human === 0n) throw new Error("this wallet is not registered as a human in this profile");
console.log(`human 0x${human.toString(16).slice(0, 16)}…`);

const [attestors, minBond, cap] = await client.readContract({ address: CL, abi: line, functionName: "securityBudget" });
console.log(`security budget (live 0x0FD4): ${attestors} attestors × ${formatUnits(minBond, 18)} CTC = cap ${usd(cap)}; outstanding ${usd(await client.readContract({ address: CL, abi: line, functionName: "totalBorrowed" }))}`);

const current = await client.readContract({ address: CL, abi: line, functionName: "lineOf", args: [human] });
if (current.openedAt === 0n) await send("openLine", { address: CL, abi: line, functionName: "openLine", account, chain: creditcoinTestnet });

let balance = await client.readContract({ address: HUSD, abi: erc20, functionName: "balanceOf", args: [account.address] });
if (balance < 21_000_000n) {
  try {
    await send("hUSD faucet (for the repay)", { address: HUSD, abi: erc20, functionName: "faucet", account, chain: creditcoinTestnet });
  } catch {
    console.log("faucet on cooldown; repaying from borrowed funds plus pool shares");
  }
  balance = await client.readContract({ address: HUSD, abi: erc20, functionName: "balanceOf", args: [account.address] });
}

await send("borrow 20 hUSD (re-reads the cap on-chain)", { address: CL, abi: line, functionName: "borrow", args: [20_000_000n], account, chain: creditcoinTestnet });
let after = await client.readContract({ address: CL, abi: line, functionName: "lineOf", args: [human] });
console.log(`after borrow: principal ${usd(after.principal)} of limit ${usd(after.limit)}; pool outstanding ${usd(await client.readContract({ address: CL, abi: line, functionName: "totalBorrowed" }))} of cap ${usd(cap)}`);

// The repay includes the 1% term fee, so a wallet holding only the borrowed amount is short.
// Cover the shortfall from this wallet's own pool shares rather than leaving the line open.
balance = await client.readContract({ address: HUSD, abi: erc20, functionName: "balanceOf", args: [account.address] });
if (balance < after.principal) {
  const shortfall = after.principal - balance;
  const shares = await client.readContract({ address: CL, abi: line, functionName: "sharesOf", args: [account.address] });
  // Shares are priced at roughly 1,000 per base unit here; take a generous margin.
  const take = shortfall * 2_000n > shares ? shares : shortfall * 2_000n;
  if (take === 0n) throw new Error(`need ${usd(shortfall)} more hUSD to repay and hold no pool shares`);
  await send(`withdraw pool shares to cover the ${usd(shortfall)} fee`, { address: CL, abi: line, functionName: "withdraw", args: [take], account, chain: creditcoinTestnet });
}
await send("approve", { address: HUSD, abi: erc20, functionName: "approve", args: [CL, after.principal], account, chain: creditcoinTestnet });
await send(`repay ${usd(after.principal)}`, { address: CL, abi: line, functionName: "repay", args: [after.principal], account, chain: creditcoinTestnet });
after = await client.readContract({ address: CL, abi: line, functionName: "lineOf", args: [human] });
console.log(`after repay: principal ${usd(after.principal)}, limit ${usd(after.limit)}, loans repaid ${after.loansRepaid}`);
