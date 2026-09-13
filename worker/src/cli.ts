#!/usr/bin/env bun
// Humanline relay CLI.
//   bun run src/cli.ts check
//   bun run src/cli.ts bootstrap --source sepolia [--tx 0x...]
//   bun run src/cli.ts prove 0x... --source mainnet [--dry-run]
//   bun run src/cli.ts relay --source all [--once] [--from N] [--dry-run]
//   bun run src/cli.ts status
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { formatEther, toUtf8String } from "ethers";
import { loadAttestedWorldIdAbi } from "./abi";
import {
  ATTESTOR_STASH_PRECOMPILE,
  BLOCK_PROVER_PRECOMPILE,
  CC3_EXPLORER,
  CHAIN_INFO_PRECOMPILE,
  POLL_INTERVAL_MS,
  REPO_ROOT,
  SOURCES,
  SOURCE_NAMES,
  type SourceConfig,
  type SourceName,
  attestedWorldIdAddress,
  cc3RpcUrl,
  dbPath,
  deploymentTxHash,
  deploymentsPath,
  evidencePath,
  loadDeployments,
  loadEnvFiles,
  parseSourceArg,
  privateKey,
  proverUrl,
  requireDeployments,
  sourceRpcUrl,
} from "./config";
import {
  attestedWorldId,
  bn128Sanity,
  cc3Provider,
  blockProverClient,
  cc3Signer,
  chainInfoProvider,
  computeQueryId,
  computeTxIndex,
  getAttestorsCount,
  proofBuilder,
  readRootState,
} from "./cc3";
import { inspectLocally, toHex32 } from "./evmv1";
import { fetchProof, singleToBatch, txIndexMatches, type SingleProof } from "./proofs";
import { buildLocalProof, diffProofs, foldContinuity, verifyInclusion } from "./local-proof";
import {
  calldataBytes,
  deriveCursor,
  encodeCalldata,
  finalityDepth,
  isProcessed,
  lastRelayedSourceBlock,
  relaySourceOnce,
  submitBatch,
  verifyReadOnly,
  waitAttested,
  type RelayContext,
} from "./relay";
import { readEvidence } from "./evidence";
import { LogSource, findLatestTreeChanged } from "./sources";
import { RelayStore } from "./store";

const program = new Command();
program
  .name("humanline")
  .description("Relay World ID identity-tree roots from Ethereum to Creditcoin via Attestcoin")
  .option("--env-file <path>", "extra dotenv-style file to load (never printed)")
  .option("--deployments <path>", "deployments JSON (default $DEPLOYMENTS_FILE or ../deployments/cc3-testnet.json)")
  .option("--db <path>", "sqlite path (default worker/data/relay.db)")
  .option("--evidence-file <path>", "evidence JSONL path (default evidence/relay-log.jsonl)");

function globals() {
  return program.opts<{
    envFile?: string;
    deployments?: string;
    db?: string;
    evidenceFile?: string;
  }>();
}

const log = (msg: string) => console.log(msg);
const pad = (s: string, n: number) => s.padEnd(n);

/** ChainInfo returns `chainName` as `bytes`; render it as text when it is UTF-8. */
function decodeChainName(name: string): string {
  if (!name.startsWith("0x")) return name;
  try {
    return toUtf8String(name);
  } catch {
    return name;
  }
}

/** `prove` and `bootstrap` act on exactly one source chain. */
function requireSingleSource(value: string): SourceName {
  const names = parseSourceArg(value);
  if (names.length !== 1) throw new Error("--source must be mainnet or sepolia (not all)");
  return names[0]!;
}

function bootEnv(): void {
  const files = loadEnvFiles(globals().envFile);
  if (files.length > 0) log(`env: loaded ${files.length} file(s) (values not printed)`);
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

program
  .command("check")
  .description("precompiles, supported chains, attestor counts, bn128 sanity, contract state")
  .action(async () => {
    bootEnv();
    const cc3 = cc3Provider();
    log("");
    log("Humanline preflight");
    log("===================");
    log(`CC3 RPC        ${cc3RpcUrl()}`);
    log(`Prover         ${proverUrl()}`);

    const net = await cc3.getNetwork();
    const head = await cc3.getBlockNumber();
    log(`CC3 network    chainId ${net.chainId}, head ${head}`);
    log("");

    // --- precompiles: functional probes (they are native, so `eth_getCode` is empty) ---
    const info = chainInfoProvider(cc3);
    const prover = blockProverClient(cc3);
    log("Precompiles (native: no bytecode, probed by call)");
    const probe = async (label: string, addr: string, fn: () => Promise<string>) => {
      try {
        log(`  ${pad(label, 22)} ${pad(addr.toLowerCase(), 44)} ok — ${await fn()}`);
      } catch (e) {
        log(`  ${pad(label, 22)} ${pad(addr.toLowerCase(), 44)} FAIL — ${(e as Error).message}`);
      }
    };
    await probe("BlockProver 0x0FD2", BLOCK_PROVER_PRECOMPILE, async () => {
      const idx = await prover.computeTransactionIndex({
        root: `0x${"00".repeat(32)}`,
        siblings: [],
      } as never);
      return `calculateTxIndex(empty) = ${idx}`;
    });
    await probe("ChainInfo 0x0FD3", CHAIN_INFO_PRECOMPILE, async () => {
      const cs = await info.getSupportedChains();
      return `get_supported_chains → ${cs.length} chains`;
    });
    await probe("AttestorStash 0x0FD4", ATTESTOR_STASH_PRECOMPILE, async () => {
      const n = await getAttestorsCount(cc3, SOURCES.mainnet.chainKey);
      return `getAttestorsCount(${SOURCES.mainnet.chainKey}) = ${n}`;
    });
    log("");

    // --- supported chains + attested heights + attestor counts ---
    const chains = await info.getSupportedChains();
    log(`Supported chains (${chains.length})`);
    log(
      `  ${pad("chainKey", 9)}${pad("chainId", 10)}${pad("name", 20)}${pad("enc", 5)}${pad("attestedTip", 14)}${pad("genesis", 12)}attestors`,
    );
    for (const c of chains) {
      let tip = "?";
      let genesis = "?";
      let attestors = "?";
      try {
        tip = String((await info.getLatestAttestedHeightAndHash(c.chainKey)).height);
      } catch (e) {
        tip = `err: ${(e as Error).message.slice(0, 24)}`;
      }
      try {
        genesis = String(await info.getAttestationGenesisHeight(c.chainKey));
      } catch {
        genesis = "-";
      }
      try {
        attestors = String(await getAttestorsCount(cc3, c.chainKey));
      } catch (e) {
        attestors = `err: ${(e as Error).message.slice(0, 24)}`;
      }
      const mine = SOURCE_NAMES.find((n) => SOURCES[n].chainKey === c.chainKey);
      log(
        `  ${pad(String(c.chainKey), 9)}${pad(String(c.chainId), 10)}${pad(decodeChainName(c.chainName), 20)}${pad(String(c.chainEncoding), 5)}${pad(tip, 14)}${pad(genesis, 12)}${attestors}${mine ? `   <- humanline ${mine}` : ""}`,
      );
    }
    log("");

    // --- bn128 ---
    const bn = await bn128Sanity(cc3);
    log("bn128 precompiles (Semaphore/Groth16)");
    log(`  0x06 ecAdd     ${bn.add ? "ok" : "FAIL"}`);
    log(`  0x07 ecMul     ${bn.mul ? "ok" : "FAIL"}`);
    log(`  0x08 pairing   ${bn.pairing ? "ok (empty product = 1)" : "FAIL"}`);
    log("");

    // --- wallet ---
    const key = privateKey();
    if (key) {
      const signer = cc3Signer(cc3);
      const bal = await cc3.getBalance(signer.address);
      log("Relayer wallet");
      log(`  address      ${signer.address}`);
      log(`  balance      ${formatEther(bal)} CTC`);
      if (bal === 0n) log("  WARNING: zero balance; fund from the Discord faucet before relaying");
    } else {
      log("Relayer wallet   CREDITCOIN_WALLET_PRIVATE_KEY not set (read-only mode)");
    }
    log("");

    // --- contracts ---
    const abi = loadAttestedWorldIdAbi();
    log(`ABI source       ${abi.origin}${abi.path ? ` (${abi.path})` : ""}`);
    const dep = loadDeployments(globals().deployments);
    if (!dep.ok) {
      log(`Contracts        not deployed yet (${dep.path}: ${dep.reason})`);
      log("                 precompile checks above are the reproducible part right now");
      log("");
      return;
    }
    log(`Deployments      ${dep.path}`);
    for (const name of SOURCE_NAMES) {
      const source = SOURCES[name];
      const addr = attestedWorldIdAddress(dep.data, source);
      if (!addr) {
        log(`  ${pad(name, 9)} ${source.deploymentKey} missing from the deployments file`);
        continue;
      }
      if ((await cc3.getCode(addr)) === "0x") {
        log(`  ${pad(name, 9)} ${addr} — no contract code at this address on CC3`);
        continue;
      }
      try {
        const state = await readRootState(attestedWorldId(addr, cc3));
        log(`  ${pad(name, 9)} ${addr}`);
        log(
          `            latestRoot ${state.bootstrapped ? toHex32(state.latestRoot!) : "(not bootstrapped yet — 0 roots)"}`,
        );
        log(`            rootCount  ${state.rootCount}`);
        log(`            explorer   ${CC3_EXPLORER}/address/${addr}`);
        if (!state.bootstrapped) {
          log(`            run: bun run src/cli.ts bootstrap --source ${name}`);
        }
      } catch (e) {
        log(`  ${pad(name, 9)} ${addr} — read failed: ${(e as Error).message}`);
      }
    }
    log("");
  });

// ---------------------------------------------------------------------------
// prove
// ---------------------------------------------------------------------------

program
  .command("prove")
  .argument("<txHash>", "source-chain transaction hash")
  .requiredOption("-s, --source <source>", "mainnet or sepolia")
  .option("--dry-run", "do everything except sending the transaction", false)
  .option("--no-wait", "do not wait for attestation; fail fast if not attested")
  .description("one-off: wait for attestation, fetch the proof, verify, then execute()")
  .action(async (txHash: string, opts: { source: string; dryRun: boolean; wait: boolean }) => {
    bootEnv();
    const source = SOURCES[requireSingleSource(opts.source)];
    const cc3 = cc3Provider();

    const dep = loadDeployments(globals().deployments);
    const address = dep.ok ? attestedWorldIdAddress(dep.data, source) : undefined;
    if (!address && !opts.dryRun) requireDeployments(globals().deployments);
    if (!address && opts.dryRun) {
      log(`note: contracts not deployed yet (${dep.ok ? "address missing" : dep.reason}); dry run needs no address`);
    }

    const ctx: RelayContext = {
      source,
      cc3,
      signer: opts.dryRun || !privateKey() ? undefined : cc3Signer(cc3),
      contractAddress: address,
      deploymentTxHash: dep.ok ? deploymentTxHash(dep.data, source) : undefined,
      dryRun: opts.dryRun,
      noWait: !opts.wait,
      log,
      evidenceFile: globals().evidenceFile,
    };

    log("");
    log(`prove ${txHash}`);
    log(`source ${source.name} (chainKey ${source.chainKey}, manager ${source.manager})`);

    const builder = proofBuilder(source.chainKey);
    const t0 = Date.now();
    const probe = await fetchProof(builder, txHash);
    log(`getProof ${Date.now() - t0}ms — block ${probe.headerNumber}, txIndex ${probe.txIndex}, cached ${probe.cached}`);

    const att = await waitAttested(ctx, probe.headerNumber, { timeoutMs: opts.wait ? 15 * 60_000 : 1 });
    const depth = await finalityDepth(ctx);
    log(
      `attested tip ${att.attestedTip} — finality (block + ${depth} = ${probe.headerNumber + depth}) ${att.final ? "satisfied" : "NOT YET satisfied"}`,
    );

    log(`txBytes ${calldataBytes(probe.txBytes)} bytes, siblings ${probe.merkleProof.siblings.length}, continuity roots ${probe.continuityProof.roots.length}`);
    log(`txIndex from Merkle path ${computeTxIndex(probe.merkleProof.siblings)} — matches proof: ${txIndexMatches(probe)}`);

    const queryId = computeQueryId(source.chainKey, probe.headerNumber, probe.txIndex);
    log(`queryId ${queryId}`);

    // Local guard replay
    const ins = inspectLocally(probe.txBytes, {
      chainKey: probe.chainKey,
      sourceChainKey: source.chainKey,
      manager: source.manager,
    });
    log("local guard replay (AttestedWorldID steps 1-6):");
    for (const c of ins.checks) log(`  ${c.ok ? "ok  " : "FAIL"} ${pad(c.name, 38)} ${c.detail}`);
    if (ins.call) {
      log(`  calldata: ${ins.call.kind}, humansAdded ${ins.call.humansAdded}${ins.call.startIndex !== undefined ? `, startIndex ${ins.call.startIndex}` : ""}`);
    }
    if (ins.change) {
      log(`  preRoot  ${toHex32(ins.change.preRoot)}`);
      log(`  postRoot ${toHex32(ins.change.postRoot)}  kind ${ins.change.kind}`);
    }

    const batch = singleToBatch(probe);
    const { data, fn } = encodeCalldata(batch);
    log(`${fn} calldata ${calldataBytes(data)} bytes`);

    const verified = await verifyReadOnly(ctx, batch);
    log(`precompile verifySingle: ${verified}`);

    if (address) {
      const c = attestedWorldId(address, cc3);
      try {
        const already = await isProcessed(c, source.chainKey, probe.headerNumber, probe.txIndex);
        log(`processedQueries[queryId]: ${already}`);
        if (already) {
          log("already relayed; nothing to do");
          return;
        }
      } catch (e) {
        log(`processedQueries read failed: ${(e as Error).message}`);
      }
    }

    if (opts.dryRun) {
      log("");
      log("dry run complete — transaction NOT sent");
      log(`  would call ${fn} on ${address ?? "<AttestedWorldID, not deployed yet>"}`);
      log(`  calldata size ${calldataBytes(data)} bytes`);
      log(`  read-only verify: ${verified}`);
      log(`  all local guards pass: ${ins.ok}`);
      log("");
      return;
    }

    const store = new RelayStore(dbPath(globals().db));
    try {
      store.upsertPending(source.name, probe.txHash, probe.headerNumber, probe.txIndex);
      const group = [
        {
          txHash: probe.txHash,
          blockNumber: probe.headerNumber,
          txIndex: probe.txIndex,
          logIndex: 0,
          preRoot: ins.change?.preRoot ?? 0n,
          kind: ins.change?.kind ?? 0,
          postRoot: ins.change?.postRoot ?? 0n,
        },
      ];
      const outcome = await submitBatch(
        { ...ctx, store, signer: cc3Signer(cc3) },
        batch,
        group,
        {},
        "single",
      );
      log("");
      log(JSON.stringify(serializeOutcome(outcome as never), null, 2));
      if (outcome.cc3TxHash) log(`\nexplorer ${CC3_EXPLORER}/tx/${outcome.cc3TxHash}`);
      if (outcome.status === "failed") process.exit(1);
    } finally {
      store.close();
    }
  });

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

program
  .command("bootstrap")
  .requiredOption("-s, --source <source>", "mainnet or sepolia")
  .option("--tx <hash>", "specific TreeChanged transaction to seed from")
  .option("--dry-run", "do everything except sending the transaction", false)
  .description("seed the first root for a source chain")
  .action(async (opts: { source: string; tx?: string; dryRun: boolean }) => {
    bootEnv();
    const source = SOURCES[requireSingleSource(opts.source)];
    const cc3 = cc3Provider();

    const dep = loadDeployments(globals().deployments);
    const address = dep.ok ? attestedWorldIdAddress(dep.data, source) : undefined;
    if (!address && !opts.dryRun) requireDeployments(globals().deployments);

    if (address) {
      const state = await readRootState(attestedWorldId(address, cc3));
      if (state.bootstrapped && state.rootCount > 0n) {
        log(
          `${source.name} already bootstrapped: rootCount ${state.rootCount}, latestRoot ${toHex32(state.latestRoot!)}`,
        );
        log("use `relay` to continue from here");
        return;
      }
      log(`${source.name}: 0 roots so far — seeding the first one`);
    }

    let txHash = opts.tx;
    if (!txHash) {
      log(`searching ${source.name} for the most recent TreeChanged from ${source.manager}…`);
      const found = await findLatestTreeChanged(new LogSource(source), source.manager);
      if (!found) {
        console.error(`no TreeChanged event found on ${source.name} in the recent window`);
        process.exit(1);
      }
      txHash = found.txHash;
      log(`found ${txHash} at block ${found.blockNumber}, postRoot ${toHex32(found.postRoot)}`);
    }

    log("");
    log(`bootstrapping from ${txHash} — handing off to prove`);
    await program.parseAsync(
      [
        "prove",
        txHash,
        "--source",
        source.name,
        ...(opts.dryRun ? ["--dry-run"] : []),
      ],
      { from: "user" },
    );
  });

// ---------------------------------------------------------------------------
// relay
// ---------------------------------------------------------------------------

program
  .command("relay")
  .option("-s, --source <source>", "mainnet, sepolia or all", "all")
  .option("--once", "run a single pass and exit", false)
  .option("--from <block>", "start at this source block (cursor only moves forward)")
  .option("--dry-run", "do everything except sending the transaction", false)
  .option("--interval <ms>", "poll interval in continuous mode", String(POLL_INTERVAL_MS))
  .description("relay TreeChanged roots continuously (default) or once")
  .action(
    async (opts: {
      source: string;
      once: boolean;
      from?: string;
      dryRun: boolean;
      interval: string;
    }) => {
      bootEnv();
      const names = parseSourceArg(opts.source);
      const cc3 = cc3Provider();

      const dep = loadDeployments(globals().deployments);
      if (!dep.ok && !opts.dryRun) requireDeployments(globals().deployments);
      if (!dep.ok) {
        log(`note: contracts not deployed yet (${dep.path}: ${dep.reason}); dry run continues`);
      }

      // Block numbers are per-chain, so a single --from cannot mean anything across sources.
      // Validate before opening anything, so a bad invocation leaves no files behind.
      if (opts.from !== undefined && names.length > 1) {
        throw new Error("--from requires a single --source (block numbers are per-chain)");
      }
      const fromFlag = opts.from === undefined ? undefined : Number(opts.from);
      if (fromFlag !== undefined && !Number.isInteger(fromFlag)) {
        throw new Error(`--from must be a block number, got "${opts.from}"`);
      }

      const store = new RelayStore(dbPath(globals().db));
      const signer = opts.dryRun || !privateKey() ? undefined : cc3Signer(cc3);
      const interval = Number(opts.interval);

      const contexts: RelayContext[] = names.map((n) => {
        const source: SourceConfig = SOURCES[n];
        const contractAddress = dep.ok ? attestedWorldIdAddress(dep.data, source) : undefined;
        // A redeployed AttestedWorldID has relayed nothing; a cursor carried over from
        // the previous instance would skip every root it still needs.
        if (store.bindContract(source.name, contractAddress)) {
          log(`${source.name}: AttestedWorldID changed to ${contractAddress} — relay state reset`);
        }
        return {
          source,
          cc3,
          signer,
          contractAddress,
          deploymentTxHash: dep.ok ? deploymentTxHash(dep.data, source) : undefined,
          store,
          dryRun: opts.dryRun,
          log,
          evidenceFile: globals().evidenceFile,
        };
      });

      let stopping = false;
      process.on("SIGINT", () => {
        log("\nstopping after this pass…");
        stopping = true;
      });

      try {
        for (;;) {
          for (const ctx of contexts) {
            try {
              const outcomes = await relaySourceOnce(ctx, { fromFlag });
              for (const o of outcomes) {
                log(
                  `  [${ctx.source.name}] ${o.status} ${o.mode} ${o.txHashes.length} tx ${o.blockRange[0]}..${o.blockRange[1]} ${o.calldataBytes}B${o.cc3TxHash ? ` ${CC3_EXPLORER}/tx/${o.cc3TxHash}` : ""}${o.error ? ` — ${o.error}` : ""}`,
                );
              }
            } catch (e) {
              console.error(`  [${ctx.source.name}] pass failed: ${(e as Error).message}`);
            }
          }
          if (opts.once || stopping) break;
          log(`sleeping ${interval}ms…`);
          await Bun.sleep(interval);
        }
      } finally {
        store.close();
      }
    },
  );

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// local-proof, proof-diff: prover independence
// ---------------------------------------------------------------------------

/** The digest a continuity proof folds to must be one Creditcoin's attestors signed. */
async function digestAttested(chainKey: number, proof: SingleProof): Promise<boolean> {
  const { upperHeight, digest } = foldContinuity(proof);
  const info = chainInfoProvider(cc3Provider());
  const bounds = await info.getContinuityBounds(chainKey, proof.headerNumber);
  if (bounds.isAttested && bounds.childHeight === upperHeight && bounds.childHash.toLowerCase() === digest.toLowerCase()) {
    return true;
  }
  const checkpoint = await info.getCheckpointForHeight(chainKey, upperHeight);
  return checkpoint.exists && checkpoint.hash.toLowerCase() === digest.toLowerCase();
}

program
  .command("local-proof")
  .argument("<txHash>", "source-chain transaction hash")
  .requiredOption("-s, --source <source>", "mainnet or sepolia")
  .option("--out <file>", "write the proof JSON to this file")
  .description("build an Attestcoin proof locally (usc-sdk RawProofBuilder + SimpleBlockProvider), no hosted prover")
  .action(async (txHash: string, opts: { source: string; out?: string }) => {
    bootEnv();
    const source = SOURCES[requireSingleSource(opts.source)];
    const t0 = Date.now();
    const proof = await buildLocalProof(source.chainKey, txHash, { sourceRpcUrl: sourceRpcUrl(source), cc3RpcUrl: cc3RpcUrl() });
    log(`local proof ${Date.now() - t0}ms — block ${proof.headerNumber}, txIndex ${proof.txIndex}`);
    log(`  txBytes ${calldataBytes(proof.txBytes)} bytes, siblings ${proof.merkleProof.siblings.length}, continuity roots ${proof.continuityProof.roots.length}`);
    const inclusion = verifyInclusion(proof);
    log(`  inclusion (recomputed)  ${inclusion.ok ? "ok" : `FAIL — ${inclusion.reason}`}`);
    log(`  continuity digest attested on CC3  ${(await digestAttested(source.chainKey, proof)) ? "ok" : "FAIL"}`);
    if (opts.out) {
      await Bun.write(opts.out, `${JSON.stringify(proof, null, 2)}\n`);
      log(`  wrote ${opts.out}`);
    }
  });

program
  .command("proof-diff")
  .argument("<txHashes...>", "source-chain transaction hashes")
  .requiredOption("-s, --source <source>", "mainnet or sepolia")
  .option("--evidence <file>", "append one JSON line per transaction", resolve(REPO_ROOT, "evidence/proof-diff.jsonl"))
  .option("--no-record", "do not append to the evidence file")
  .description("build each proof locally and fetch it from the hosted prover, then compare them byte for byte")
  .action(async (txHashes: string[], opts: { source: string; evidence: string; record: boolean }) => {
    bootEnv();
    const source = SOURCES[requireSingleSource(opts.source)];
    const hosted = proofBuilder(source.chainKey);
    let failures = 0;
    for (const txHash of txHashes) {
      log("");
      log(`proof-diff ${txHash} (${source.name}, chainKey ${source.chainKey})`);
      const t0 = Date.now();
      const local = await buildLocalProof(source.chainKey, txHash, { sourceRpcUrl: sourceRpcUrl(source), cc3RpcUrl: cc3RpcUrl() });
      const localMs = Date.now() - t0;
      const t1 = Date.now();
      const remote = await fetchProof(hosted, txHash);
      const hostedMs = Date.now() - t1;
      const diff = diffProofs(local, remote);
      const localDigestAttested = await digestAttested(source.chainKey, local);
      const hostedDigestAttested = await digestAttested(source.chainKey, remote);
      log(`  local ${localMs}ms, hosted ${hostedMs}ms${remote.cached ? " (cached)" : ""}`);
      log(`  inclusion (txBytes, index, Merkle path)  ${diff.inclusionIdentical ? "IDENTICAL" : "DIFFERENT"}`);
      log(`  continuity proof                         ${diff.continuityIdentical ? "IDENTICAL" : "different bounds"}`);
      log(`  continuity digests attested on CC3       local ${localDigestAttested}, hosted ${hostedDigestAttested}`);
      for (const d of diff.differences) log(`    - ${d}`);
      if (!diff.inclusionIdentical || !localDigestAttested) failures++;
      if (opts.record) {
        appendFileSync(
          opts.evidence,
          `${JSON.stringify({
            at: new Date().toISOString(),
            source: source.name,
            chainKey: source.chainKey,
            txHash,
            headerNumber: local.headerNumber,
            txIndex: local.txIndex,
            txBytesLength: calldataBytes(local.txBytes),
            siblings: local.merkleProof.siblings.length,
            continuityRoots: { local: local.continuityProof.roots.length, hosted: remote.continuityProof.roots.length },
            localMs,
            hostedMs,
            hostedCached: Boolean(remote.cached),
            ...diff,
            localDigestAttested,
            hostedDigestAttested,
          })}\n`,
        );
      }
    }
    log("");
    log(failures === 0 ? `all ${txHashes.length} local proofs match the hosted prover` : `${failures} mismatch(es)`);
    if (failures > 0) process.exitCode = 1;
  });

program
  .command("status")
  .option("-s, --source <source>", "mainnet, sepolia or all", "all")
  .description("cursor, per-source counts, on-chain root state and recent evidence")
  .action(async (opts: { source: string }) => {
    bootEnv();
    const names = parseSourceArg(opts.source);
    const cc3 = cc3Provider();
    const dep = loadDeployments(globals().deployments);
    const store = new RelayStore(dbPath(globals().db));

    log("");
    log(`db          ${store.path}`);
    log(`deployments ${dep.ok ? dep.path : `${deploymentsPath(globals().deployments)} (not deployed yet: ${dep.reason})`}`);
    log(`evidence    ${evidencePath(globals().evidenceFile)}`);
    log("");

    try {
      for (const name of names) {
        const source = SOURCES[name];
        const counts = store.counts(name);
        const cursor = store.getCursor(name);
        log(`${name} (chainKey ${source.chainKey})`);
        log(`  rpc            ${sourceRpcUrl(source)}`);
        log(`  sqlite cursor  ${cursor ?? "(none)"}`);
        log(
          `  txs            done ${counts.done}, already ${counts.already}, pending ${counts.pending}, failed ${counts.failed}`,
        );

        const address = dep.ok ? attestedWorldIdAddress(dep.data, source) : undefined;
        if (address) {
          try {
            const state = await readRootState(attestedWorldId(address, cc3));
            const deployTx = deploymentTxHash(dep.ok ? dep.data : undefined, source);
            const fromBlock = deployTx
              ? (await cc3.getTransactionReceipt(deployTx))?.blockNumber
              : undefined;
            const last = await lastRelayedSourceBlock(cc3, address, { fromBlock });
            log(`  contract       ${address}`);
            log(
              `  latestRoot     ${state.bootstrapped ? toHex32(state.latestRoot!) : "(not bootstrapped yet — 0 roots)"}`,
            );
            log(`  rootCount      ${state.rootCount}`);
            log(`  last relayed   source block ${last ?? "(none)"}`);
            log(
              `  next cursor    ${deriveCursor({ storeCursor: cursor, lastRelayedBlock: last })}`,
            );
          } catch (e) {
            log(`  contract       ${address} — read failed: ${(e as Error).message}`);
          }
        } else {
          log("  contract       not deployed yet");
        }

        const failed = store.byStatus(name, "failed");
        if (failed.length > 0) {
          log(`  FAILED (${failed.length}, never dropped):`);
          for (const f of failed.slice(0, 5)) {
            log(`    ${f.txHash} block ${f.sourceBlock} attempts ${f.attempts}: ${f.lastError}`);
          }
        }
        log("");
      }

      const evidence = readEvidence(evidencePath(globals().evidenceFile));
      log(`evidence lines ${evidence.length}`);
      for (const line of evidence.slice(-5)) {
        log(
          `  ${line.at} ${pad(line.source, 8)} block ${line.sourceBlock} +${line.humansAdded} humans root ${line.postRoot.slice(0, 18)}… cc3 ${line.cc3TxHash?.slice(0, 12) ?? "-"}… lag ${line.attestationLagSec}s`,
        );
      }
      log("");
    } finally {
      store.close();
    }
  });

function serializeOutcome(o: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

program.parseAsync(process.argv).catch((e) => {
  console.error(`\nerror: ${(e as Error).message}\n`);
  process.exit(1);
});
