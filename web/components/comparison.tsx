import { CheckIcon, XIcon } from "lucide-react";

const ROWS: Array<{
  question: string;
  passport: string;
  humanline: string;
}> = [
  {
    question: "What is the identity?",
    passport: "A wallet address. Ten wallets, ten identities.",
    humanline: "A World ID nullifier. One human, one identity, forever.",
  },
  {
    question: "Can a sybil farm forge the history?",
    passport: "Yes. Open ten wallets, repay yourself ten times, mint ten perfect scores.",
    humanline:
      "No. The nullifier is derived from an Orb-verified identity, and the tree has one leaf per person.",
  },
  {
    question: "What happens after a default?",
    passport: "Generate a new key and start again with a clean score.",
    humanline: "The line freezes on every wallet the human ever binds. The history follows the person.",
  },
  {
    question: "How does off-chain truth arrive?",
    passport: "A trusted bridge, a trusted oracle, or an off-chain scorer with an API key.",
    humanline:
      "An Attestcoin proof of the real Ethereum transaction, verified by the 0x0FD2 precompile inside the same call.",
  },
  {
    question: "Who has to be trusted?",
    passport: "The scorer, the bridge operator, or the team holding the admin key.",
    humanline: "Nobody. No admin keys, no pause, no upgradeability. And anyone can run the relayer.",
  },
  {
    question: "Where is the proof checked?",
    passport: "Usually off-chain, then asserted on-chain by a privileged signer.",
    humanline:
      "On Creditcoin. Semaphore Groth16 over the bn128 precompiles, against an Attestcoin-anchored root.",
  },
];

/**
 * The knock-out slide, per `docs/SPEC.md` §3: every other credit passport in the
 * field can be forged by creating a new wallet. Ours cannot.
 */
export function ComparisonBlock() {
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-foreground/10">
      <div className="grid grid-cols-1 divide-y divide-foreground/10 md:grid-cols-[1.1fr_1fr_1fr] md:divide-x md:divide-y-0">
        <div className="hidden bg-card/30 p-4 md:block" aria-hidden />
        <div className="flex items-center gap-2 bg-card/30 p-4">
          <XIcon className="size-4 shrink-0 text-destructive" aria-hidden />
          <span className="text-sm font-semibold">Wallet-based credit passports</span>
        </div>
        <div className="flex items-center gap-2 bg-brand/10 p-4">
          <CheckIcon className="size-4 shrink-0 text-brand" aria-hidden />
          <span className="text-sm font-semibold">Humanline</span>
        </div>
      </div>

      <div className="divide-y divide-foreground/10 border-t border-foreground/10">
        {ROWS.map((row) => (
          <div
            key={row.question}
            className="grid grid-cols-1 gap-1 p-4 md:grid-cols-[1.1fr_1fr_1fr] md:gap-0 md:divide-x md:divide-foreground/10 md:p-0"
          >
            <div className="text-sm font-medium text-foreground md:p-4">{row.question}</div>
            <div className="flex gap-2 text-sm text-muted-foreground md:p-4">
              <XIcon className="mt-0.5 size-3.5 shrink-0 text-destructive/70 md:hidden" aria-hidden />
              <span>{row.passport}</span>
            </div>
            <div className="flex gap-2 bg-brand/[0.04] text-sm text-foreground/90 md:p-4">
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-brand md:hidden" aria-hidden />
              <span>{row.humanline}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
