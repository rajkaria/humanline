import {
  ArrowRightIcon,
  FingerprintIcon,
  GavelIcon,
  KeyRoundIcon,
  RadioTowerIcon,
  ShieldCheckIcon,
} from "lucide-react";
import Link from "next/link";

import { ComparisonBlock } from "@/components/comparison";
import { ErrorBoundary } from "@/components/error-boundary";
import { HowItWorksDiagram } from "@/components/how-it-works";
import { LiveCounters } from "@/components/live-counters";
import { PageShell, SectionHeading } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  return (
    <>
      <Hero />

      <PageShell className="flex flex-col gap-20 pb-24 sm:gap-24">
        <section className="flex flex-col gap-6">
          <SectionHeading
            id="how"
            title="How it works"
            description="Three contracts and one worker. Every arrow is a verification, not a handoff."
          />
          <HowItWorksDiagram />
          <StepGrid />
        </section>

        <section className="flex flex-col gap-6">
          <SectionHeading
            id="comparison"
            title="Wallet passports vs Humanline"
            description="Thirty credit-passport submissions in this hackathon share one hole: a wallet is not a person."
          />
          <ComparisonBlock />
          <p className="max-w-3xl text-sm text-muted-foreground">
            A borrower can open ten wallets, repay themselves ten times, mint ten perfect
            scores, and default on the eleventh loan. Lenders cannot lend against on-chain
            history until the history belongs to a human who cannot walk away from it by
            generating a new key.
          </p>
        </section>

        <PersonaSection />
        <TrustSection />
        <ClosingCta />
      </PageShell>
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-foreground/10">
      <div
        className="pointer-events-none absolute inset-0 surface-grid opacity-60"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[900px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, var(--brand), transparent 70%)",
        }}
        aria-hidden
      />
      <PageShell className="relative flex flex-col gap-10 pt-16 pb-16 sm:pt-24 sm:pb-20">
        <div className="flex flex-col items-start gap-6">
          <Badge variant="outline" className="gap-1.5 border-brand/40 bg-brand/10 text-brand">
            <FingerprintIcon className="size-3" />
            Proof of personhood on Creditcoin
          </Badge>

          <h1 className="max-w-4xl text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            One human,{" "}
            <span className="text-gradient">one credit line.</span>
          </h1>

          <p className="max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">
            World ID proof of personhood reaches Creditcoin through the Attestcoin
            Protocol. A zero-knowledge proof is verified on Creditcoin itself, and a
            verified human receives an uncollateralised credit line that follows the
            person, not the wallet.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/app" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
              Verify and borrow
              <ArrowRightIcon className="size-4" />
            </Link>
            <Link
              href="/relay"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2")}
            >
              <RadioTowerIcon className="size-4" />
              Watch roots land live
            </Link>
            <Link
              href="/judge"
              className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "gap-2")}
            >
              <GavelIcon className="size-4" />
              Verify it yourself
            </Link>
          </div>
        </div>

        <ErrorBoundary title="Live counters">
          <LiveCounters />
        </ErrorBoundary>
      </PageShell>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "A real root leaves Ethereum",
    body: "World's sequencer calls registerIdentities on the Orb identity manager roughly every hour, emitting TreeChanged(preRoot, kind, postRoot). That transaction is the only thing Humanline trusts, and it trusts it because it can prove it happened.",
    icon: RadioTowerIcon,
  },
  {
    n: "02",
    title: "Attestcoin proves the transaction on Creditcoin",
    body: "A permissionless worker builds an inclusion and continuity proof and submits it. The 0x0FD2 precompile verifies it inside the same call; 0x0FD3 enforces a finality depth and 0x0FD4 a quorum of attestors. No bridge, no oracle, no multisig.",
    icon: ShieldCheckIcon,
  },
  {
    n: "03",
    title: "You prove you are a human, in zero knowledge",
    body: "World App — or the simulator on staging — produces a Semaphore proof bound to your wallet address. HumanRegistry verifies the Groth16 proof on Creditcoin against an Attestcoin-anchored root and binds your nullifier to your wallet.",
    icon: FingerprintIcon,
  },
  {
    n: "04",
    title: "The line belongs to you, not your key",
    body: "Open a line, borrow, repay on time and the limit grows 25%. Miss a deadline and it freezes — on every wallet you ever bind. Re-bind to a new wallet and the history moves with you, because the nullifier is the account.",
    icon: KeyRoundIcon,
  },
];

function StepGrid() {
  return (
    <ol className="grid gap-3 sm:grid-cols-2">
      {STEPS.map((step) => (
        <li key={step.n}>
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <step.icon className="size-4" aria-hidden />
                </span>
                <span className="font-mono text-xs text-muted-foreground">{step.n}</span>
              </div>
              <CardTitle className="pt-2 text-base">{step.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}

function PersonaSection() {
  return (
    <section className="flex flex-col gap-6">
      <SectionHeading
        id="who"
        title="Who this is for"
        description="Creditcoin's founding mission is credit history for people the banking system cannot see."
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Amina, 27, Nairobi</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              Orb-verified through World App in 2025. Sells phone accessories, paid in
              M-Pesa and USDC. No bank credit file.
            </p>
            <p>
              She wants a 50 USD working-capital line she can grow by repaying on time. She
              should never be asked for collateral, never be asked to trust an oracle
              operator, and never be able to be impersonated by a sybil farm.
            </p>
            <p className="text-foreground/80">
              World ID has 13M+ Orb-verified humans, concentrated in Kenya, Argentina,
              Indonesia, the Philippines, Brazil and Malaysia — Creditcoin&rsquo;s markets.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aella, the lender</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              Runs BNPL for a million Nigerians and records loans on Creditcoin through
              Credal.
            </p>
            <p>
              Wants a trustless answer to &ldquo;is this borrower a unique human, and what is
              their Humanline history?&rdquo; before extending uncollateralised credit.
            </p>
            <p className="text-foreground/80">
              Two view calls answer it:{" "}
              <code className="font-mono text-xs text-brand-2">isHuman(address)</code> and{" "}
              <code className="font-mono text-xs text-brand-2">lineOf(humanOf(address))</code>.
              No API key, no integration call, no trust.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

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
    body: "Ethereum mainnet World ID roots, updated hourly by World's sequencer, proven by the CC3 proof builder and verified by the 0x0FD2 precompile in every relay transaction.",
  },
  {
    title: "Honest about the testnet",
    body: "hUSD is a test stablecoin we mint, lender deposits are testnet funds, and demo loan terms are minutes long so a full cycle fits in a video. We say so on every page it matters.",
  },
];

function TrustSection() {
  return (
    <section className="flex flex-col gap-6">
      <SectionHeading
        id="trust"
        title="What you have to trust"
        description="Nothing. That is the entire point, and it is checkable."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST_POINTS.map((point) => (
          <Card key={point.title} size="sm" className="h-full">
            <CardHeader>
              <CardTitle className="text-sm">{point.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{point.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-card/60 p-8 ring-1 ring-foreground/10 sm:p-12">
      <div
        className="pointer-events-none absolute -right-20 -bottom-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--brand-2), transparent 70%)" }}
        aria-hidden
      />
      <div className="relative flex flex-col gap-5">
        <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Every other credit passport can be forged by creating a new wallet.
          <span className="text-gradient"> This one cannot.</span>
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Verify once with World ID, open a line, and carry it with you. Takes about a
          minute on the staging tree, and you can check every claim on this site without
          connecting a wallet at all.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/app" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
            Open the app
            <ArrowRightIcon className="size-4" />
          </Link>
          <Link
            href="/docs"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            Read the integration guide
          </Link>
        </div>
      </div>
    </section>
  );
}
