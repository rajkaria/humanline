// End-to-end: real World ID (staging, simulator) proof → HumanRegistry.register on Creditcoin CC3.
// Usage: bun run scripts/e2e-worldid.ts [--env staging|production]
import { signRequest } from "@worldcoin/idkit-core/signing";
import { IDKit, orbLegacy } from "@worldcoin/idkit-core";
import { Contract, JsonRpcProvider, Wallet, AbiCoder } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const secrets = Object.fromEntries(readFileSync(root + ".secrets.env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const env = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : "staging";
const APP_ID = secrets.WORLD_APP_ID, RP_ID = secrets.WORLD_RP_ID, ACTION = "humanline-register";
const dep = JSON.parse(readFileSync(root + "deployments/cc3-testnet.json", "utf8"));
const provider = new JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");
const wallet = new Wallet(secrets.CREDITCOIN_WALLET_PRIVATE_KEY, provider);
const out = "/private/tmp/claude-501/-Users-rajkaria-Projects-random/e60c8556-3484-4f0c-9093-d2f99257fa6a/scratchpad/e2e-worldid";
console.log("wallet (signal):", wallet.address, "env:", env, "app:", APP_ID);

const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: secrets.WORLD_RP_SIGNER_PRIVATE_KEY, action: ACTION });
const rp_context = { rp_id: RP_ID, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig };
const request = await IDKit.request({ app_id: APP_ID as any, action: ACTION, rp_context, allow_legacy_proofs: true, environment: env }).preset(orbLegacy({ signal: wallet.address }));
writeFileSync(out + "-uri.txt", request.connectorURI);
console.log("requestId:", request.requestId);
console.log("connectorURI written to", out + "-uri.txt");
console.log("URI:", request.connectorURI);
const completion = await request.pollUntilCompletion({ pollInterval: 2000, timeout: 30 * 60_000 });
writeFileSync(out + "-result.json", JSON.stringify(completion, null, 2));
if (!completion.success) { console.log("FAILED:", completion.error, JSON.stringify(request.getDebugReport()).slice(0, 800)); process.exit(1); }
const r: any = completion.result;
console.log("protocol_version:", r.protocol_version, "responses:", r.responses?.length);
const resp = r.responses?.[0] ?? r;
console.log("response keys:", Object.keys(resp));
const merkleRoot = BigInt(resp.merkle_root ?? resp.merkleRoot), nullifier = BigInt(resp.nullifier ?? resp.nullifier_hash);
let proof: bigint[];
if (typeof resp.proof === "string") proof = (AbiCoder.defaultAbiCoder().decode(["uint256[8]"], resp.proof)[0] as bigint[]).map(BigInt);
else proof = (resp.proof as any[]).map((x) => BigInt(x));
console.log("root:", "0x" + merkleRoot.toString(16), "nullifier:", "0x" + nullifier.toString(16), "proof len:", proof.length);

const awid = new Contract(env === "staging" ? dep.contracts.AttestedWorldIDSepolia : dep.contracts.AttestedWorldIDMainnet, ["function isValidRoot(uint256) view returns (bool)", "function latestRoot() view returns (uint256)"], provider);
for (let i = 0; i < 120; i++) { const ok = await awid.isValidRoot(merkleRoot); console.log(new Date().toISOString(), "root relayed on CC3?", ok); if (ok) break; await Bun.sleep(30_000); }
const reg = new Contract(dep.contracts.HumanRegistry, ["function register(uint256 root, uint256 nullifierHash, uint256[8] proof)", "function isHuman(address) view returns (bool)", "function humanOf(address) view returns (uint256)"], wallet);
const tx = await reg.register(merkleRoot, nullifier, proof);
console.log("register tx:", tx.hash); const rc = await tx.wait(); console.log("status:", rc.status, "gas:", rc.gasUsed.toString());
console.log("isHuman:", await reg.isHuman(wallet.address), "humanOf:", (await reg.humanOf(wallet.address)).toString(16));
