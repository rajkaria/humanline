import type { Metadata } from "next";
import { Suspense } from "react";

import { AppClient } from "@/app/app/app-client";
import { ProfileProvider } from "@/lib/profile-context";
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
        description="One proof binds your World ID nullifier to this wallet. The line that follows belongs to you, the human, not to the key. Move to a new wallet and your history comes with you."
      />
      <div className="pt-8">
        {/* ProfileProvider reads `?profile=`, which makes this subtree client-dynamic;
            the Suspense boundary keeps the rest of the page statically rendered. */}
        <Suspense fallback={null}>
          <ProfileProvider>
            <AppClient />
          </ProfileProvider>
        </Suspense>
      </div>
    </PageShell>
  );
}
