"use client";

import { LandmarkIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { Stat, StatRow } from "@/components/stat";
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
import { creditLineAbi, husdAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import { formatRatio, formatUsd, parseUsd } from "@/lib/format";
import type { PoolStats } from "@/lib/hooks/use-credit-line";
import { useTx } from "@/lib/hooks/use-tx";

/**
 * The supply side.
 *
 * Deposits are what make the lines real; showing utilisation next to the deposit
 * form is the honest framing — a lender is funding uncollateralised loans to
 * people whose only collateral is that they cannot become someone else.
 */
export function LenderPanel({
  pool,
  balance,
  allowance,
  symbol,
  onChanged,
}: {
  pool: PoolStats;
  balance: bigint;
  allowance: bigint;
  symbol: string;
  onChanged: () => void;
}) {
  const { address } = useAccount();
  const creditLine = CONTRACTS.creditLine.address;
  const husd = CONTRACTS.husd.address;

  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");

  const depositTx = useTx({ label: "Depositing", onConfirmed: onChanged });
  const approveTx = useTx({ label: "Approving hUSD" });
  const withdrawTx = useTx({ label: "Withdrawing", onConfirmed: onChanged });

  const depositAmount = useMemo(() => parseUsd(depositInput), [depositInput]);
  const withdrawShares = useMemo(() => parseUsd(withdrawInput), [withdrawInput]);

  const totalAssets = pool.totalAssets ?? 0n;
  const totalBorrowed = pool.totalBorrowed ?? 0n;
  const totalShares = pool.totalShares ?? 0n;
  const shares = pool.shares ?? 0n;
  // `totalAssets = idle balance + totalPrincipal`, and `totalBorrowed()` returns
  // that same ex-fee principal — fees are only counted once a borrower repays
  // them. So this subtraction is exactly the cash still sitting in the pool.
  const idle = totalAssets > totalBorrowed ? totalAssets - totalBorrowed : 0n;

  // Share price is `totalAssets / totalShares`; the pool absorbs write-offs, so
  // this is the number that actually moves for a lender.
  const lenderValue = totalShares === 0n ? 0n : (shares * totalAssets) / totalShares;

  const deposit = useCallback(async () => {
    if (!creditLine || !husd || depositAmount === null || depositAmount <= 0n) return;
    if (allowance < depositAmount) {
      const approved = await approveTx.send({
        address: husd,
        abi: husdAbi,
        functionName: "approve",
        args: [creditLine, depositAmount],
        chainId: creditcoinTestnet.id,
      });
      if (!approved) return;
    }
    await depositTx.send({
      address: creditLine,
      abi: creditLineAbi,
      functionName: "deposit",
      args: [depositAmount],
      chainId: creditcoinTestnet.id,
    });
    setDepositInput("");
  }, [allowance, approveTx, creditLine, depositAmount, depositTx, husd]);

  const withdraw = useCallback(async () => {
    if (!creditLine || withdrawShares === null || withdrawShares <= 0n) return;
    await withdrawTx.send({
      address: creditLine,
      abi: creditLineAbi,
      functionName: "withdraw",
      args: [withdrawShares],
      chainId: creditcoinTestnet.id,
    });
    setWithdrawInput("");
  }, [creditLine, withdrawShares, withdrawTx]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LandmarkIcon className="size-4 text-brand-2" />
          Lender pool
        </CardTitle>
        <CardDescription>
          Deposit {symbol} and fund uncollateralised lines. The pool absorbs write-offs, so
          a default reduces every share&rsquo;s value — there is no insurance fund and no
          backstop.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Pool size" value={formatUsd(totalAssets)} hint={symbol} />
          <Stat label="Lent out" value={formatUsd(totalBorrowed)} hint={`${symbol} principal`} />
          <Stat label="Idle" value={formatUsd(idle)} hint="available to borrow" />
          <Stat
            label="Your position"
            value={formatUsd(lenderValue)}
            hint={`${formatUsd(shares)} shares`}
          />
        </dl>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Utilisation</span>
            <span className="font-mono tabular-nums">
              {formatRatio(totalBorrowed, totalAssets === 0n ? 1n : totalAssets)}
            </span>
          </div>
          <Progress
            value={totalAssets === 0n ? 0 : Number((totalBorrowed * 100n) / totalAssets)}
            aria-label="Pool utilisation"
          />
        </div>

        <div className="grid gap-4 border-t border-foreground/10 pt-4 sm:grid-cols-2 sm:gap-6">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void deposit();
            }}
          >
            <Label htmlFor="deposit-amount" className="text-sm font-medium">
              Deposit
            </Label>
            <div className="flex gap-2">
              <Input
                id="deposit-amount"
                inputMode="decimal"
                placeholder="500.00"
                value={depositInput}
                onChange={(e) => setDepositInput(e.target.value)}
                className="font-mono"
                aria-invalid={depositInput !== "" && depositAmount === null}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDepositInput(formatUsd(balance, { group: false }))}
                disabled={balance === 0n}
              >
                Max
              </Button>
            </div>
            <p className="min-h-4 text-xs text-muted-foreground">
              {formatUsd(balance)} {symbol} in this wallet.
            </p>
            <Button
              type="submit"
              disabled={
                !creditLine ||
                !husd ||
                !address ||
                depositTx.isBusy ||
                approveTx.isBusy ||
                depositAmount === null ||
                depositAmount <= 0n
              }
            >
              <PlusIcon />
              {approveTx.isBusy
                ? "Approving…"
                : depositTx.isBusy
                  ? "Depositing…"
                  : depositAmount !== null && allowance < depositAmount
                    ? "Approve and deposit"
                    : "Deposit"}
            </Button>
            {depositTx.error ?? approveTx.error ? (
              <p className="text-xs text-destructive">{depositTx.error ?? approveTx.error}</p>
            ) : null}
          </form>

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void withdraw();
            }}
          >
            <Label htmlFor="withdraw-shares" className="text-sm font-medium">
              Withdraw (shares)
            </Label>
            <div className="flex gap-2">
              <Input
                id="withdraw-shares"
                inputMode="decimal"
                placeholder="500.00"
                value={withdrawInput}
                onChange={(e) => setWithdrawInput(e.target.value)}
                className="font-mono"
                aria-invalid={withdrawInput !== "" && withdrawShares === null}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setWithdrawInput(formatUsd(shares, { group: false }))}
                disabled={shares === 0n}
              >
                All
              </Button>
            </div>
            <p className="min-h-4 text-xs text-muted-foreground">
              Withdrawals are limited by idle liquidity: {formatUsd(idle)} {symbol}.
            </p>
            <Button
              type="submit"
              variant="secondary"
              disabled={
                !creditLine ||
                !address ||
                withdrawTx.isBusy ||
                withdrawShares === null ||
                withdrawShares <= 0n ||
                shares === 0n
              }
            >
              <MinusIcon />
              {withdrawTx.isBusy ? "Withdrawing…" : "Withdraw"}
            </Button>
            {withdrawTx.error ? (
              <p className="text-xs text-destructive">{withdrawTx.error}</p>
            ) : null}
          </form>
        </div>

        <StatRow
          label="Shares outstanding"
          value={totalShares === 0n ? "—" : formatUsd(totalShares)}
          className="border-t border-foreground/10 pt-3"
        />
      </CardContent>
    </Card>
  );
}
