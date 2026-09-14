"use client";

import { SelfRelayPanel } from "@/components/self-relay-panel";
import { RelayWaitPanel, VerifySteps, WrongTreePanel } from "@/components/verify-card";
import { PROFILES } from "@/lib/profiles";
import type { RelayPlan, TreeChange } from "@/lib/relay/plan";

const change = (n: number, block: number): TreeChange => ({
  txHash: `0x${n.toString(16).padStart(64, "0")}`,
  blockNumber: block,
  txIndex: n,
  logIndex: n,
  preRoot: BigInt(n),
  postRoot: BigInt(n + 1),
  kind: 0,
});

const chain = [change(1, 11_690_661), change(2, 11_690_948)];
const shared = {
  chain,
  batches: [{ changes: chain, fromBlock: 11_690_661, toBlock: 11_690_948, final: true }],
  needHeight: 11_690_980,
};

const READY: RelayPlan = { status: "ready", ...shared, attestedTip: 11_691_000, blocksToGo: 0, etaSeconds: 0 };
const WAITING: RelayPlan = {
  status: "waiting",
  ...shared,
  batches: [{ ...shared.batches[0]!, final: false }],
  attestedTip: 11_690_960,
  blocksToGo: 20,
  etaSeconds: 240,
};
const STALE: RelayPlan = {
  status: "stale",
  reason:
    "This proof was made against a root older than the one Creditcoin already follows, and that root has expired or was never carried across. Generate a fresh proof: it will use the newest root.",
};

/** Captured once at module load so render stays pure. */
const RECEIVED_AT = Math.floor(Date.now() / 1000) - 95;

const base = {
  planLoading: false,
  planError: null,
  progress: null,
  txUrls: [] as string[],
  error: null,
  busy: false,
  canSend: true,
  sourceLabel: "Ethereum Sepolia",
  onRelay: () => undefined,
};

export function SelfRelayPreview() {
  const cases: Array<{ title: string; props: Parameters<typeof SelfRelayPanel>[0] }> = [
    { title: "Loading", props: { ...base, plan: undefined, planLoading: true, phase: "idle" } },
    { title: "Waiting on attestation", props: { ...base, plan: WAITING, phase: "idle" } },
    { title: "Ready", props: { ...base, plan: READY, phase: "idle" } },
    {
      title: "Signing",
      props: { ...base, plan: READY, phase: "signing", busy: true, progress: { batch: 1, of: 2 } },
    },
    {
      title: "Error",
      props: { ...base, plan: READY, phase: "error", error: "Creditcoin would refuse this relay: NotFinal" },
    },
    {
      title: "Done",
      props: {
        ...base,
        plan: READY,
        phase: "done",
        txUrls: ["https://creditcoin-testnet.blockscout.com/tx/0xabc"],
      },
    },
    { title: "Stale proof", props: { ...base, plan: STALE, phase: "idle" } },
  ];

  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-2">
      {cases.map((c) => (
        <section key={c.title} className="flex flex-col gap-2" data-case={c.title}>
          <h2 className="text-sm font-semibold">{c.title}</h2>
          <div className="flex flex-col gap-4 rounded-xl border p-4">
            <VerifySteps states={["done", "working", "upcoming"]} />
            <RelayWaitPanel receivedAt={RECEIVED_AT} onCheck={async () => undefined}>
              <SelfRelayPanel {...c.props} />
            </RelayWaitPanel>
          </div>
        </section>
      ))}
      <section className="flex flex-col gap-2" data-case="Wrong tree">
        <h2 className="text-sm font-semibold">World App proof on the staging profile</h2>
        <div className="flex flex-col gap-4 rounded-xl border p-4">
          <VerifySteps states={["done", "working", "upcoming"]} />
          <WrongTreePanel
            target={PROFILES.production}
            reason="This proof comes from World's Orb tree (World App), but this profile verifies against the staging tree on Ethereum Sepolia. Switch to the Orb profile: the same proof works there, no need to scan again."
            onSwitch={() => undefined}
          />
        </div>
      </section>
    </main>
  );
}
