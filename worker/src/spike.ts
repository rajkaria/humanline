// Spike: prove a real World ID registerIdentities tx from Ethereum mainnet on Creditcoin (read-only verify).
import { JsonRpcProvider } from "ethers";
import { chainInfo, blockProver, proofProvider } from "@gluwa/usc-sdk";

const CC3 = "https://rpc.cc3-testnet.creditcoin.network";
const PROVER = "https://prover.cc3-testnet.creditcoin.network";
const [txHash = "0x81ece3110019bf17255ee88a9728ce4327319d7622e528645e8253cf36fdc7e3", chainKeyArg = "3"] = process.argv.slice(2);
const chainKey = Number(chainKeyArg);

const cc = new JsonRpcProvider(CC3);
const info = new chainInfo.PrecompileChainInfoProvider(cc);
const chains = await info.getSupportedChains();
console.log("supported chains:", JSON.stringify(chains, (_, v) => typeof v === "bigint" ? v.toString() : v));

const pb = new proofProvider.service.ProofBuilder(chainKey, PROVER, 60_000);
const t0 = Date.now();
const res = await pb.getProof(txHash);
console.log("getProof ms:", Date.now() - t0, "success:", res.success, res.success ? "" : res.error);
if (!res.success) process.exit(1);
const d = res.data!;
console.log("headerNumber", d.headerNumber, "txBytes len", (d.txBytes.length - 2) / 2, "roots", d.continuityProof.roots.length, "siblings", d.merkleProof.siblings?.length ?? Object.keys(d.merkleProof).length, "cached", d.cached);
const prover = new blockProver.PrecompileBlockProver(cc);
const idx = await prover.computeTransactionIndex(d.merkleProof);
const t1 = Date.now();
const ok = await prover.verifySingle(d.chainKey, d.headerNumber, d.txBytes, d.merkleProof, d.continuityProof);
console.log("verifySingle:", ok, "ms:", Date.now() - t1, "txIndex:", idx);
const out = `../contracts/test/fixtures/${chainKey === 3 ? "mainnet" : "sepolia"}-${txHash.slice(0, 10)}.json`;
await Bun.write(out, JSON.stringify({ txHash, ...d }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
console.log("fixture written", out);
