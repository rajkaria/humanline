"use client";

import { ArrowRightLeftIcon, HistoryIcon, Link2Icon, Loader2Icon, SendIcon, SignatureIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { erc20Abi, getAddress, type Address, type Hex } from "viem";
import { useAccount, useSendTransaction, useSignTypedData, useSwitchChain, useWriteContract } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

import { CopyButton } from "@/components/copy-button";
import { StatRow } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { creditHistoryAbi, ethRepayAbi, humanLinksAbi } from "@/lib/abi";
import { SOURCE_CHAINS, creditcoinTestnet, explorerUrl, type SourceChainKey } from "@/lib/chains";
import { dryRun, fetchSourceProof } from "@/lib/crosschain/client";
import {
  REPAY_STABLECOINS,
  classifyRepayTransfer,
  decodeTxBytes,
  linkIntentData,
  linkTypedData,
  logIdOf,
  parseLinkIntent,
  queryIdOf,
  type AaveEvent,
  type HistoryPair,
} from "@/lib/crosschain/core";
import { describeError, formatUnits, formatUsd, isTxHash, parseUnits, truncateAddress } from "@/lib/format";
import { useCrossChain } from "@/lib/hooks/use-cross-chain";
import { useTx } from "@/lib/hooks/use-tx";
import { getPublicClient } from "@/lib/public-client";
import { txIndexFromSiblings } from "@/lib/relay/proof";

const EVM_CHAIN = { 1: sepolia.id, 3: mainnet.id } as const;

/**
 * One human, their Ethereum wallets, their Aave record, and repayments from Ethereum.
 *
 * Three flows, each ending in a Creditcoin transaction whose inputs are an Attestcoin proof:
 *   - Link: a self-send carrying the link intent (proved) or an EIP-712 signature (free).
 *   - History: prove an Aave V3 borrow, then its repayment; the verified dollars raise the limit.
 *   - Repay: send USDC to the repayment address on Ethereum, prove it, the line is repaid here.
 * Every Creditcoin write is dry-run first so a named revert is shown instead of a failed signature.
 */
export function CrossChainPanel({ human, owed, onChanged }: { human: bigint; owed: bigint; onChanged: () => void }) {
  const x = useCrossChain(human);
  const refresh = useCallback(() => {
    void x.refetch();
    onChanged();
  }, [onChanged, x]);

  if (!x.deployed) {
    return (
      <Card data-testid="cross-chain">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeftIcon className="size-4" aria-hidden /> Your Ethereum history
          </CardTitle>
          <CardDescription>
            Wallet links, Aave history and repayments from Ethereum arrive with CreditLine v3. This profile has not been
            upgraded yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-testid="cross-chain">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowRightLeftIcon className="size-4" aria-hidden /> Your Ethereum history
        </CardTitle>
        <CardDescription>
          Link Ethereum wallets to this human, import proven Aave repayments to raise your limit, and repay from
          Ethereum. Each step is an Attestcoin proof that Creditcoin checks, not a claim.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-xl bg-muted/30 px-4 py-2 ring-1 ring-foreground/10">
          <StatRow
            label="Linked wallets"
            value={`${x.linked.length} / ${x.maxLinks?.toString() ?? "8"}`}
            loading={x.isLoading}
          />
          <StatRow
            label="Verified Aave repayments"
            value={`${formatUsd(x.repaidUsd ?? 0n)} hUSD · ${x.repayments ?? 0}`}
            loading={x.isLoading}
          />
          <StatRow
            label={`Limit boost (${x.boostBps !== undefined ? Number(x.boostBps) / 100 : 25}% of repaid, cap ${formatUsd(x.maxBoost ?? 0n)})`}
            value={`+${formatUsd(x.boost ?? 0n)} hUSD`}
            loading={x.isLoading}
          />
          {x.linked.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 py-1.5" data-testid="linked-wallets">
              {x.linked.map((w) => (
                <li key={w}>
                  <Badge variant="outline" className="font-mono">
                    {truncateAddress(w)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <Tabs defaultValue="link">
          <TabsList>
            <TabsTrigger value="link">
              <Link2Icon aria-hidden /> Link
            </TabsTrigger>
            <TabsTrigger value="history">
              <HistoryIcon aria-hidden /> Aave history
            </TabsTrigger>
            <TabsTrigger value="repay">
              <SendIcon aria-hidden /> Repay from Ethereum
            </TabsTrigger>
          </TabsList>
          <TabsContent value="link" className="pt-3">
            <LinkFlow human={human} links={x.links!} humanWallet={x.humanWallet} onLinked={refresh} />
          </TabsContent>
          <TabsContent value="history" className="pt-3">
            <HistoryFlow
              history={x.history!}
              linked={x.linked}
              humanWallet={x.humanWallet}
              minGapBlocks={Number(x.minGapBlocks ?? 7200n)}
              onImported={refresh}
            />
          </TabsContent>
          <TabsContent value="repay" className="pt-3">
            <RepayFlow
              repay={x.repay!}
              repayAddress={x.repayAddress}
              reserve={x.reserve}
              overpaid={x.overpaid}
              owed={owed}
              linked={x.linked}
              humanWallet={x.humanWallet}
              onCredited={refresh}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ shared

function useCreditcoinSender() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  return useCallback(
    async (expected: Address | undefined): Promise<Address> => {
      if (!address) throw new Error("Connect a wallet first.");
      if (expected && getAddress(address) !== getAddress(expected)) {
        throw new Error(`Switch your wallet back to your Humanline account ${truncateAddress(expected)} to submit.`);
      }
      if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id });
      return address;
    },
    [address, chainId, switchChainAsync],
  );
}

function ChainPicker({ value, onChange }: { value: SourceChainKey; onChange: (k: SourceChainKey) => void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Source chain">
      {([1, 3] as const).map((k) => (
        <Button
          key={k}
          size="sm"
          variant={value === k ? "default" : "outline"}
          onClick={() => onChange(k)}
          role="radio"
          aria-checked={value === k}
        >
          {SOURCE_CHAINS[k].label}
        </Button>
      ))}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Status({ busy, error, note }: { busy?: string | null; error?: string | null; note?: string | null }) {
  if (busy)
    return (
      <p className="flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
        <Loader2Icon className="size-3 animate-spin" aria-hidden /> {busy}
      </p>
    );
  if (error)
    return (
      <p className="text-xs text-destructive" role="alert">
        {error}
      </p>
    );
  if (note) return <p className="text-xs text-success">{note}</p>;
  return null;
}

// ------------------------------------------------------------------------------------------ link

function LinkFlow({
  human,
  links,
  humanWallet,
  onLinked,
}: {
  human: bigint;
  links: Address;
  humanWallet: Address | undefined;
  onLinked: () => void;
}) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const toCreditcoin = useCreditcoinSender();
  const tx = useTx({ label: "Linking your wallet", onConfirmed: onLinked });

  const [mode, setMode] = useState<"signature" | "proof">("signature");
  const [chainKey, setChainKey] = useState<SourceChainKey>(1);
  const [draft, setDraft] = useState<{ wallet: Address; deadline: bigint; signature: Hex } | null>(null);
  const [linkTx, setLinkTx] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intent =
    humanWallet !== undefined
      ? linkIntentData({ human, creditcoinWallet: humanWallet, creditcoinChainId: creditcoinTestnet.id, links })
      : undefined;

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const sign = () =>
    run("Sign the link in your wallet…", async () => {
      if (!address || !humanWallet) throw new Error("Connect the wallet you want to link.");
      await toCreditcoin(undefined); // the EIP-712 domain is Creditcoin's chain id
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const typed = linkTypedData({ links, chainId: creditcoinTestnet.id, human, creditcoinWallet: humanWallet, wallet: address, deadline });
      const signature = await signTypedDataAsync(typed);
      setDraft({ wallet: address, deadline, signature });
    });

  const submitSignature = () =>
    run("Checking the link on Creditcoin…", async () => {
      if (!draft) return;
      const account = await toCreditcoin(humanWallet);
      const request = { address: links, abi: humanLinksAbi, functionName: "linkBySignature", args: [draft.wallet, draft.deadline, draft.signature] } as const;
      const reason = await dryRun({ account, ...request });
      if (reason) throw new Error(reason);
      if (await tx.sendAndWait({ ...request, chainId: creditcoinTestnet.id })) setDraft(null);
    });

  const sendIntent = () =>
    run(`Send the link transaction on ${SOURCE_CHAINS[chainKey].label}…`, async () => {
      if (!address || !intent) throw new Error("Connect the wallet you want to link.");
      await switchChainAsync({ chainId: EVM_CHAIN[chainKey] });
      const hash = await sendTransactionAsync({ to: address, data: intent, value: 0n, chainId: EVM_CHAIN[chainKey] });
      setLinkTx(hash);
    });

  const proveIntent = () =>
    run("Fetching the Attestcoin proof…", async () => {
      if (!isTxHash(linkTx)) throw new Error("Paste the link transaction hash.");
      const proof = await fetchSourceProof(chainKey, linkTx as Hex);
      const decoded = decodeTxBytes(proof.encodedTransaction);
      if (decoded.to !== decoded.from) throw new Error("That transaction is not a self-send, so it cannot link a wallet.");
      const parsed = parseLinkIntent(decoded.data);
      if (!parsed || parsed.human !== human || parsed.links.toLowerCase() !== links.toLowerCase()) {
        throw new Error("That transaction does not carry this human's link intent for this deployment.");
      }
      const account = await toCreditcoin(humanWallet);
      const request = { address: links, abi: humanLinksAbi, functionName: "linkBySourceTx", args: [proof] } as const;
      setBusy("Dry-running on Creditcoin…");
      const reason = await dryRun({ account, ...request });
      if (reason) throw new Error(reason);
      setBusy(null);
      await tx.sendAndWait({ ...request, chainId: creditcoinTestnet.id });
    });

  return (
    <div className="flex flex-col gap-4" data-testid="link-flow">
      <div className="flex gap-1.5">
        <Button size="sm" variant={mode === "signature" ? "default" : "outline"} onClick={() => setMode("signature")}>
          <SignatureIcon aria-hidden /> Signature (free)
        </Button>
        <Button size="sm" variant={mode === "proof" ? "default" : "outline"} onClick={() => setMode("proof")}>
          <Link2Icon aria-hidden /> Ethereum transaction (Attestcoin)
        </Button>
      </div>

      {mode === "signature" ? (
        <>
          <Step n={1} title="Switch your wallet to the account you want to link, then sign">
            <p className="text-xs text-muted-foreground">
              An EIP-712 message naming this human, your Humanline account and a one-hour deadline. It proves you hold the
              key and costs nothing.
            </p>
            <Button size="sm" className="self-start" onClick={sign} disabled={Boolean(busy) || !address}>
              <SignatureIcon aria-hidden /> Sign with {address ? truncateAddress(address) : "the connected account"}
            </Button>
          </Step>
          <Step n={2} title={`Switch back to ${humanWallet ? truncateAddress(humanWallet) : "your Humanline account"} and link`}>
            {draft ? (
              <p className="text-xs text-muted-foreground">Signed by {truncateAddress(draft.wallet)}.</p>
            ) : null}
            <Button size="sm" className="self-start" onClick={submitSignature} disabled={!draft || Boolean(busy) || tx.isBusy}>
              <Link2Icon aria-hidden /> Link {draft ? truncateAddress(draft.wallet) : "the signed wallet"}
            </Button>
          </Step>
        </>
      ) : (
        <>
          <ChainPicker value={chainKey} onChange={setChainKey} />
          <Step n={1} title={`From the wallet to link, send yourself a zero-value transaction on ${SOURCE_CHAINS[chainKey].name}`}>
            <p className="text-xs text-muted-foreground">
              Its calldata is the link intent: this human, your Humanline account, Creditcoin&rsquo;s chain id and this
              contract. Nothing else can be read into it.
            </p>
            {intent ? (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{intent}</code>
                <CopyButton value={intent} />
              </div>
            ) : null}
            <Button size="sm" className="self-start" onClick={sendIntent} disabled={Boolean(busy) || !intent}>
              <SendIcon aria-hidden /> Send on {SOURCE_CHAINS[chainKey].label}
            </Button>
          </Step>
          <Step n={2} title="Once it is attested (about 15 minutes), prove it from your Humanline account">
            <Label htmlFor="link-tx" className="text-xs">
              Link transaction hash
            </Label>
            <Input id="link-tx" placeholder="0x…" value={linkTx} onChange={(e) => setLinkTx(e.target.value.trim())} />
            {isTxHash(linkTx) ? (
              <a
                className="text-xs text-brand underline-offset-4 hover:underline"
                href={`${SOURCE_CHAINS[chainKey].explorer}/tx/${linkTx}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                View on {SOURCE_CHAINS[chainKey].label} explorer
              </a>
            ) : null}
            <Button size="sm" className="self-start" onClick={proveIntent} disabled={Boolean(busy) || tx.isBusy || !isTxHash(linkTx)}>
              <Link2Icon aria-hidden /> Prove and link
            </Button>
          </Step>
        </>
      )}
      <Status busy={busy} error={error ?? tx.error} note={tx.isSuccess ? "Linked on Creditcoin." : null} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ history

type HistoryResponse = {
  events: Array<Omit<AaveEvent, "amount"> & { amount: string }>;
  pairs: Array<{ borrow: HistoryPair["borrow"] & { amount: string }; repay: HistoryPair["repay"] & { amount: string }; credited: string; creditedUsd: string }>;
  fromBlock: number;
  head: number;
};

function HistoryFlow({
  history,
  linked,
  humanWallet,
  minGapBlocks,
  onImported,
}: {
  history: Address;
  linked: readonly Address[];
  humanWallet: Address | undefined;
  minGapBlocks: number;
  onImported: () => void;
}) {
  const toCreditcoin = useCreditcoinSender();
  const tx = useTx({ label: "Importing Aave history", onConfirmed: onImported });
  const [chainKey, setChainKey] = useState<SourceChainKey>(1);
  const [wallet, setWallet] = useState<Address | undefined>(linked[0]);
  const [scan, setScan] = useState<HistoryResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const target = wallet ?? linked[0];

  const find = async () => {
    if (!target) return;
    setError(null);
    setBusy("Scanning Aave V3 on the source chain…");
    try {
      const res = await fetch(`/api/crosschain/history?chainKey=${chainKey}&wallet=${target}&minGapBlocks=${minGapBlocks}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      setScan(body as HistoryResponse);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const importPair = async (pair: HistoryResponse["pairs"][number]) => {
    setError(null);
    try {
      const account = await toCreditcoin(humanWallet);
      const client = getPublicClient();

      setBusy("Fetching the borrow proof…");
      const borrowProof = await fetchSourceProof(chainKey, pair.borrow.txHash);
      const borrowId = logIdOf(
        queryIdOf(chainKey, borrowProof.blockHeight, txIndexFromSiblings(borrowProof.merkleProof.siblings)),
        pair.borrow.logIndex,
      );
      const borrowKnown = await client.readContract({ address: history, abi: creditHistoryAbi, functionName: "consumed", args: [borrowId] });
      if (!borrowKnown) {
        const request = { address: history, abi: creditHistoryAbi, functionName: "proveBorrow", args: [borrowProof, BigInt(pair.borrow.logIndex)] } as const;
        setBusy("Dry-running the borrow proof…");
        const reason = await dryRun({ account, ...request });
        if (reason) throw new Error(reason);
        setBusy("Confirm the borrow proof in your wallet…");
        if (!(await tx.sendAndWait({ ...request, chainId: creditcoinTestnet.id }))) return;
      }

      setBusy("Fetching the repayment proof…");
      const repayProof = await fetchSourceProof(chainKey, pair.repay.txHash);
      const request = { address: history, abi: creditHistoryAbi, functionName: "proveRepay", args: [repayProof, BigInt(pair.repay.logIndex), borrowId] } as const;
      setBusy("Dry-running the repayment proof…");
      const reason = await dryRun({ account, ...request });
      if (reason) throw new Error(reason);
      setBusy("Confirm the repayment proof in your wallet…");
      if (await tx.sendAndWait({ ...request, chainId: creditcoinTestnet.id })) {
        setDone((d) => new Set(d).add(`${pair.repay.txHash}:${pair.repay.logIndex}`));
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  if (linked.length === 0) {
    return <p className="text-sm text-muted-foreground">Link an Ethereum wallet first: only linked wallets&rsquo; history counts.</p>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="history-flow">
      <p className="text-xs text-muted-foreground">
        A repayment counts when it follows a proven borrow from the same wallet and reserve at least {minGapBlocks.toLocaleString()} blocks
        earlier, was paid by the borrower with real tokens, and is in USDC, USDT or DAI. Each log counts once.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ChainPicker value={chainKey} onChange={setChainKey} />
        <select
          className="h-8 rounded-md border bg-background px-2 font-mono text-xs"
          value={target}
          onChange={(e) => setWallet(e.target.value as Address)}
          aria-label="Linked wallet"
        >
          {linked.map((w) => (
            <option key={w} value={w}>
              {truncateAddress(w)}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={find} disabled={Boolean(busy)}>
          <HistoryIcon aria-hidden /> Find history
        </Button>
      </div>

      {scan ? (
        scan.pairs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No creditable borrow → repayment pairs in blocks {scan.fromBlock.toLocaleString()}–{scan.head.toLocaleString()} (
            {scan.events.length} Aave events seen).
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {scan.pairs.map((p) => {
              const key = `${p.repay.txHash}:${p.repay.logIndex}`;
              const decimals = p.repay.token?.decimals ?? 6;
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-foreground/10">
                  <span className="text-xs">
                    Borrowed {formatUnits(BigInt(p.borrow.amount), decimals)} {p.borrow.token?.symbol} at block{" "}
                    {p.borrow.blockNumber.toLocaleString()} → repaid {formatUnits(BigInt(p.repay.amount), decimals)} at{" "}
                    {p.repay.blockNumber.toLocaleString()} · counts ${formatUsd(BigInt(p.creditedUsd))}
                  </span>
                  <Button size="sm" onClick={() => importPair(p)} disabled={Boolean(busy) || tx.isBusy || done.has(key)}>
                    {done.has(key) ? "Imported" : "Prove and import"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      <Status busy={busy} error={error ?? tx.error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ repay

function RepayFlow({
  repay,
  repayAddress,
  reserve,
  overpaid,
  owed,
  linked,
  humanWallet,
  onCredited,
}: {
  repay: Address;
  repayAddress: Address | undefined;
  reserve: bigint | undefined;
  overpaid: bigint | undefined;
  owed: bigint;
  linked: readonly Address[];
  humanWallet: Address | undefined;
  onCredited: () => void;
}) {
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const toCreditcoin = useCreditcoinSender();
  const tx = useTx({ label: "Crediting your Ethereum repayment", onConfirmed: onCredited });

  const [chainKey, setChainKey] = useState<SourceChainKey>(1);
  const [amount, setAmount] = useState("");
  const [paymentTx, setPaymentTx] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = REPAY_STABLECOINS[chainKey];
  const isLinked = Boolean(address && linked.some((w) => w.toLowerCase() === address.toLowerCase()));

  const send = async () => {
    setError(null);
    const value = parseUnits(amount, token.decimals);
    if (!repayAddress || value === null || value <= 0n) return setError("Enter an amount.");
    if (!isLinked) return setError("Send from a wallet linked to this human; payments from unlinked wallets cannot be credited.");
    setBusy(`Send ${token.symbol} on ${SOURCE_CHAINS[chainKey].label}…`);
    try {
      await switchChainAsync({ chainId: EVM_CHAIN[chainKey] });
      const hash = await writeContractAsync({
        address: token.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [repayAddress, value],
        chainId: EVM_CHAIN[chainKey],
      });
      setPaymentTx(hash);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const credit = async () => {
    setError(null);
    try {
      if (!isTxHash(paymentTx) || !repayAddress) throw new Error("Paste the payment transaction hash.");
      setBusy("Fetching the Attestcoin proof…");
      const proof = await fetchSourceProof(chainKey, paymentTx as Hex);
      const logs = decodeTxBytes(proof.encodedTransaction).logs;
      const logIndex = logs.findIndex((log, i) =>
        classifyRepayTransfer(chainKey, log, repayAddress, { txHash: paymentTx as Hex, blockNumber: 0, logIndex: i }),
      );
      if (logIndex < 0) throw new Error(`That transaction has no ${token.symbol} transfer to the repayment address.`);
      const account = await toCreditcoin(humanWallet);
      const request = { address: repay, abi: ethRepayAbi, functionName: "creditRepayment", args: [proof, BigInt(logIndex)] } as const;
      setBusy("Dry-running on Creditcoin…");
      const reason = await dryRun({ account, ...request });
      if (reason) throw new Error(reason);
      setBusy(null);
      await tx.sendAndWait({ ...request, chainId: creditcoinTestnet.id });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="repay-flow">
      <div className="rounded-xl bg-muted/30 px-4 py-2 ring-1 ring-foreground/10">
        <StatRow label="You owe on Creditcoin" value={`${formatUsd(owed)} hUSD`} />
        <StatRow
          label="Repayment address (Ethereum and Sepolia)"
          value={
            repayAddress ? (
              <span className="flex items-center gap-1">
                {truncateAddress(repayAddress)} <CopyButton value={repayAddress} />
              </span>
            ) : (
              "…"
            )
          }
        />
        <StatRow label="Settlement float" value={`${formatUsd(reserve ?? 0n)} hUSD`} />
        {overpaid && overpaid > 0n ? <StatRow label="Overpaid, owed back to you" value={`${formatUsd(overpaid)} hUSD`} /> : null}
      </div>
      <ChainPicker value={chainKey} onChange={setChainKey} />
      <Step n={1} title={`From a linked wallet, send ${token.symbol} to the repayment address on ${SOURCE_CHAINS[chainKey].name}`}>
        <div className="flex gap-2">
          <Input inputMode="decimal" placeholder={`Amount in ${token.symbol}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button size="sm" onClick={send} disabled={Boolean(busy)}>
            <SendIcon aria-hidden /> Send
          </Button>
        </div>
        {address && !isLinked ? (
          <p className="text-xs text-warning">{truncateAddress(address)} is not linked to this human yet.</p>
        ) : null}
      </Step>
      <Step n={2} title="Once it is attested (about 15 minutes), credit it on Creditcoin">
        <Input placeholder="Payment transaction hash 0x…" value={paymentTx} onChange={(e) => setPaymentTx(e.target.value.trim())} />
        {isTxHash(paymentTx) ? (
          <a
            className="text-xs text-brand underline-offset-4 hover:underline"
            href={`${SOURCE_CHAINS[chainKey].explorer}/tx/${paymentTx}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            View on {SOURCE_CHAINS[chainKey].label} explorer
          </a>
        ) : null}
        <Button size="sm" className="self-start" onClick={credit} disabled={Boolean(busy) || tx.isBusy || !isTxHash(paymentTx)}>
          <ArrowRightLeftIcon aria-hidden /> Prove and repay
        </Button>
      </Step>
      <Status
        busy={busy}
        error={error ?? tx.error}
        note={tx.isSuccess && tx.hash ? `Repaid on Creditcoin: ${explorerUrl("creditcoin", "tx", tx.hash)}` : null}
      />
    </div>
  );
}
