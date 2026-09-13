import type { Metadata } from "next";

import { VotePanel } from "@/components/vote-panel";
import { PageHeader, PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Vote",
  description: "One person, one vote on Creditcoin. Verified World ID humans open polls and cast exactly one ballot each, whatever wallet they use.",
};

export default function VotePage() {
  return (
    <PageShell className="flex flex-col gap-8 pb-24">
      <PageHeader
        eyebrow="Built on @humanline/sdk"
        title="One person, one vote"
        description="A poll that a wallet farm cannot stuff. HumanPoll is a separate contract that only inherits the SDK's HumanGated modifier: every verified human gets one ballot per poll, and moving to a new wallet does not buy a second one."
      />
      <VotePanel />
    </PageShell>
  );
}
