/**
 * The small, testable rules around the scheduled relay route: who may trigger it,
 * how the GitHub Actions backup is dispatched, and when the watchdog speaks up.
 */

import { timingSafeEqual } from "node:crypto";

import type { Health } from "@/lib/relay/stats";

/** A secret shorter than this is treated as unset: a guessable secret is no secret. */
export const MIN_SECRET_LENGTH = 16;

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Constant-time compare,
 * and a missing or weak secret refuses everyone rather than admitting everyone.
 */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authorization);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export type DispatchRequest = { url: string; init: RequestInit };

/**
 * `POST /repos/{repo}/actions/workflows/{workflow}/dispatches`. The token needs
 * `actions: write` on this one repository; a fine-grained PAT scoped that narrowly
 * is the intended credential.
 */
export function dispatchRequest(options: {
  token: string;
  repo: string;
  workflow?: string;
  ref?: string;
  inputs?: Record<string, string>;
}): DispatchRequest {
  const { token, repo, workflow = "relay.yml", ref = "main", inputs = {} } = options;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`bad repo "${repo}"`);
  return {
    url: `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    init: {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref, inputs }),
    },
  };
}

/**
 * Alert once per threshold crossing, not every five minutes. The route is stateless,
 * so "just crossed" is judged from the waiting time: it is inside the most recent
 * cron interval past the SLO (late) or past the stall threshold (stalled).
 */
export function shouldAlert(
  health: Pick<Health, "status" | "waitingSec">,
  { intervalSec = 300, sloSec = 600, stallSec = 3_600 }: { intervalSec?: number; sloSec?: number; stallSec?: number } = {},
): boolean {
  if (health.status === "late") return health.waitingSec - sloSec <= intervalSec;
  if (health.status === "stalled") return health.waitingSec - stallSec <= intervalSec;
  return false;
}
