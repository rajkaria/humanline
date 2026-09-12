"use client";

import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanknoteIcon,
  DropletsIcon,
  LockIcon,
  PlusCircleIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { Countdown } from "@/components/countdown";
import { Stat, StatRow } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { creditLineAbi, husdAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import {
  formatBps,
  formatRatio,
  formatTerm,
  formatTimestamp,
  formatUsd,
  parseUsd,
} from "@/lib/format";
import type { CreditLineTerms, Line } from "@/lib/hooks/use-credit-line";
import { useNow } from "@/lib/hooks/use-now";
import { useTx } from "@/lib/hooks/use-tx";

type Props = {
  human: bigint;
  line: Line;
  hasLine: boolean;
  available: bigint;
  inDefault: boolean;
  terms: CreditLineTerms;
  balance: bigint;
  allowance: bigint;
  symbol: string;
  /** Unix seconds until the faucet will mint again for this wallet. */
  faucetAvailableAt: bigint;
  faucetAmount?: bigint;
  loading: boolean;
  onChanged: () => void;
};

/**
 * Borrow, repay, and the state of the line.
 *
 * The hUSD approve step is folded into the repay button rather than exposed as a
 * separate "approve" ritual: the button reads "Approve and repay" when the
 * allowance is short, does both transactions in order, and says so.
 */
export function CreditPanel({
  human,
  line,
  hasLine,
  available,
  inDefault,
  terms,
  balance,
  allowance,
  symbol,
  faucetAvailableAt,
  faucetAmount,
  loading,
  onChanged,
}: Props) {
  const { address } = useAccount();
  const now = useNow(1000);
  const creditLine = CONTRACTS.creditLine.address;
  const husd = CONTRACTS.husd.address;

  const [borrowInput, setBorrowInput] = useState("");
  const [repayInput, setRepayInput] = useState("");

  const openTx = useTx({ label: "Opening your credit line", onConfirmed: onChanged });
  const borrowTx = useTx({ label: "Borrowing", onConfirmed: onChanged });
  const repayTx = useTx({ label: "Repaying", onConfirmed: onChanged });
  const approveTx = useTx({ label: "Approving hUSD" });
  const faucetTx = useTx({ label: "Claiming from the faucet", onConfirmed: onChanged });

  const borrowAmount = useMemo(() => parseUsd(borrowInput), [borrowInput]);
  const repayAmount = useMemo(() => parseUsd(repayInput), [repayInput]);

  const feeOn = useCallback(
    (amount: bigint) => (terms.feeBps === undefined ? 0n : (amount * terms.feeBps) / 10_000n),
    [terms.feeBps],
  );

  const openLine = useCallback(async () => {
    if (!creditLine) return;
    await openTx.send({
      address: creditLine,
      abi: creditLineAbi,
      functionName: "openLine",
      chainId: creditcoinTestnet.id,
    });
  }, [creditLine, openTx]);

  const borrow = useCallback(async () => {
    if (!creditLine || borrowAmount === null || borrowAmount <= 0n) return;
    await borrowTx.send({
      address: creditLine,
      abi: creditLineAbi,
      functionName: "borrow",
      args: [borrowAmount],
      chainId: creditcoinTestnet.id,
    });
    setBorrowInput("");
  }, [borrowAmount, borrowTx, creditLine]);

  const repay = useCallback(async () => {
    if (!creditLine || !husd || repayAmount === null || repayAmount <= 0n) return;
    if (allowance < repayAmount) {
      const approved = await approveTx.send({
        address: husd,
        abi: husdAbi,
        functionName: "approve",
        args: [creditLine, repayAmount],
        chainId: creditcoinTestnet.id,
      });
      if (!approved) return;
    }
    await repayTx.send({
      address: creditLine,
      abi: creditLineAbi,
      functionName: "repay",
      args: [repayAmount],
      chainId: creditcoinTestnet.id,
    });
    setRepayInput("");
  }, [allowance, approveTx, creditLine, husd, repayAmount, repayTx]);

  const faucetReady = now === 0 || faucetAvailableAt === 0n || Number(faucetAvailableAt) <= now;

  const faucet = useCallback(async () => {
    if (!husd) return;
    await faucetTx.send({
      address: husd,
      abi: husdAbi,
      functionName: "faucet",
      chainId: creditcoinTestnet.id,
    });
  }, [faucetTx, husd]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (human === 0n) return null;

  if (!hasLine) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlusCircleIcon className="size-4 text-brand" />
            Open your credit line
          </CardTitle>
          <CardDescription>
            One line per human. Opening it costs nothing and requires no collateral — the
            pool is lending against the fact that you are a person who cannot start over.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Starting limit"
              value={terms.initialLimit === undefined ? "—" : formatUsd(terms.initialLimit)}
              hint={symbol}
            />
            <Stat
              label="Ceiling"
              value={terms.maxLimit === undefined ? "—" : formatUsd(terms.maxLimit)}
              hint={symbol}
            />
            <Stat
              label="Fee per term"
              value={terms.feeBps === undefined ? "—" : formatBps(terms.feeBps)}
              hint="charged at borrow"
            />
            <Stat
              label="Term"
              value={terms.term === undefined ? "—" : formatTerm(terms.term)}
              hint={terms.grace === undefined ? undefined : `${formatTerm(terms.grace)} grace`}
            />
          </dl>
          <Button size="lg" onClick={openLine} disabled={!creditLine || openTx.isBusy}>
            <PlusCircleIcon />
            {openTx.isBusy ? "Opening…" : "Open credit line"}
          </Button>
          {openTx.error ? <p className="text-xs text-destructive">{openTx.error}</p> : null}
        </CardContent>
      </Card>
    );
  }

  const utilisation = line.limit === 0n ? 0 : Number((line.principal * 100n) / line.limit);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <BanknoteIcon className="size-4 text-brand" />
              Your credit line
            </CardTitle>
            <CardDescription>
              Repay on time and the limit grows 25%. Miss the deadline and it halves.
            </CardDescription>
          </div>
          {line.frozen ? (
            <Badge variant="destructive" className="gap-1">
              <LockIcon className="size-3" />
              Frozen
            </Badge>
          ) : inDefault ? (
            <Badge variant="destructive">In default</Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-2xl font-semibold tabular-nums">
              {formatUsd(line.principal)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {formatUsd(line.limit)} {symbol} used
              </span>
            </span>
            <span className="text-sm text-muted-foreground">
              {formatRatio(line.principal, line.limit === 0n ? 1n : line.limit, 0)} utilised
            </span>
          </div>
          <Progress value={utilisation} aria-label="Credit utilisation" />
        </div>

        <div className="grid gap-x-6 sm:grid-cols-2">
          <div>
            <StatRow label="Available to borrow" value={`${formatUsd(available)} ${symbol}`} />
            <StatRow label={`${symbol} in wallet`} value={formatUsd(balance)} />
          </div>
          <div>
            <StatRow
              label="Due in"
              value={
                line.principal === 0n ? (
                  "nothing owed"
                ) : (
                  <span title={formatTimestamp(line.dueAt)}>
                    <Countdown deadline={line.dueAt} />
                  </span>
                )
              }
            />
            <StatRow
              label="Repayment history"
              value={`${line.loansRepaid} on time · ${line.loansLate} late`}
            />
          </div>
        </div>

        {line.frozen ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground">
            This line was frozen after a default. It stays frozen on every wallet this human
            ever binds — that is the point of keying credit to a person rather than a key.
            Repaying is still possible; the freeze is not.
          </div>
        ) : null}

        <div className="grid gap-4 border-t border-foreground/10 pt-4 sm:grid-cols-2 sm:gap-6">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void borrow();
            }}
          >
            <Label htmlFor="borrow-amount" className="text-sm font-medium">
              Borrow
            </Label>
            <div className="flex gap-2">
              <Input
                id="borrow-amount"
                inputMode="decimal"
                placeholder="20.00"
                value={borrowInput}
                onChange={(e) => setBorrowInput(e.target.value)}
                className="font-mono"
                aria-invalid={borrowInput !== "" && borrowAmount === null}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBorrowInput(formatUsd(available, { group: false }))}
                disabled={available === 0n}
              >
                Max
              </Button>
            </div>
            <p className="min-h-8 text-xs text-muted-foreground">
              {borrowAmount !== null && borrowAmount > 0n ? (
                <>
                  Fee {formatUsd(feeOn(borrowAmount))} {symbol}. You will owe{" "}
                  <span className="font-mono">
                    {formatUsd(line.principal + borrowAmount + feeOn(borrowAmount))} {symbol}
                  </span>
                  {line.principal === 0n && terms.term !== undefined
                    ? `, due in ${formatTerm(terms.term)}.`
                    : "."}
                </>
              ) : (
                `Up to ${formatUsd(available)} ${symbol} available.`
              )}
            </p>
            <Button
              type="submit"
              disabled={
                !creditLine ||
                line.frozen ||
                borrowTx.isBusy ||
                borrowAmount === null ||
                borrowAmount <= 0n ||
                borrowAmount > available
              }
            >
              <ArrowDownToLineIcon />
              {borrowTx.isBusy ? "Borrowing…" : "Borrow"}
            </Button>
            {borrowTx.error ? (
              <p className="text-xs text-destructive">{borrowTx.error}</p>
            ) : null}
          </form>

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void repay();
            }}
          >
            <Label htmlFor="repay-amount" className="text-sm font-medium">
              Repay
            </Label>
            <div className="flex gap-2">
              <Input
                id="repay-amount"
                inputMode="decimal"
                placeholder="20.20"
                value={repayInput}
                onChange={(e) => setRepayInput(e.target.value)}
                className="font-mono"
                aria-invalid={repayInput !== "" && repayAmount === null}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRepayInput(formatUsd(line.principal, { group: false }))}
                disabled={line.principal === 0n}
              >
                All
              </Button>
            </div>
            <p className="min-h-8 text-xs text-muted-foreground">
              {repayAmount !== null && repayAmount > balance ? (
                <span className="text-warning">
                  Not enough {symbol} in this wallet — use the faucet below.
                </span>
              ) : repayAmount !== null && repayAmount >= line.principal && line.principal > 0n ? (
                "Clears the balance. If it is on time the limit grows 25%."
              ) : (
                `${formatUsd(line.principal)} ${symbol} outstanding.`
              )}
            </p>
            <Button
              type="submit"
              disabled={
                !creditLine ||
                !husd ||
                repayTx.isBusy ||
                approveTx.isBusy ||
                repayAmount === null ||
                repayAmount <= 0n ||
                line.principal === 0n
              }
            >
              <ArrowUpFromLineIcon />
              {approveTx.isBusy
                ? "Approving…"
                : repayTx.isBusy
                  ? "Repaying…"
                  : repayAmount !== null && allowance < repayAmount
                    ? "Approve and repay"
                    : "Repay"}
            </Button>
            {repayTx.error ?? approveTx.error ? (
              <p className="text-xs text-destructive">{repayTx.error ?? approveTx.error}</p>
            ) : null}
          </form>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            {symbol} is a test stablecoin with no value. The faucet mints{" "}
            {faucetAmount === undefined ? "100" : formatUsd(faucetAmount, { minFraction: 0 })}{" "}
            {symbol} once per 24 hours per address.
            {faucetReady ? null : (
              <>
                {" "}
                Next claim in <Countdown deadline={faucetAvailableAt} overdueLabel="ready" />.
              </>
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={faucet}
            disabled={!husd || !address || faucetTx.isBusy || !faucetReady}
          >
            <DropletsIcon />
            {faucetTx.isBusy
              ? "Claiming…"
              : faucetReady
                ? `Get ${faucetAmount === undefined ? "100" : formatUsd(faucetAmount, { minFraction: 0 })} ${symbol}`
                : "Faucet on cooldown"}
          </Button>
        </div>
        {faucetTx.error ? <p className="text-xs text-destructive">{faucetTx.error}</p> : null}
      </CardContent>
    </Card>
  );
}
