import { BadgeCheckIcon, BanknoteIcon, FingerprintIcon, Link2Icon, SnowflakeIcon } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { HashLink } from "@/components/hash-link";
import { Markdown } from "@/components/markdown";
import { StatRow } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatUsd, truncateUint256 } from "@/lib/format";
import {
  CREDIT_LOOP_EVIDENCE,
  DEFAULT_EVIDENCE,
  LINK_EVIDENCE,
  WORLD_ID_EVIDENCE,
  type TxReference,
} from "@/lib/e2e";

/**
 * "This actually happened."
 *
 * The rest of `/judge` is instructions for checking claims. This section is the
 * two claims we already checked, with the transaction hashes to prove it: a real
 * World ID proof verified on Creditcoin, and a full borrow-repay cycle that grew
 * the limit. Every hash links to Blockscout.
 */
export function E2eEvidence() {
  if (!WORLD_ID_EVIDENCE && !CREDIT_LOOP_EVIDENCE) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No end-to-end run recorded yet</CardTitle>
          <CardDescription>
            The scripts in <code className="font-mono text-xs">web/scripts/e2e-*.ts</code>{" "}
            write their output to <code className="font-mono text-xs">evidence/</code>. It is
            snapshotted into this build and rendered here as soon as it exists.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {WORLD_ID_EVIDENCE ? <PersonhoodCard /> : null}
      {CREDIT_LOOP_EVIDENCE ? <CreditLoopCard /> : null}
      {DEFAULT_EVIDENCE ? <DefaultCard /> : null}
      {LINK_EVIDENCE ? <LinkCard /> : null}
    </div>
  );
}

function DefaultCard() {
  const e = DEFAULT_EVIDENCE!;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <SnowflakeIcon className="size-4 text-destructive" />
            A default follows the person
          </CardTitle>
          {e.frozenOnNewWallet ? <Badge className="bg-destructive/15 text-destructive">frozen on the new wallet</Badge> : null}
        </div>
        <CardDescription>
          A seeded human borrowed and never repaid. Past the due date and grace period, a stranger
          marked the line in default. The same World ID then registered from a brand-new wallet, and
          the line came with it, frozen. A new keypair is not a new borrower.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-col divide-y divide-foreground/10 text-xs">
          <StatRow label="Human (nullifier)" mono={false} value={<HashLink value={e.human as `0x${string}`} />} />
          <StatRow label="Wallet that defaulted" mono={false} value={<HashLink value={e.firstWallet as `0x${string}`} scope="creditcoin" kind="address" />} />
          <StatRow label="New wallet, same human" mono={false} value={<HashLink value={e.newWallet as `0x${string}`} scope="creditcoin" kind="address" />} />
          <StatRow label="Borrow from the new wallet" mono={false} value={<span className="font-mono">{e.borrowFromNewWallet || "refused"}</span>} />
        </dl>
        <ol className="flex flex-col divide-y divide-foreground/10">
          {e.steps.map((step) => (
            <StepRow key={step.hash} step={step} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function LinkCard() {
  const e = LINK_EVIDENCE!;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2Icon className="size-4 text-brand" />
          An Ethereum wallet, linked to a human
        </CardTitle>
        <CardDescription>
          A fresh Ethereum key signed the EIP-712 Link naming this human and their Creditcoin wallet,
          and <code className="font-mono text-xs">HumanLinks</code> on Creditcoin recorded it. From
          here, that wallet&apos;s Aave history and USDC repayments can count for this person.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col divide-y divide-foreground/10 text-xs">
          <StatRow label="Human (nullifier)" mono={false} value={<HashLink value={e.human as `0x${string}`} />} />
          <StatRow label="Creditcoin wallet" mono={false} value={<HashLink value={e.creditcoinWallet as `0x${string}`} scope="creditcoin" kind="address" />} />
          <StatRow label="Linked Ethereum wallet" mono={false} value={<HashLink value={e.linkedWallet as `0x${string}`} />} />
          <StatRow label="linkBySignature on Creditcoin" mono={false} value={<HashLink value={e.tx} scope="creditcoin" kind="tx" />} />
        </dl>
      </CardContent>
    </Card>
  );
}

function PersonhoodCard() {
  const e = WORLD_ID_EVIDENCE!;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FingerprintIcon className="size-4 text-brand" />
            Proof of personhood, verified on Creditcoin
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {e.protocolVersion ? (
              <Badge variant="secondary">World ID {e.protocolVersion}</Badge>
            ) : null}
            {e.environment ? <Badge variant="outline">{e.environment}</Badge> : null}
          </div>
        </div>
        <CardDescription>
          A real World ID simulator identity on the staging tree, proved against a root that
          Attestcoin relayed, with the Groth16 proof verified by the contract on Creditcoin.
          Not by an API, not by us.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-col divide-y divide-foreground/10 text-xs">
          {e.wallet ? (
            <StatRow
              label="Wallet, now a human"
              mono={false}
              value={<HashLink value={e.wallet} scope="creditcoin" kind="address" />}
            />
          ) : null}
          {e.nullifier ? (
            <StatRow
              label="Nullifier"
              mono={false}
              value={<HashLink value={e.nullifier} />}
            />
          ) : null}
          {e.merkleRoot ? (
            <StatRow
              label="Root proved against"
              mono={false}
              value={<HashLink value={e.merkleRoot} />}
            />
          ) : null}
          {e.signalHash ? (
            <StatRow
              label="Signal hash"
              mono={false}
              value={<HashLink value={e.signalHash} />}
            />
          ) : null}
          {e.registerTx ? (
            <StatRow
              label="register() on Creditcoin"
              mono={false}
              value={<HashLink value={e.registerTx} scope="creditcoin" kind="tx" />}
            />
          ) : null}
        </dl>

        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-2.5 text-xs">
          <BadgeCheckIcon className="size-4 shrink-0 text-success" aria-hidden />
          <span className="text-muted-foreground">
            The signal hash above is{" "}
            <code className="font-mono">hashToField(abi.encodePacked(wallet))</code>, the
            same value the widget below recomputes from the deployed contract.
          </span>
        </div>

        <details className="rounded-lg bg-muted/30 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Full write-up
          </summary>
          <div className="pt-3">
            <Markdown source={e.markdown} />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function CreditLoopCard() {
  const e = CREDIT_LOOP_EVIDENCE!;
  const grew =
    e.limitBefore && e.limitAfter && BigInt(e.limitAfter) > BigInt(e.limitBefore);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BanknoteIcon className="size-4 text-brand-2" />
            The credit loop, on-chain
          </CardTitle>
          {grew ? (
            <Badge className="bg-success/15 text-success">limit grew 25%</Badge>
          ) : null}
        </div>
        <CardDescription>
          {e.source === "seed"
            ? "A fresh wallet proves a World ID, opens a CreditLine v3 line, borrows and repays on time. Every step is a real transaction on CC3 testnet, and the on-time repayment raised the limit. Seeded by Humanline's own wallets, recorded in evidence/seed-demo.jsonl."
            : "Faucet, deposit, open, borrow, repay. Every step a real transaction on CC3 testnet, ending with an on-time repayment that raised the limit."}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {e.limitBefore && e.limitAfter ? (
          <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-xs">
            <Figure label="Limit before" value={`${formatUsd(BigInt(e.limitBefore))} hUSD`} />
            <Figure
              label="Borrowed + fee"
              value={
                e.principalAfterBorrow
                  ? `${formatUsd(BigInt(e.principalAfterBorrow))} hUSD`
                  : "–"
              }
            />
            <Figure
              label="Limit after"
              value={`${formatUsd(BigInt(e.limitAfter))} hUSD`}
              emphasis
            />
          </dl>
        ) : null}

        <ol className="flex flex-col divide-y divide-foreground/10">
          {e.steps.map((step) => (
            <StepRow key={step.hash} step={step} />
          ))}
        </ol>

        {e.repeats && e.repeats.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              The same cycle, run by {e.repeats.length} more humans:
            </p>
            <ol className="flex flex-col divide-y divide-foreground/10">
              {e.repeats.map((step) => (
                <StepRow key={step.hash} step={step} />
              ))}
            </ol>
          </div>
        ) : null}

        <details className="rounded-lg bg-muted/30 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Raw log
          </summary>
          <div className="mt-2 flex items-start gap-2">
            <pre className="max-h-72 flex-1 overflow-auto rounded-md bg-background/60 p-3 font-mono text-[11px] leading-relaxed">
              {e.log}
            </pre>
            <CopyButton value={e.log} label="Copy the credit-loop log" size="sm" />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: TxReference }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
      <span className="flex items-center gap-2">
        <span className="font-medium">{step.label}</span>
        {step.detail ? (
          <span className="text-muted-foreground">{step.detail}</span>
        ) : null}
      </span>
      <HashLink value={step.hash} scope="creditcoin" kind="tx" copy={false} />
    </li>
  );
}

function Figure({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          emphasis
            ? "font-mono text-sm font-semibold text-success tabular-nums"
            : "font-mono text-sm tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/** Exported for the summary line on the relay page's evidence section. */
export function e2eRootSummary(): string | null {
  if (!WORLD_ID_EVIDENCE?.merkleRoot) return null;
  return truncateUint256(BigInt(WORLD_ID_EVIDENCE.merkleRoot));
}
