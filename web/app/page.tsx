import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  FingerprintIcon,
  GavelIcon,
  KeyRoundIcon,
  RadioTowerIcon,
  ShieldCheckIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ComparisonBlock } from "@/components/comparison";
import { ErrorBoundary } from "@/components/error-boundary";
import { HowItWorksDiagram } from "@/components/how-it-works";
import { LivePanel } from "@/components/live-panel";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { creditcoinTestnet } from "@/lib/chains";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <ProofStrip />

      <PageShell width="wide" className="flex flex-col gap-24 pt-20 pb-28 sm:gap-32">
        <ProblemSection />
        <HowItWorksSection />
        <ComparisonSection />
        <PersonaSection />
        <VerifySection />
        <ClosingCta />
      </PageShell>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared section furniture                                                   */
/* -------------------------------------------------------------------------- */

function SectionIntro({
  eyebrow,
  title,
  lede,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex max-w-2xl flex-col gap-4", className)}>
      <span className="eyebrow text-brand">{eyebrow}</span>
      <h2 className="display-md text-balance">{title}</h2>
      {lede ? (
        <p className="text-base text-pretty text-muted-foreground sm:text-lg">{lede}</p>
      ) : null}
    </div>
  );
}

const CTA_PRIMARY = cn(
  buttonVariants({ size: "lg" }),
  "h-11 gap-2 rounded-xl px-5 text-[0.95rem] shadow-[0_10px_30px_-12px_var(--brand)]",
);

const CTA_SECONDARY = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-11 gap-2 rounded-xl px-5 text-[0.95rem]",
);

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        className="surface-dots edge-fade pointer-events-none absolute inset-0 opacity-70"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-64 left-1/2 h-[560px] w-[1100px] -translate-x-1/2 rounded-full opacity-30 blur-[120px]"
        style={{
          background:
            "radial-gradient(closest-side, var(--brand) 0%, color-mix(in oklab, var(--brand-2) 60%, transparent) 55%, transparent 75%)",
        }}
        aria-hidden
      />

      <PageShell
        width="wide"
        className="relative grid items-center gap-14 pt-16 pb-16 sm:pt-24 sm:pb-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16"
      >
        <div className="flex flex-col items-start gap-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
            <FingerprintIcon className="size-3.5" aria-hidden />
            Proof of personhood on Creditcoin
          </span>

          <h1 className="display-xl max-w-[15ch] text-balance">
            One human, <span className="text-gradient">one credit line.</span>
          </h1>

          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            A zero-knowledge proof of personhood, carried to Creditcoin by the Attestcoin
            Protocol and verified on Creditcoin itself. No bridge, no oracle, no admin
            key — and the credit line follows the person, not the wallet.
          </p>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/app" className={CTA_PRIMARY}>
                Verify and borrow
                <ArrowRightIcon className="size-4" aria-hidden />
              </Link>
              <Link href="/relay" className={CTA_SECONDARY}>
                <RadioTowerIcon className="size-4" aria-hidden />
                Watch roots land live
              </Link>
            </div>
            <Link
              href="/judge"
              className="group inline-flex max-w-full items-center gap-1.5 self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <GavelIcon className="size-3.5" aria-hidden />
              No wallet? Check every claim on this site yourself
              <ArrowRightIcon
                className="size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>
        </div>

        <ErrorBoundary title="Live protocol readout">
          <LivePanel className="w-full" />
        </ErrorBoundary>
      </PageShell>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Proof strip — the whole thesis, in four lines                              */
/* -------------------------------------------------------------------------- */

const PROOFS = [
  {
    icon: ShieldCheckIcon,
    title: "No bridge, no oracle",
    body: "An Attestcoin proof of the real Ethereum transaction, verified by the 0x0FD2 precompile inside the same call.",
  },
  {
    icon: KeyRoundIcon,
    title: "No admin keys",
    body: "No pause, no upgrade, no privileged relayer. Every constant is immutable and anyone can relay the next root.",
  },
  {
    icon: FingerprintIcon,
    title: "Proved on Creditcoin",
    body: "Semaphore Groth16 over the bn128 precompiles, checked against an Attestcoin-anchored World ID root.",
  },
  {
    icon: UsersIcon,
    title: "One line per human",
    body: "The account is the World ID nullifier, so a fresh wallet is not a fresh borrower and a default cannot be shed.",
  },
];

function ProofStrip() {
  return (
    <section className="border-y border-hairline">
      <PageShell width="wide">
        {/* A 1px gap over a hairline ground draws every separator the grid
            needs, at one column, two or four. `divide-*` cannot: it keys off
            DOM order, not grid position. */}
        <ul className="-mx-4 grid gap-px bg-hairline sm:-mx-6 sm:grid-cols-2 lg:grid-cols-4">
          {PROOFS.map((proof) => (
            <li
              key={proof.title}
              className="flex flex-col gap-2 bg-background p-4 py-7 sm:p-6"
            >
              <proof.icon className="size-4 text-brand" aria-hidden />
              <h2 className="font-heading text-sm font-semibold">{proof.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{proof.body}</p>
            </li>
          ))}
        </ul>
      </PageShell>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The problem                                                                */
/* -------------------------------------------------------------------------- */

function ProblemSection() {
  return (
    <section className="flex flex-col gap-10">
      <SectionIntro
        eyebrow="The problem"
        title="A wallet is not a person."
        lede="Every credit passport built on one can be forged in a minute. A borrower opens ten wallets, repays themselves ten times, mints ten perfect scores, and defaults on the eleventh loan — thirty projects in this hackathon share that hole."
      />

      <div className="panel overflow-hidden">
        <div className="grid gap-px bg-hairline md:grid-cols-2">
          <div className="flex flex-col gap-4 bg-surface p-6 sm:p-8">
            <span className="eyebrow text-destructive">Wallet as identity</span>
            <div className="flex flex-wrap gap-2">
              {["0xa17c…4f21", "0x93be…0d08", "0xe4d1…77ab", "0x0b6f…c512"].map((addr) => (
                <span
                  key={addr}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 font-mono text-xs text-destructive/90"
                >
                  <WalletIcon className="size-3" aria-hidden />
                  {addr}
                </span>
              ))}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Four wallets, four spotless repayment histories, one person. The fifth wallet
              takes the money and the score stays clean, because the score was never
              attached to anybody.
            </p>
          </div>

          <div className="flex flex-col gap-4 bg-surface p-6 sm:p-8">
            <span className="eyebrow text-brand-2">Human as identity</span>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/12 px-2.5 py-1.5 font-mono text-xs text-brand">
                <FingerprintIcon className="size-3" aria-hidden />
                nullifier 0x29cc…2118
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              One Orb-verified human is one leaf in World&rsquo;s tree and one nullifier on
              Creditcoin. Bind a new wallet and the history moves with you — including the
              default that froze it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* How it works                                                               */
/* -------------------------------------------------------------------------- */

const STEPS = [
  {
    n: "01",
    title: "A real root leaves Ethereum",
    summary: "World's sequencer publishes a new identity tree root roughly every hour.",
    body: "registerIdentities on the Orb identity manager emits TreeChanged(preRoot, kind, postRoot). That transaction is the only thing Humanline trusts — and it trusts it because it can prove it happened.",
    icon: RadioTowerIcon,
  },
  {
    n: "02",
    title: "Attestcoin proves that transaction on Creditcoin",
    summary: "A permissionless worker submits an inclusion and continuity proof.",
    body: "The 0x0FD2 precompile verifies the proof inside the same call, 0x0FD3 enforces a finality depth and 0x0FD4 a quorum of attestors. No bridge signed it, no oracle reported it, no multisig approved it.",
    icon: ShieldCheckIcon,
  },
  {
    n: "03",
    title: "You prove you are human, in zero knowledge",
    summary: "World App — or the staging simulator — produces a Semaphore proof bound to your wallet.",
    body: "HumanRegistry verifies the Groth16 proof on Creditcoin against an Attestcoin-anchored root and binds your nullifier to your address. Your identity never leaves your device.",
    icon: FingerprintIcon,
  },
  {
    n: "04",
    title: "The line belongs to you, not to your key",
    summary: "Borrow, repay on time, and the limit grows 25%.",
    body: "Miss a deadline and the line freezes on every wallet you ever bind. Re-bind to a new wallet and the history follows, because the nullifier is the account.",
    icon: KeyRoundIcon,
  },
];

function HowItWorksSection() {
  return (
    <section className="flex flex-col gap-12">
      <SectionIntro
        eyebrow="How it works"
        title="Three contracts and one worker."
        lede="Every arrow below is a verification, not a handoff. Nothing in this path asks you to trust an operator."
      />

      <ol className="flex flex-col">
        {STEPS.map((step, i) => (
          <li key={step.n} className="group relative grid grid-cols-[auto_1fr] gap-x-5 sm:gap-x-8">
            <div className="flex flex-col items-center">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 font-mono text-sm font-semibold text-brand outline-1 outline-offset-[-1px] outline-hairline">
                {step.n}
              </span>
              {i < STEPS.length - 1 ? (
                <span className="w-px flex-1 bg-gradient-to-b from-hairline to-transparent" aria-hidden />
              ) : null}
            </div>

            <div className="flex flex-col gap-2 pb-12">
              <div className="flex items-center gap-2.5">
                <step.icon className="size-4 text-brand-2" aria-hidden />
                <h3 className="font-heading text-lg font-semibold tracking-[-0.015em]">
                  {step.title}
                </h3>
              </div>
              <p className="max-w-2xl text-base text-foreground/85">{step.summary}</p>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <figure className="flex flex-col gap-3">
        <HowItWorksDiagram />
        <figcaption className="text-sm text-muted-foreground">
          The full path, end to end: World&rsquo;s identity managers on Ethereum, the three
          CC3 precompiles that verify the Attestcoin proof, and the three Humanline
          contracts that turn a verified root into a credit line.
        </figcaption>
      </figure>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                 */
/* -------------------------------------------------------------------------- */

function ComparisonSection() {
  return (
    <section className="flex flex-col gap-10">
      <SectionIntro
        eyebrow="Side by side"
        title="Wallet passports vs Humanline"
        lede="Lenders cannot lend against on-chain history until that history belongs to somebody who cannot walk away from it by generating a new key."
      />
      <ComparisonBlock />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Who it is for                                                              */
/* -------------------------------------------------------------------------- */

const PERSONAS = [
  {
    initial: "A",
    name: "Amina, 27",
    role: "Nairobi · borrower",
    lines: [
      "Orb-verified through World App in 2025. Sells phone accessories, paid in M-Pesa and USDC. No bank credit file anywhere.",
      "She wants a 50 USD working-capital line she can grow by repaying on time — with no collateral, no oracle operator to trust, and no sybil farm able to impersonate her.",
    ],
    footnote:
      "World ID has 13M+ Orb-verified humans, concentrated in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia — Creditcoin's markets.",
  },
  {
    initial: "L",
    name: "Aella",
    role: "Lagos · lender",
    lines: [
      "Runs BNPL for a million Nigerians and already records loans on Creditcoin through Credal.",
      "Wants a trustless answer to “is this borrower a unique human, and what is their Humanline history?” before extending anything uncollateralised.",
    ],
    footnote: "Two view calls answer it: isHuman(address) and lineOf(humanOf(address)). No API key, no integration call, no trust.",
  },
];

function PersonaSection() {
  return (
    <section className="flex flex-col gap-10">
      <SectionIntro
        eyebrow="Who this is for"
        title="Credit history for people the banking system cannot see."
        lede="Creditcoin's founding mission, with the one missing primitive supplied: proof that the borrower is a person."
      />
      <div className="grid gap-5 md:grid-cols-2">
        {PERSONAS.map((persona) => (
          <article key={persona.name} className="panel flex flex-col gap-5 p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-brand/15 font-heading text-base font-semibold text-brand">
                {persona.initial}
              </span>
              <div className="flex flex-col">
                <h3 className="font-heading text-base font-semibold">{persona.name}</h3>
                <span className="text-xs text-muted-foreground">{persona.role}</span>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {persona.lines.map((line) => (
                <p key={line} className="text-sm leading-relaxed text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
            <p className="mt-auto border-t border-hairline pt-4 text-sm leading-relaxed text-foreground/80">
              {persona.footnote}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Verify us                                                                  */
/* -------------------------------------------------------------------------- */

const TRUST_POINTS = [
  {
    title: "No admin keys",
    body: "No pause, no upgradeability, no privileged relayer. Every constant is an immutable or a constructor argument.",
  },
  {
    title: "Every failure is a named revert",
    body: "WrongSourceChain, SourceTxReverted, NotIdentityManager, UnknownPreRoot, NotFinal, ThinQuorum, OverLimit — each with a test that fires it.",
  },
  {
    title: "Real roots, not fixtures",
    body: "Ethereum mainnet World ID roots, published hourly by World's sequencer and verified by the 0x0FD2 precompile in every relay transaction.",
  },
  {
    title: "Honest about the testnet",
    body: "hUSD is a test stablecoin, lender deposits are testnet funds, and demo loan terms are minutes long so a full cycle fits in a video. We say so on every page it matters.",
  },
];

function VerifySection() {
  return (
    <section className="flex flex-col gap-10">
      <SectionIntro
        eyebrow="Verify us"
        title="Don't trust this page. Check it."
        lede="Every claim here resolves to a value you can read off the chain, a command you can run, or a transaction you can open in a block explorer."
      />

      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {TRUST_POINTS.map((point) => (
          <div key={point.title} className="flex gap-3">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-2" aria-hidden />
            <div className="flex flex-col gap-1">
              <h3 className="font-heading text-sm font-semibold">{point.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{point.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/judge" className={CTA_SECONDARY}>
          <GavelIcon className="size-4" aria-hidden />
          Judge page
        </Link>
        <Link href="/relay" className={CTA_SECONDARY}>
          <RadioTowerIcon className="size-4" aria-hidden />
          Root relay feed
        </Link>
        <a
          href={creditcoinTestnet.blockExplorers.default.url}
          target="_blank"
          rel="noreferrer noopener"
          className={CTA_SECONDARY}
        >
          CC3 Blockscout
          <ArrowUpRightIcon className="size-4" aria-hidden />
        </a>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Closing                                                                    */
/* -------------------------------------------------------------------------- */

function ClosingCta() {
  return (
    <section className="panel-brand relative isolate overflow-hidden p-8 sm:p-14">
      <div
        className="pointer-events-none absolute -right-24 -bottom-32 h-80 w-80 rounded-full opacity-40 blur-[90px]"
        style={{ background: "radial-gradient(closest-side, var(--brand-2), transparent 70%)" }}
        aria-hidden
      />
      <div className="relative flex flex-col gap-6">
        <h2 className="display-md max-w-3xl text-balance">
          Every other credit passport can be forged by creating a new wallet.
          <span className="text-gradient"> This one cannot.</span>
        </h2>
        <p className="max-w-2xl text-base text-muted-foreground">
          Verify once with World ID, open a line, and carry it with you. It takes about a
          minute on the staging tree — and you can check every claim on this site without
          connecting a wallet at all.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/app" className={CTA_PRIMARY}>
            Open the app
            <ArrowRightIcon className="size-4" aria-hidden />
          </Link>
          <Link href="/docs" className={CTA_SECONDARY}>
            Read the integration guide
          </Link>
        </div>
      </div>
    </section>
  );
}
