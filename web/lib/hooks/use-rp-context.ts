"use client";

import { useQuery } from "@tanstack/react-query";
import type { RpContext } from "@worldcoin/idkit";

import { WORLD_ACTION } from "@/lib/contracts";

type RpContextResponse = {
  rp_id?: string;
  nonce?: string;
  created_at?: number;
  expires_at?: number;
  signature?: string;
  error?: string;
  message?: string;
};

/** Thrown by the fetcher so the query's error carries the operator-facing copy. */
class RpContextError extends Error {
  readonly notConfigured: boolean;
  constructor(message: string, notConfigured: boolean) {
    super(message);
    this.name = "RpContextError";
    this.notConfigured = notConfigured;
  }
}

export type RpContextState = {
  rpContext: RpContext | null;
  loading: boolean;
  /** A human-readable reason the request could not be signed. */
  error: string | null;
  /** Distinguishes "the operator has not set the key" from a transient failure. */
  notConfigured: boolean;
  refresh: () => void;
};

/**
 * Fetch a freshly signed `rp_context` from our own route handler.
 *
 * IDKit 4.x will not open a verification without one, and the signature is
 * short-lived (a five-minute TTL), so it is refreshed on a four-minute timer and
 * can be re-fetched on demand before a retry.
 */
export function useRpContext(): RpContextState {
  const query = useQuery({
    queryKey: ["world-rp-context", WORLD_ACTION],
    staleTime: 4 * 60_000,
    refetchInterval: 4 * 60_000,
    retry: (failureCount, error) =>
      // A missing signing key is an operator problem; retrying only hides it.
      !(error instanceof RpContextError && error.notConfigured) && failureCount < 2,
    queryFn: async (): Promise<RpContext> => {
      const response = await fetch("/api/world/rp-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: WORLD_ACTION }),
        cache: "no-store",
      });

      const data = (await response.json().catch(() => ({}))) as RpContextResponse;

      if (!response.ok) {
        throw new RpContextError(
          data.message ?? `Could not sign the proof request (HTTP ${response.status}).`,
          data.error === "rp_signer_not_configured" || data.error === "rp_id_not_configured",
        );
      }

      if (
        !data.rp_id ||
        !data.nonce ||
        !data.signature ||
        typeof data.created_at !== "number" ||
        typeof data.expires_at !== "number"
      ) {
        throw new RpContextError("The proof request signature came back incomplete.", false);
      }

      return {
        rp_id: data.rp_id,
        nonce: data.nonce,
        created_at: data.created_at,
        expires_at: data.expires_at,
        signature: data.signature,
      };
    },
  });

  const error = query.error;

  return {
    rpContext: query.data ?? null,
    loading: query.isPending,
    error: error
      ? error instanceof Error
        ? error.message
        : "Could not reach the proof-request signer."
      : null,
    notConfigured: error instanceof RpContextError && error.notConfigured,
    refresh: () => {
      void query.refetch();
    },
  };
}
