// End-to-end credit loop on CC3 with the registered human wallet: faucet → deposit (lender) → openLine → borrow → repay.
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { readFileSync } from "node:fs";
const root = new URL("../../", import.meta.url).pathname;
const secrets = Object.fromEntries(readFileSync(root + ".secrets.env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const dep = JSON.parse(readFileSync(root + "deployments/cc3-testnet.json", "utf8"));
const provider = new JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");
const w = new Wallet(secrets.CREDITCOIN_WALLET_PRIVATE_KEY, provider);
const husd = new Contract(dep.contracts.HUSD, ["function faucet()", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], w);
const cl = new Contract(dep.contracts.CreditLine, [
  "function deposit(uint256) returns (uint256)", "function openLine()", "function borrow(uint256)", "function repay(uint256)",
  "function lineOf(uint256) view returns (tuple(uint256 limit,uint256 principal,uint64 dueAt,uint64 openedAt,uint32 loansRepaid,uint32 loansLate,bool frozen))",
  "function availableCredit(uint256) view returns (uint256)", "function totalAssets() view returns (uint256)", "function totalBorrowed() view returns (uint256)", "function sharesOf(address) view returns (uint256)"], w);
const reg = new Contract(dep.contracts.HumanRegistry, ["function humanOf(address) view returns (uint256)"], provider);
const human = await reg.humanOf(w.address); console.log("human:", "0x" + human.toString(16));
const step = async (name: string, f: () => Promise<any>) => { const tx = await f(); const rc = await tx.wait(); console.log(`${name}: ${tx.hash} status=${rc.status} gas=${rc.gasUsed}`); return rc; };
console.log("hUSD before:", (await husd.balanceOf(w.address)).toString());
await step("faucet", () => husd.faucet());
console.log("hUSD after faucet:", (await husd.balanceOf(w.address)).toString());
await step("approve", () => husd.approve(dep.contracts.CreditLine, 10n ** 30n));
await step("deposit 60 hUSD (lender)", () => cl.deposit(60_000_000n));
console.log("pool totalAssets:", (await cl.totalAssets()).toString(), "shares:", (await cl.sharesOf(w.address)).toString());
await step("openLine", () => cl.openLine());
let line = await cl.lineOf(human); console.log("line:", { limit: line.limit.toString(), principal: line.principal.toString(), dueAt: Number(line.dueAt) });
await step("borrow 20 hUSD", () => cl.borrow(20_000_000n));
line = await cl.lineOf(human); console.log("after borrow:", { limit: line.limit.toString(), principal: line.principal.toString(), dueAt: Number(line.dueAt), available: (await cl.availableCredit(human)).toString(), totalBorrowed: (await cl.totalBorrowed()).toString() });
await step("repay 20.2 hUSD (principal + 1% fee)", () => cl.repay(20_200_000n));
line = await cl.lineOf(human); console.log("after repay:", { limit: line.limit.toString(), principal: line.principal.toString(), loansRepaid: Number(line.loansRepaid), totalAssets: (await cl.totalAssets()).toString() });
