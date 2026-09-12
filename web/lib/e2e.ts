/**
 * The two end-to-end runs that prove the product works, not just compiles.
 *
 * Snapshotted from `evidence/` by `scripts/sync-artifacts.ts`:
 *
 *  - `e2e-worldid-staging.md` + `-result.json` — a real World ID simulator
 *    session on the staging tree, whose `merkle_root` is a root Attestcoin
 *    relayed, verified on Creditcoin by `HumanRegistry.register`.
 *  - `e2e-credit-loop.log` — faucet → deposit → open → borrow → repay, with the
 *    limit growing 25% on the on-time repayment.
 *
 * Everything here is parsed defensively: these files are produced by scripts
 * outside this task, and a shape change should cost `/judge` a row, not a crash.
 */

import e2eRaw from "./generated/e2e.json";

const RAW = e2eRaw as {
  worldIdStaging?: string;
  worldIdStagingResult?: unknown;
  creditLoop?: string;
};

export type TxReference = {
  label: string;
  hash: `0x${string}`;
  /** Short description of what the transaction did. */
  detail?: string;
};

const TX_HASH = /0x[0-9a-fA-F]{64}/;

function firstHash(line: string): `0x${string}` | undefined {
  const match = line.match(TX_HASH);
  return match ? (match[0] as `0x${string}`) : undefined;
}

// --------------------------------------------------------------- personhood

export type WorldIdEvidence = {
  /** The write-up, rendered as Markdown on `/judge`. */
  markdown: string;
  /** The root the proof was built against — relayed by Attestcoin. */
  merkleRoot?: `0x${string}`;
  /** The nullifier the wallet is now bound to. */
  nullifier?: `0x${string}`;
  /** The signal hash, which must equal hashToField(abi.encodePacked(wallet)). */
  signalHash?: `0x${string}`;
  /** `"3.0"` — the legacy Semaphore protocol the on-chain verifier consumes. */
  protocolVersion?: string;
  environment?: string;
  action?: string;
  /** The `HumanRegistry.register` transaction on Creditcoin. */
  registerTx?: `0x${string}`;
  /** The wallet that is now a human. */
  wallet?: `0x${string}`;
};

function parseWorldId(): WorldIdEvidence | null {
  const markdown = RAW.worldIdStaging;
  if (!markdown) return null;

  const result = RAW.worldIdStagingResult as
    | {
        result?: {
          protocol_version?: string;
          environment?: string;
          action?: string;
          responses?: Array<{
            merkle_root?: string;
            nullifier?: string;
            signal_hash?: string;
          }>;
        };
      }
    | undefined;

  const response = result?.result?.responses?.[0];
  const as32 = (value: string | undefined) =>
    value && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as `0x${string}`) : undefined;

  // The register tx and the wallet live in the prose; pull them out so the page
  // can link them rather than asking a reader to copy from a paragraph.
  const registerLine = markdown
    .split("\n")
    .find((l) => l.includes("register on CC3") || l.includes("HumanRegistry.register"));
  const walletMatch = markdown.match(/isHuman\((0x[0-9a-fA-F]{40})\)/);

  return {
    markdown,
    merkleRoot: as32(response?.merkle_root),
    nullifier: as32(response?.nullifier),
    signalHash: as32(response?.signal_hash),
    protocolVersion: result?.result?.protocol_version,
    environment: result?.result?.environment,
    action: result?.result?.action,
    registerTx: registerLine ? firstHash(registerLine) : undefined,
    wallet: walletMatch ? (walletMatch[1] as `0x${string}`) : undefined,
  };
}

export const WORLD_ID_EVIDENCE = parseWorldId();

// -------------------------------------------------------------- credit loop

export type CreditLoopEvidence = {
  /** The raw log, shown verbatim in a disclosure. */
  log: string;
  /** Every labelled transaction in the run, in order. */
  steps: TxReference[];
  /** Parsed highlights, when the log still has the shape we expect. */
  limitBefore?: string;
  limitAfter?: string;
  principalAfterBorrow?: string;
  loansRepaid?: string;
};

/** `faucet: 0xabc… status=1 gas=91379` → a labelled step. */
function parseCreditLoop(): CreditLoopEvidence | null {
  const log = RAW.creditLoop;
  if (!log) return null;

  const steps: TxReference[] = [];
  for (const line of log.split("\n")) {
    const hash = firstHash(line);
    if (!hash) continue;
    const label = line.split(":")[0]?.trim();
    if (!label) continue;
    const gas = line.match(/gas=(\d+)/)?.[1];
    steps.push({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      hash,
      detail: gas ? `${Number(gas).toLocaleString("en-US")} gas` : undefined,
    });
  }

  const limits = [...log.matchAll(/limit:\s*"(\d+)"/g)].map((m) => m[1]);

  // The log dumps the line struct several times. `principal` is 0 in the first
  // dump (just after openLine), so read it out of the block that follows
  // "after borrow:" rather than taking the first match.
  const afterBorrow = log.split(/after borrow:/)[1];
  const principalAfterBorrow = afterBorrow?.match(/principal:\s*"(\d+)"/)?.[1];

  return {
    log,
    steps,
    limitBefore: limits[0],
    limitAfter: limits[limits.length - 1],
    principalAfterBorrow,
    loansRepaid: log.match(/loansRepaid:\s*(\d+)/)?.[1],
  };
}

export const CREDIT_LOOP_EVIDENCE = parseCreditLoop();

export const hasE2eEvidence = Boolean(WORLD_ID_EVIDENCE || CREDIT_LOOP_EVIDENCE);
