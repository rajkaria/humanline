import type { Metadata } from "next";

import { AppClient } from "@/app/app/app-client";
import { PageHeader, PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Verify and borrow",
  description:
    "Prove you are a human with World ID, then open an uncollateralised credit line on Creditcoin that follows you across wallets.",
};

export default function AppPage() {
  return (
    <PageShell className="pb-24">
      <PageHeader
        eyebrow="Your line"
        title="Verify, then borrow"
        description="One proof binds your World ID nullifier to this wallet. The line that follows belongs to the human, not the key — re-bind to a new wallet and the history comes with you."
      />
      <div className="pt-8">
        <AppClient />
      </div>
    </PageShell>
  );
}
