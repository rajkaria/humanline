import type { Metadata } from "next";

import { RelayClient } from "@/app/relay/relay-client";
import { PageHeader, PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Root relay",
  description:
    "Live feed of real World ID roots arriving on Creditcoin through the Attestcoin Protocol, from Ethereum mainnet and Sepolia staging.",
};

export default function RelayPage() {
  return (
    <PageShell width="wide" className="pb-24">
      <PageHeader
        eyebrow="Attestcoin"
        title="Root relay"
        description="Every row is a real transaction on Ethereum, proven to Creditcoin by the 0x0FD2 precompile. No bridge signed it, no oracle reported it, and the next one can come from anyone. Including you."
      />
      <div className="pt-8">
        <RelayClient />
      </div>
    </PageShell>
  );
}
