/**
 * `useHuman` — the React hook for "is this wallet a verified human, and what can they borrow".
 *
 * No wagmi requirement: it takes an address (from whatever wallet library you use) and reads through
 * a viem client, defaulting to a public CC3 testnet client.
 *
 *     import { useHuman } from "@humanline/sdk/react";
 *     const { isHuman, human, line, loading } = useHuman(address);
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";

import { createHumanlineClient, profileOf, type HumanProfile, type ReadOptions, type Reader } from "./index";

export type UseHumanOptions = ReadOptions & {
  client?: Reader;
  /** Re-read every `refreshMs` milliseconds; off by default. */
  refreshMs?: number;
};

export type UseHumanResult = {
  loading: boolean;
  error?: Error;
  isHuman: boolean;
  human: bigint;
  registeredAt: bigint;
  line?: HumanProfile["line"];
  refresh: () => void;
};

let sharedClient: Reader | undefined;
const defaultClient = () => (sharedClient ??= createHumanlineClient());

export function useHuman(wallet: Address | undefined, options: UseHumanOptions = {}): UseHumanResult {
  const { client, refreshMs, profile, deployment } = options;
  const reader = useMemo(() => client ?? defaultClient(), [client]);
  const [state, setState] = useState<{ loading: boolean; error?: Error; data?: HumanProfile }>({ loading: Boolean(wallet) });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const latest = useRef(0);

  useEffect(() => {
    if (!wallet) {
      setState({ loading: false });
      return;
    }
    const call = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    profileOf(reader, wallet, { profile, deployment })
      .then((data) => {
        if (call === latest.current) setState({ loading: false, data });
      })
      .catch((error: unknown) => {
        if (call === latest.current) setState({ loading: false, error: error instanceof Error ? error : new Error(String(error)) });
      });
  }, [wallet, reader, profile, deployment, tick]);

  useEffect(() => {
    if (!refreshMs || !wallet) return;
    const id = setInterval(refresh, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, wallet, refresh]);

  return {
    loading: state.loading,
    error: state.error,
    isHuman: state.data?.isHuman ?? false,
    human: state.data?.human ?? 0n,
    registeredAt: state.data?.registeredAt ?? 0n,
    line: state.data?.line,
    refresh,
  };
}
