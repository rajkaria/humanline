"use client";

import { useSyncExternalStore } from "react";

/** Never notifies: "have we hydrated" changes exactly once, at hydration. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` during server render and the hydrating pass, `true` afterwards.
 *
 * Wallet state (`useAccount`, `useConnect`) only exists in the browser, so the
 * components that show it must render a neutral placeholder until hydration is
 * done or React reports a mismatch. `useSyncExternalStore` is the sanctioned way
 * to express that — a `useEffect` that calls `setState(true)` does the same
 * thing with an extra render and trips `react-hooks/set-state-in-effect`.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
