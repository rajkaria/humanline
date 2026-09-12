"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Hex } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { explorerUrl } from "@/lib/chains";
import { describeError } from "@/lib/format";
import { getPublicClient } from "@/lib/public-client";

export type TxPhase = "idle" | "signing" | "pending" | "success" | "error";

/**
 * One transaction, one hook: sign, wait, toast, then hand back the hash.
 *
 * Every write on the site goes through this so the feedback is identical
 * everywhere — a "confirm in your wallet" toast, a pending toast carrying the
 * Blockscout link, and a success or named-revert toast at the end.
 */
export function useTx(options: {
  /** Verb shown in the toasts: "Registering", "Borrowing", … */
  label: string;
  onConfirmed?: (hash: Hex) => void;
}) {
  const { label, onConfirmed } = options;
  const {
    writeContractAsync,
    data: hash,
    reset: resetWrite,
    isPending: isSigning,
  } = useWriteContract();

  const [error, setError] = useState<string | null>(null);
  const toastId = useRef<string | number | null>(null);
  const notified = useRef<Hex | null>(null);

  const receipt = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  useEffect(() => {
    if (!hash) return;
    if (receipt.isLoading) {
      toastId.current = toast.loading(`${label}…`, {
        id: toastId.current ?? undefined,
        description: "Waiting for the transaction to be included on Creditcoin.",
        action: {
          label: "Blockscout",
          onClick: () => window.open(explorerUrl("creditcoin", "tx", hash), "_blank", "noopener"),
        },
      });
      return;
    }
    if (receipt.isSuccess && notified.current !== hash) {
      notified.current = hash;
      toast.success(`${label} confirmed`, {
        id: toastId.current ?? undefined,
        description: "Included on Creditcoin CC3 testnet.",
        action: {
          label: "Blockscout",
          onClick: () => window.open(explorerUrl("creditcoin", "tx", hash), "_blank", "noopener"),
        },
      });
      toastId.current = null;
      onConfirmed?.(hash);
      return;
    }
    if (receipt.isError && notified.current !== hash) {
      notified.current = hash;
      const message = describeError(receipt.error);
      setError(message);
      toast.error(`${label} failed`, {
        id: toastId.current ?? undefined,
        description: message,
      });
      toastId.current = null;
    }
  }, [hash, label, onConfirmed, receipt.error, receipt.isError, receipt.isLoading, receipt.isSuccess]);

  const send = useCallback(
    async (
      // The concrete argument types are checked at each call site by viem's
      // `as const` ABIs; this signature just forwards them through.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request: any,
    ): Promise<Hex | null> => {
      setError(null);
      try {
        return await writeContractAsync(request);
      } catch (cause) {
        const message = describeError(cause);
        setError(message);
        // A user closing their wallet is not an error worth shouting about.
        if (!/user rejected|denied transaction|rejected the request/i.test(message)) {
          toast.error(`${label} failed`, { description: message });
        }
        return null;
      }
    },
    [label, writeContractAsync],
  );

  /**
   * Send, then wait for the receipt before resolving.
   *
   * `send` resolves at *submission*. That is fine for a single write — the
   * component's own `useWaitForTransactionReceipt` drives the toasts — but it is
   * wrong for a two-step flow: firing `repay` the instant `approve` is submitted
   * makes the wallet estimate gas against an allowance that is still short, so
   * MetaMask warns "this transaction is likely to fail" or refuses outright.
   * That is the demo's repay step, so every approve-then-act path awaits this.
   *
   * Resolves `null` when the write was rejected or the transaction reverted, so
   * a caller can simply bail without inspecting a receipt.
   */
  const sendAndWait = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (request: any): Promise<Hex | null> => {
      const sent = await send(request);
      if (!sent) return null;
      try {
        const confirmed = await getPublicClient().waitForTransactionReceipt({
          hash: sent,
          timeout: 120_000,
        });
        if (confirmed.status !== "success") {
          const message = "The transaction reverted on Creditcoin.";
          setError(message);
          toast.error(`${label} failed`, { description: message });
          return null;
        }
        return sent;
      } catch (cause) {
        const message = describeError(cause);
        setError(message);
        toast.error(`${label} failed`, { description: message });
        return null;
      }
    },
    [label, send],
  );

  const reset = useCallback(() => {
    setError(null);
    notified.current = null;
    toastId.current = null;
    resetWrite();
  }, [resetWrite]);

  const phase: TxPhase = error
    ? "error"
    : receipt.isSuccess
      ? "success"
      : hash
        ? "pending"
        : isSigning
          ? "signing"
          : "idle";

  return {
    send,
    sendAndWait,
    reset,
    hash,
    error,
    phase,
    isBusy: isSigning || (Boolean(hash) && receipt.isLoading),
    isSuccess: receipt.isSuccess,
  };
}
