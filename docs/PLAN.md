# Humanline — Implementation Plan

Spec: `docs/SPEC.md` (binding authority). Research: `docs/HACKATHON-RESEARCH.md`, `docs/COMPETITOR-RATINGS.md`.

## Global constraints

- Repo root: `/Users/rajkaria/Projects/humanline`. Foundry binaries live in `.tools/` (`.tools/forge`, `.tools/cast`, `.tools/anvil`); `forge`/`cast` are NOT on PATH. `node` is blocked as a bare command by a security hook; use `bun` for every script and test runner (`bun run`, `bun test`, `bun x`). `curl` is blocked; use `gh api`, `bun` fetch, or WebFetch.
- Solidity 0.8.28, `evm_version = cancun`, Foundry config already in `contracts/foundry.toml`. Remappings: `@gluwa/asc-contracts/`, `@openzeppelin/contracts/`, `forge-std/`, `worldid/` (vendored MIT World ID bridge + Semaphore verifier in `contracts/vendor/worldid/`).
- Precompiles on Creditcoin CC3 testnet (chainId 102031, RPC `https://rpc.cc3-testnet.creditcoin.network`): BlockProver `0x0000000000000000000000000000000000000FD2` (interface `@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol`), ChainInfo `0x0000000000000000000000000000000000000fD3`, AttestorStash `0x0000000000000000000000000000000000000fd4`. bn128 precompiles 0x06/0x07/0x08 exist (verified).
- `EvmV1Decoder` (`@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol`) is an internal library: `getTransactionType`, `isValidTransactionType`, `decodeCommonTxFields(bytes) → CommonTxFields{nonce,gasLimit,from,toIsNull,to,value,data}`, `decodeReceiptFields(bytes) → ReceiptFields{receiptStatus,receiptGasUsed,logs[],receiptLogsBloom}` (LogEntry{address_,topics[],data}), `getLogsByEventSignature(receipt, sig)`.
- `ASCBase` (`@gluwa/asc-contracts/contracts/readability/ASCBase.sol`): `execute(uint8 action, uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, MerkleProofEntry[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots)`; computes `queryId = keccak(chainKey, blockHeight<<192, txIndex)` via `VERIFIER.calculateTxIndex`; requires `!processedQueries[queryId]`; calls `VERIFIER.verifyAndEmit`; then `_processAndEmitEvent(action, queryId, encodedTransaction)`.
- World ID constants: mainnet Orb identity manager `0xf7134CE138832c1456F2a91D64621eE90c2bddEa` (chainKey 3); Sepolia staging manager `0xb2ead588f14e69266d1b87936b75325181377076` (chainKey 1); `TreeChanged(uint256 indexed preRoot, uint8 indexed kind, uint256 indexed postRoot)` topic0 `0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04`; selectors `registerIdentities(uint256[8],uint256,uint32,uint256[],uint256)` = `0x2217b211`, `deleteIdentities(uint256[8],bytes,uint256,uint256)` = `0xea10fbbe`; tree depth 30.
- Real proof fixtures (SDK `getProof` output, verified true on-chain): `contracts/test/fixtures/mainnet-0x81ece311.json` (block 25959565, txIndex 173, registerIdentities) and `contracts/test/fixtures/sepolia-0x36678603.json` (block 11687163, txIndex 58). Fields: `txHash, chainKey, headerNumber, txHash, txBytes, merkleProof{root,siblings[{hash,isLeft?}]}, continuityProof{lowerEndpointDigest,roots[]}`. Read exact field names from the file.
- World ID hashing: `hashToField(bytes b) = uint256(keccak256(b)) >> 8`. `signalHash = hashToField(abi.encodePacked(address wallet))`. `externalNullifierHash = hashToField(abi.encodePacked(hashToField(abi.encodePacked(app_id_string)), action_string))`.
- Relayer/deployer wallet: `0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3`, key in `.secrets.env` (git-ignored). Funds arrive from the Discord faucet; do not block on deployment.
- No admin keys, no pause, no upgradeability in any contract. Constants are immutables or constructor args.
- Every contract function that can fail must revert with a named custom error.
- Tests: Foundry for contracts (unit tests with fixtures; fork tests tagged `Fork` that skip when `CC3_FORK` env is unset); `bun test` for worker and web logic.
- Do not run any `git` commands inside subagent tasks; the controller commits.

## Interfaces (all tasks build to these exactly)

```solidity
// contracts/src/interfaces/IChainInfo.sol (MIT, minimal)
struct ChainInfo { uint64 chainKey; uint64 chainId; bytes chainName; uint8 chainEncoding; }
struct ChainInfoResult { ChainInfo info; bool exists; }
struct HeightResult { uint64 height; bool exists; }
interface IChainInfo {
  function get_supported_chains() external view returns (ChainInfo[] memory);
  // Task 1 must confirm the exact selector/name of the "latest attested height for chainKey" getter
  // from precompiles/metadata/sol/chain_info.sol in gluwa/creditcoin3 (fetch with `gh api`).
}
// contracts/src/interfaces/IAttestorStash.sol (MIT, minimal)
interface IAttestorStash { function getAttestorsCount(uint64 chainKey) external view returns (uint32); }

// contracts/src/interfaces/IAttestedWorldID.sol
interface IAttestedWorldID /* also implements worldid/IWorldID.sol */ {
  event RootRelayed(bytes32 indexed queryId, uint64 indexed sourceBlock, uint256 indexed postRoot,
                    uint256 preRoot, uint8 kind, uint32 humansAdded, uint256 sourceTxIndex, address relayer);
  error WrongSourceChain(uint64 got, uint64 want);
  error SourceTxReverted();
  error NotIdentityManager(address to);
  error NoTreeChange();
  error AmbiguousTreeChange(uint256 count);
  error CalldataLogMismatch();
  error UnknownPreRoot(uint256 preRoot);
  error NotFinal(uint64 attestedTip, uint64 sourceBlock);
  error ThinQuorum(uint32 have, uint32 want);
  function SOURCE_CHAIN_KEY() external view returns (uint64);
  function IDENTITY_MANAGER() external view returns (address);
  function FINALITY_DEPTH() external view returns (uint64);
  function MIN_ATTESTORS() external view returns (uint32);
  function latestRoot() external view returns (uint256);
  function rootHistory(uint256 root) external view returns (uint128 receivedAt);
  function rootCount() external view returns (uint256);
  function humansAddedTotal() external view returns (uint256);
  function isValidRoot(uint256 root) external view returns (bool);
  // inherited: ASCBase.execute(...) with action 0 = RootUpdate
  function executeBatch(uint64 chainKey, uint64[] calldata blockHeights, bytes[] calldata encodedTransactions,
                        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
                        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof) external;
  // IWorldID: verifyProof(uint256 root, uint256 signalHash, uint256 nullifierHash, uint256 externalNullifierHash, uint256[8] proof) view
}

// contracts/src/interfaces/IHumanRegistry.sol
interface IHumanRegistry {
  event HumanRegistered(uint256 indexed nullifierHash, address indexed wallet, uint256 root);
  event HumanRebound(uint256 indexed nullifierHash, address indexed oldWallet, address indexed newWallet);
  error WalletAlreadyHuman(address wallet, uint256 nullifierHash);
  error SameWallet();
  function register(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external;
  function isHuman(address wallet) external view returns (bool);
  function humanOf(address wallet) external view returns (uint256);
  function walletOf(uint256 nullifierHash) external view returns (address);
  function registeredAt(uint256 nullifierHash) external view returns (uint64);
  function humanCount() external view returns (uint256);
  function WORLD_ID() external view returns (address);
  function EXTERNAL_NULLIFIER_HASH() external view returns (uint256);
  function APP_ID() external view returns (string memory);
  function ACTION() external view returns (string memory);
}

// contracts/src/interfaces/ICreditLine.sol
interface ICreditLine {
  struct Line { uint256 limit; uint256 principal; uint64 dueAt; uint64 openedAt; uint32 loansRepaid; uint32 loansLate; bool frozen; }
  event Deposited(address indexed lender, uint256 assets, uint256 shares);
  event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
  event LineOpened(uint256 indexed human, address indexed wallet, uint256 limit);
  event Borrowed(uint256 indexed human, address indexed wallet, uint256 amount, uint256 fee, uint64 dueAt);
  event Repaid(uint256 indexed human, address indexed wallet, uint256 amount, uint256 remaining);
  event LimitChanged(uint256 indexed human, uint256 oldLimit, uint256 newLimit, bool onTime);
  event Defaulted(uint256 indexed human, uint256 writtenOff, address indexed reporter);
  error NotHuman(address wallet);
  error LineExists(uint256 human);
  error NoLine(uint256 human);
  error LineFrozen(uint256 human);
  error OverLimit(uint256 requested, uint256 available);
  error InsufficientLiquidity(uint256 requested, uint256 available);
  error NothingOwed(uint256 human);
  error NotInDefault(uint256 human, uint64 dueAt, uint64 grace);
  error ZeroAmount();
  function ASSET() external view returns (address);
  function REGISTRY() external view returns (address);
  function INITIAL_LIMIT() external view returns (uint256);   // 25e6
  function MAX_LIMIT() external view returns (uint256);       // 2000e6
  function FEE_BPS() external view returns (uint256);         // 100 (1% per term)
  function TERM() external view returns (uint64);             // seconds; 30 days prod, 600 on demo deploy
  function GRACE() external view returns (uint64);            // seconds; 7 days prod, 300 on demo deploy
  function deposit(uint256 assets) external returns (uint256 shares);
  function withdraw(uint256 shares) external returns (uint256 assets);
  function openLine() external;
  function borrow(uint256 amount) external;
  function repay(uint256 amount) external;
  function markDefault(uint256 human) external;
  function lineOf(uint256 human) external view returns (Line memory);
  function availableCredit(uint256 human) external view returns (uint256);
  function totalAssets() external view returns (uint256);
  function totalBorrowed() external view returns (uint256);
  function totalShares() external view returns (uint256);
  function sharesOf(address lender) external view returns (uint256);
  function isInDefault(uint256 human) external view returns (bool);
}
```

Rules: `borrow` sets `dueAt = now + TERM` only when principal was 0; principal += amount + fee; `repay` transfers from wallet, principal -= amount (cap at principal); when principal reaches 0: onTime = now <= dueAt → limit = min(limit*125/100, MAX_LIMIT), loansRepaid++; else limit = max(limit/2, INITIAL_LIMIT/2), loansLate++. `markDefault` requires principal > 0 and now > dueAt + GRACE → frozen = true, writtenOff = principal, principal = 0, totalBorrowed -= writtenOff (pool absorbs loss). `openLine` requires `REGISTRY.isHuman(msg.sender)`, keyed by `REGISTRY.humanOf(msg.sender)`. All line functions resolve `human = REGISTRY.humanOf(msg.sender)` and revert `NotHuman` when 0. A human whose wallet was re-bound keeps the same line.

`hUSD` (`contracts/src/HUSD.sol`): ERC20 "Humanline USD", symbol hUSD, 6 decimals, `faucet()` mints 100 hUSD to msg.sender at most once per 24h per address (`error FaucetCooldown(uint64 until)`), `event Faucet(address,uint256)`. No owner.

`HumanGate` (`contracts/src/examples/HumanGate.sol`): `claim()` once per human (`error AlreadyClaimed(uint256 human)`, `event Claimed(uint256 indexed human, address wallet)`), `claimed(uint256)` view. Twenty lines; it exists to show integrators the pattern.

## Tasks

### Task 1 — Contracts: AttestedWorldID (root relay + World ID verifier)
Files: `contracts/src/AttestedWorldID.sol`, `contracts/src/interfaces/{IChainInfo,IAttestorStash,IAttestedWorldID}.sol`, `contracts/test/AttestedWorldID.t.sol`, `contracts/test/harness/*.sol`, `contracts/test/Fixtures.sol` (loads JSON fixtures via `vm.readFile` + `vm.parseJson`), `contracts/test/AttestedWorldID.fork.t.sol`.
Delete `contracts/src/Smoke.sol`.

Requirements:
1. `AttestedWorldID is ASCBase, WorldIDBridge, IAttestedWorldID`. Constructor `(uint64 sourceChainKey, address identityManager, uint64 finalityDepth, uint32 minAttestors)`; `WorldIDBridge(30)`. Note `WorldIDBridge` declares `SemaphoreVerifier internal semaphoreVerifier = new SemaphoreVerifier()`; keep it. `setRootHistoryExpiry` is NOT exposed (no owner); expiry stays `1 weeks`.
2. `_processAndEmitEvent(action, queryId, tx)` implements SPEC §5.1 steps 1–9 exactly, in that order, with the named errors. Finality guard reads ChainInfo for the latest attested/checkpoint height of `SOURCE_CHAIN_KEY`; quorum guard reads `IAttestorStash.getAttestorsCount(SOURCE_CHAIN_KEY)`. Both guards must be behind a small internal virtual function so unit tests can stub them via a harness (tests run without precompiles); fork tests exercise the real ones.
3. Calldata parsing: word layout after the 4-byte selector. `registerIdentities`: words 0..7 insertion proof, word 8 preRoot, word 9 startIndex, word 10 offset of identityCommitments, word 11 postRoot, `humansAdded = length word at offset`. `deleteIdentities`: words 0..7 deletion proof, word 8 offset of packed indices, word 9 preRoot, word 10 postRoot, humansAdded = 0. Any other selector → `CalldataLogMismatch`. Cross-check against the log's preRoot/postRoot.
4. Root chaining per SPEC §5.1 step 7. Bootstrap: when `rootCount == 0`, accept any preRoot and record BOTH preRoot (as a historical root with the same timestamp) and postRoot.
5. `executeBatch`: verify all with `VERIFIER.verifyAndEmit(chainKey, heights, txs, merkleProofs, sharedProof)` (batch overload), compute each `queryId` via `VERIFIER.calculateTxIndex`, enforce replay per tx, process in array order, require `blockHeights` non-decreasing, max 10.
6. `verifyProof` inherited from `WorldIDBridge` (do not modify vendored files). `isValidRoot(root)` returns true for latestRoot or unexpired history.
7. Unit tests (Foundry, no network) using the real fixture bytes with a harness that overrides the verifier call and guards: happy path mainnet fixture (asserts preRoot/postRoot/humansAdded/kind decoded from the real tx bytes match the values the test reads from the fixture JSON or from Etherscan-visible topics — derive expected values by decoding logs inside the test with EvmV1Decoder, then assert the contract emitted the same), sepolia fixture, wrong chainKey, reverted status (mutate the status byte via a harness that returns a modified receipt — or a synthetic encoded tx builder), wrong `to`, decoy TreeChanged from another emitter mixed into logs (skipped, real one accepted), two real TreeChanged logs (ambiguous), selector mismatch, unknown preRoot after bootstrap, chain advance vs side-fill, not-final, thin quorum, replay of same queryId, batch ordering, batch >10, root expiry after 1 week (vm.warp), `verifyProof` rejects an invalid proof (any garbage proof reverts `ProofInvalid`) and rejects an unknown/expired root before touching the verifier.
8. Fork tests (`CC3_FORK=1 .tools/forge test --fork-url https://rpc.cc3-testnet.creditcoin.network --match-contract Fork`): deploy on the fork, call `execute` with the mainnet fixture through the REAL precompile, assert `RootRelayed` and `latestRoot()`; call `verifySingle`-equivalent view `VERIFIER.verify` on the fixture; read real ChainInfo/AttestorStash values. Skip cleanly when `CC3_FORK` unset.
9. Gas report for `execute` and `executeBatch` in the task report.

### Task 2 — Contracts: HumanRegistry, CreditLine, hUSD, HumanGate, deploy script
Files: `contracts/src/{HumanRegistry,CreditLine,HUSD}.sol`, `contracts/src/examples/HumanGate.sol`, `contracts/src/interfaces/{IHumanRegistry,ICreditLine}.sol`, `contracts/test/{HumanRegistry,CreditLine,HUSD,HumanGate}.t.sol`, `contracts/test/mocks/MockWorldID.sol`, `contracts/script/Deploy.s.sol`, `contracts/script/DeployDemo.s.sol`, `contracts/abi/` export step, `deployments/README.md`.

Requirements:
1. Implement the interfaces above verbatim. `HumanRegistry(address worldId, string appId, string action)` computes `EXTERNAL_NULLIFIER_HASH` in the constructor with the hashing rule from Global Constraints; `register` computes `signalHash` from `msg.sender`, calls `IWorldID(WORLD_ID).verifyProof(root, signalHash, nullifierHash, EXTERNAL_NULLIFIER_HASH, proof)`, then binds/rebinds.
2. `CreditLine(address asset, address registry, uint256 initialLimit, uint256 maxLimit, uint256 feeBps, uint64 term, uint64 grace)`; share accounting: first deposit mints shares 1:1, later `shares = assets * totalShares / totalAssets` where `totalAssets = asset.balanceOf(this) + totalBorrowed`; withdraw pays `shares * totalAssets / totalShares` from idle liquidity only (`InsufficientLiquidity`). Use OpenZeppelin `SafeERC20`; reentrancy-safe ordering.
3. Tests: full lifecycle (deposit → open → borrow → repay on time → limit up), late repay → limit down, default → frozen + pool loss + `LineFrozen` on borrow, re-bind keeps line, second wallet of same human cannot open a second line, non-human reverts, over-limit, insufficient liquidity, fee math, faucet cooldown, HumanGate claim once, share math with two lenders and a written-off loan.
4. `Deploy.s.sol`: deploys `AttestedWorldID` ×2 (mainnet: chainKey 3, manager `0xf7134CE1…`, finality 32, minAttestors 3; sepolia: chainKey 1, manager `0xb2ead588…`, finality 32, minAttestors 3), `HUSD`, `HumanRegistry` (worldId = env `WORLD_ID_SOURCE` = "sepolia"|"mainnet", appId env `WORLD_APP_ID`, action `humanline-register`), `CreditLine` (term/grace from env with prod defaults), `HumanGate`; writes `deployments/cc3-testnet.json` `{chainId, contracts:{...}, txHashes:{...}, deployedAt, deployer}` via `vm.writeJson`. `DeployDemo.s.sol` = same with `TERM=600`, `GRACE=300`. Provide `contracts/script/export-abi.sh` (bash, uses `.tools/forge inspect <C> abi`) writing `contracts/abi/<Contract>.json` for all six contracts; run it and commit the ABIs.

### Task 3 — Worker: relay CLI
Files: `worker/src/{cli,config,sources,relay,proofs,evidence,cc3}.ts`, `worker/src/store.ts` (bun:sqlite), `worker/test/*.test.ts`, `worker/README.md`, `.github/workflows/relay.yml`, `worker/.env.example`.

Requirements:
1. Commands (`bun run worker/src/cli.ts <cmd>`): `check`, `bootstrap --source <mainnet|sepolia> [--tx <hash>]`, `prove <txHash> --source <s>` (one-off: wait attested → proof → `execute`), `relay --source <mainnet|sepolia|all> [--once] [--from <block>]` (continuous by default, poll every 60s), `status`.
2. Source config: mainnet `{chainKey 3, manager 0xf7134CE1…, rpc env ETH_MAINNET_RPC default https://ethereum-rpc.publicnode.com}`, sepolia `{chainKey 1, manager 0xb2ead588…, rpc env ETH_SEPOLIA_RPC default https://ethereum-sepolia-rpc.publicnode.com}`. Contract addresses from `deployments/cc3-testnet.json` (path via env `DEPLOYMENTS_FILE`), signer from `CREDITCOIN_WALLET_PRIVATE_KEY`, CC3 RPC `https://rpc.cc3-testnet.creditcoin.network`, prover `https://prover.cc3-testnet.creditcoin.network`.
3. Relay algorithm: cursor = max(sqlite cursor, last `RootRelayed` sourceBlock on-chain + 1, `--from`); `eth_getLogs` for TreeChanged from manager in ≤ 5,000-block windows; order by (block, logIndex); skip txs whose `queryId` is already `processedQueries` on-chain; group consecutive txs into batches where `maxBlock − minBlock ≤ 1000` and size ≤ 10; for each batch: `waitUntilHeightAttested(chainKey, maxBlock)`, `getBatchProof(hashes)` (fall back to per-tx `getProof` + `execute` if the batch call fails), estimate gas, submit `executeBatch` (or `execute`), wait 1 confirmation; on revert whose reason contains "Query already processed" mark done; on any other revert refetch the proof once and retry, then record as failed (never dropped) and continue; persist per-tx status in sqlite and append JSON lines to `evidence/relay-log.jsonl` `{source, txHash, sourceBlock, txIndex, preRoot, postRoot, kind, humansAdded, cc3TxHash, gasUsed, attestationLagSec, at}`.
4. Use `@gluwa/usc-sdk` 0.18 (`proofProvider.service.ProofBuilder`, `blockProver.PrecompileBlockProver`, `chainInfo.PrecompileChainInfoProvider`) and ethers v6 with the ABIs in `contracts/abi/` (import JSON). The proof JSON shapes are in `contracts/test/fixtures/*.json`; the `execute` argument mapping is: `merkleRoot = proof.merkleProof.root`, `siblings = proof.merkleProof.siblings`, `lowerEndpointDigest = proof.continuityProof.lowerEndpointDigest`, `continuityRoots = proof.continuityProof.roots`.
5. `check` prints: supported chains from ChainInfo, latest attested height per chain, attestor counts from 0xFD4, bn128 sanity (eth_call to 0x08 with empty input returns 1), latestRoot/rootCount for both AttestedWorldID instances, wallet balance.
6. Tests (`bun test`): batching/grouping logic, cursor derivation, argument mapping from fixture JSON, evidence line formatting, retry policy (mocked). No network in tests.
7. `.github/workflows/relay.yml`: cron every 30 min + manual dispatch; runs `bun install` and `bun run worker/src/cli.ts relay --source all --once`; secrets `CREDITCOIN_WALLET_PRIVATE_KEY`, `ETH_MAINNET_RPC`, `ETH_SEPOLIA_RPC`; commits `evidence/relay-log.jsonl` back to the repo with `[skip ci]`.

### Task 4 — Web app
Files: `web/` (Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, wagmi v2 + viem, `@worldcoin/idkit`), pages `/`, `/app`, `/relay`, `/judge`, `/docs`, plus `web/lib/{chains,contracts,worldid,format}.ts`, `web/components/*`, `web/README.md`, `.env.example`.

Requirements:
1. Scaffold with `bun x create-next-app@latest web --ts --tailwind --app --eslint --src-dir=false --import-alias "@/*" --use-bun` (or equivalent non-interactive flags), then `bun x shadcn@latest init -d` and add button, card, badge, table, dialog, input, tabs, skeleton, toast/sonner. Dark theme default. Fonts: Inter (UI) + JetBrains Mono (hashes). Mobile responsive. Loading skeletons and error boundaries on every data view.
2. Chain config for Creditcoin CC3 testnet (id 102031, RPC `https://rpc.cc3-testnet.creditcoin.network`, explorer `https://creditcoin-testnet.blockscout.com`, native tCTC 18 decimals). Wallet: wagmi injected connector with "add/switch network" helper. Explorer link helpers for CC3 (Blockscout), Ethereum mainnet (Etherscan), Sepolia (Sepolia Etherscan).
3. Contract addresses/ABIs: import `deployments/cc3-testnet.json` and `contracts/abi/*.json` (relative imports from repo root are fine; if the deployments file is missing at build time, fall back to `NEXT_PUBLIC_*` env addresses and render an "not deployed yet" banner rather than crashing).
4. `/` landing per SPEC §5.5 with live counters (roots relayed per source = `rootCount()`, humans = `humanCount()`, credit extended = sum of `Borrowed` events or `totalBorrowed()`), a comparison block "wallet passports vs Humanline", how-it-works diagram (inline SVG), CTA to `/app`.
5. `/app`: connect → status card (Not human / Human #nullifier-short / line status) → IDKit widget (`app_id` env `NEXT_PUBLIC_WORLD_APP_ID`, `action` "humanline-register", `signal` = connected address, `verification_level` orb, environment from `NEXT_PUBLIC_WORLD_ENV` default staging, and legacy-proof compatibility: research the installed `@worldcoin/idkit` version's API with WebFetch on docs.world.org and set whatever flag makes the widget return a 3.0 Semaphore proof (`merkle_root`, `nullifier_hash`, `proof` as abi-encoded `uint256[8]`); decode `proof` with viem `decodeAbiParameters`); submit `register(root, nullifierHash, proof)`; then credit panel: limit, principal, dueAt countdown, available, borrow/repay forms with hUSD approve flow, faucet button, event history table with explorer links; lender panel: deposit/withdraw, pool stats.
6. `/relay`: table of `RootRelayed` events for both instances (viem `getLogs`, paginated in 50k-block windows from the deployment block), columns: source, Ethereum tx (link), Creditcoin tx (link), block, txIndex, pre→post root (short), humans added, relayer, time; header cards with latestRoot, rootCount, humansAddedTotal, attested tip and attestor count read from precompiles (call `get_supported_chains` on 0xFD3 and `getAttestorsCount(uint64)` on 0xFD4 with hand-written minimal ABIs), auto-refresh every 15s.
7. `/judge`: addresses table with explorer links, "verify without a wallet" command blocks (copyable), the negative-path list from SPEC §9 with the test names that cover each, a live "prove it yourself" widget that takes an Ethereum tx hash and shows the proof-builder JSON and a read-only `verify` result via `eth_call` to 0xFD2 (use the ABI from `@gluwa/asc-contracts` INativeQueryVerifier: `verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))` — confirm the struct layout from `contracts/node_modules/@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol`), and the evidence log rendered from `evidence/relay-log.jsonl` if present.
8. `/docs`: integration guide (how a lender calls `isHuman`/`humanOf`/`lineOf`), the Attestcoin integration write-up (link to `docs/ATTESTCOIN_INTEGRATION.md` content rendered), security model, known limitations.
9. `bun run build` must pass with zero type errors. Unit tests for `lib/worldid.ts` hashing helpers (must reproduce `hashToField` and externalNullifier exactly like the Solidity) and formatting.

### Task 5 — Deploy to CC3 testnet and run the relay (controller + implementer, after funds arrive)
Deploy with `DeployDemo.s.sol` (demo terms) and record addresses; run `worker check`; bootstrap both sources from the two fixture txs; run `relay --once` for both; verify contracts on Blockscout (`forge verify-contract --verifier blockscout --verifier-url https://creditcoin-testnet.blockscout.com/api`); update `web` env; deploy web to Vercel.

### Task 6 — Documentation and pitch
Files: `README.md`, `docs/ATTESTCOIN_INTEGRATION.md` (every protocol surface with the code that uses it, per SPEC §8), `docs/ARCHITECTURE.md`, `docs/VISION.md` (hackathon skill template), `docs/SECURITY.md`, `docs/DECK.md` (12-slide outline → PDF), `docs/VIDEO_SCRIPT.md` (3:00, timed), `docs/SUBMISSION.md` (DoraHacks fields filled), `LICENSE` (MIT), `CHANGELOG.md`.

### Task 7 — Judge simulation and fix loop
Run a 7-judge panel per the hackathon skill against the live deployment; fix everything Critical/Important; repeat until ≥ 9.0.
