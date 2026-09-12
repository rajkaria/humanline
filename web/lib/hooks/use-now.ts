"use client";

import { useSyncExternalStore } from "react";

/**
 * A shared one-second clock, exposed as an external store.
 *
 * The wall clock genuinely is an external system, so `useSyncExternalStore` is
 * the right primitive: the snapshot is cached between ticks (returning a fresh
 * `Date.now()` on every read would make React re-render forever), one interval
 * is shared by every subscriber, and it stops when the last one unmounts.
 *
 * `getServerSnapshot` returns 0, which callers treat as "not known yet" — that
 * is what keeps a live countdown from producing a hydration mismatch.
 */
type Clock = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => number;
};

function createClock(intervalMs: number): Clock {
  let snapshot = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();

  const tick = () => {
    const next = Math.floor(Date.now() / 1000);
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (timer === undefined) {
        tick();
        timer = setInterval(tick, intervalMs);
      } else if (snapshot === 0) {
        tick();
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    getSnapshot: () => snapshot,
  };
}

const clocks = new Map<number, Clock>();

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = createClock(intervalMs);
    clocks.set(intervalMs, clock);
  }
  return clock;
}

const getServerSnapshot = () => 0;

/** Current unix seconds, updating on a shared timer. `0` before hydration. */
export function useNow(intervalMs = 1000): number {
  const clock = clockFor(intervalMs);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, getServerSnapshot);
}
