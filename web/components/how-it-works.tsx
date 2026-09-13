import { cn } from "@/lib/utils";

/**
 * The architecture diagram, drawn as inline SVG.
 *
 * It is the same picture as the ASCII diagram in `docs/SPEC.md` §5: World's
 * identity managers on Ethereum, an Attestcoin proof of the real transaction,
 * the three CC3 precompiles that verify it, and the three Humanline contracts
 * that turn a verified root into a credit line.
 *
 * Inline rather than an image so it is crisp at any size, themed by the same CSS
 * variables as the rest of the page, and readable by a screen reader.
 */
export function HowItWorksDiagram({ className }: { className?: string }) {
  return (
    <figure className={cn("w-full", className)}>
      <div className="panel overflow-x-auto p-3 sm:p-5">
        <svg
          viewBox="0 0 980 470"
          className="h-auto w-full min-w-[720px]"
          role="img"
          aria-labelledby="hiw-title hiw-desc"
        >
          <title id="hiw-title">How Humanline works</title>
          <desc id="hiw-desc">
            World ID identity managers on Ethereum mainnet and Sepolia emit TreeChanged
            events. A permissionless worker builds an Attestcoin proof of that exact
            transaction and submits it to Creditcoin, where the 0x0FD2 BlockProver
            precompile verifies inclusion and continuity, the 0x0FD3 ChainInfo precompile
            supplies a finality guard and the 0x0FD4 AttestorStash precompile supplies an
            attestor quorum floor. AttestedWorldID stores the resulting root. A user proves
            personhood to HumanRegistry with a Semaphore zero-knowledge proof verified on
            Creditcoin against that root, and CreditLine opens exactly one uncollateralised
            line per human.
          </desc>

          <defs>
            <linearGradient id="hiw-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--brand)" />
              <stop offset="1" stopColor="var(--brand-2)" />
            </linearGradient>
            <marker
              id="hiw-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand)" />
            </marker>
            <marker
              id="hiw-arrow-muted"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.5" />
            </marker>
          </defs>

          {/* ───────────────────────────── Ethereum column ───────────────────────────── */}
          <g className="text-muted-foreground">
            <text x="16" y="28" className="fill-current text-[11px] font-semibold tracking-[0.12em] uppercase">
              Ethereum
            </text>
          </g>

          <Box x={16} y={44} w={232} h={104} tone="neutral">
            <text x={32} y={70} className="fill-foreground text-[13px] font-semibold">
              WorldIDIdentityManager
            </text>
            <text x={32} y={90} className="fill-muted-foreground font-mono text-[11px]">
              0xf7134CE1…bddEa · chainKey 3
            </text>
            <text x={32} y={110} className="fill-muted-foreground text-[11px]">
              registerIdentities() ~hourly
            </text>
            <text x={32} y={128} className="fill-muted-foreground text-[11px]">
              emits TreeChanged(pre, kind, post)
            </text>
          </Box>

          <Box x={16} y={166} w={232} h={84} tone="neutral">
            <text x={32} y={192} className="fill-foreground text-[13px] font-semibold">
              Staging identity manager
            </text>
            <text x={32} y={212} className="fill-muted-foreground font-mono text-[11px]">
              0xb2ead588…7076 · chainKey 1
            </text>
            <text x={32} y={232} className="fill-muted-foreground text-[11px]">
              Sepolia · simulator identities
            </text>
          </Box>

          {/* ─────────────────────────────── relay arrows ────────────────────────────── */}
          <path
            d="M 256 96 H 352"
            stroke="url(#hiw-flow)"
            strokeWidth="2"
            fill="none"
            markerEnd="url(#hiw-arrow)"
          />
          <path
            d="M 256 208 H 300 Q 316 208 316 192 V 112 Q 316 96 352 96"
            stroke="url(#hiw-flow)"
            strokeWidth="2"
            fill="none"
            opacity="0.65"
          />
          <text x={258} y={78} className="fill-brand text-[10px] font-semibold">
            Attestcoin
          </text>
          <text x={258} y={90} className="fill-brand text-[10px] font-semibold">
            proof
          </text>
          <text x={258} y={126} className="fill-muted-foreground text-[9.5px]">
            anyone can
          </text>
          <text x={258} y={137} className="fill-muted-foreground text-[9.5px]">
            relay
          </text>

          {/* ────────────────────────────── Creditcoin panel ─────────────────────────── */}
          <rect
            x={362}
            y={20}
            width={602}
            height={430}
            rx={16}
            fill="var(--brand)"
            opacity="0.04"
          />
          <rect
            x={362}
            y={20}
            width={602}
            height={430}
            rx={16}
            fill="none"
            stroke="var(--brand)"
            strokeOpacity="0.25"
            strokeWidth="1"
          />
          <text
            x={382}
            y={44}
            className="fill-brand text-[11px] font-semibold tracking-[0.12em] uppercase"
          >
            Creditcoin CC3 · chainId 102031
          </text>

          {/* precompiles */}
          <Box x={382} y={58} w={182} h={72} tone="brand">
            <text x={396} y={80} className="fill-foreground text-[12px] font-semibold">
              0x0FD2 BlockProver
            </text>
            <text x={396} y={98} className="fill-muted-foreground text-[10.5px]">
              verifyAndEmit · inclusion
            </text>
            <text x={396} y={114} className="fill-muted-foreground text-[10.5px]">
              + continuity of the source tx
            </text>
          </Box>
          <Box x={578} y={58} w={172} h={72} tone="brand">
            <text x={592} y={80} className="fill-foreground text-[12px] font-semibold">
              0x0FD3 ChainInfo
            </text>
            <text x={592} y={98} className="fill-muted-foreground text-[10.5px]">
              attested tip →
            </text>
            <text x={592} y={114} className="fill-muted-foreground text-[10.5px]">
              finality-depth guard
            </text>
          </Box>
          <Box x={764} y={58} w={182} h={72} tone="brand">
            <text x={778} y={80} className="fill-foreground text-[12px] font-semibold">
              0x0FD4 AttestorStash
            </text>
            <text x={778} y={98} className="fill-muted-foreground text-[10.5px]">
              attestor count →
            </text>
            <text x={778} y={114} className="fill-muted-foreground text-[10.5px]">
              quorum floor
            </text>
          </Box>

          <path
            d="M 473 134 V 160"
            stroke="currentColor"
            className="text-muted-foreground"
            strokeWidth="1.5"
            markerEnd="url(#hiw-arrow-muted)"
          />
          <path
            d="M 664 134 V 148 Q 664 160 640 160"
            stroke="currentColor"
            className="text-muted-foreground"
            strokeWidth="1.5"
            fill="none"
            opacity="0.7"
          />
          <path
            d="M 855 134 V 148 Q 855 160 830 160"
            stroke="currentColor"
            className="text-muted-foreground"
            strokeWidth="1.5"
            fill="none"
            opacity="0.7"
          />

          {/* AttestedWorldID */}
          <Box x={382} y={162} w={564} h={92} tone="strong">
            <text x={400} y={188} className="fill-foreground text-[14px] font-semibold">
              AttestedWorldID
            </text>
            <text x={400} y={208} className="fill-muted-foreground text-[11px]">
              status · emitter · selector-vs-log agreement · preRoot must chain to a known root
            </text>
            <text x={400} y={226} className="fill-muted-foreground text-[11px]">
              replay-protected by queryId · rootHistory with a one-week expiry
            </text>
            <text x={400} y={244} className="fill-brand-2 font-mono text-[11px]">
              IWorldID.verifyProof(root, signal, nullifier, extNullifier, proof[8])
            </text>
          </Box>

          <path
            d="M 664 258 V 286"
            stroke="url(#hiw-flow)"
            strokeWidth="2"
            markerEnd="url(#hiw-arrow)"
          />

          {/* HumanRegistry */}
          <Box x={382} y={288} w={278} h={92} tone="neutral">
            <text x={400} y={314} className="fill-foreground text-[14px] font-semibold">
              HumanRegistry
            </text>
            <text x={400} y={334} className="fill-muted-foreground text-[11px]">
              Semaphore Groth16 verified
            </text>
            <text x={400} y={350} className="fill-muted-foreground text-[11px]">
              on Creditcoin (bn128 0x06/07/08)
            </text>
            <text x={400} y={370} className="fill-muted-foreground font-mono text-[11px]">
              nullifier ⇄ wallet
            </text>
          </Box>

          {/* CreditLine */}
          <Box x={678} y={288} w={268} h={92} tone="neutral">
            <text x={696} y={314} className="fill-foreground text-[14px] font-semibold">
              CreditLine
            </text>
            <text x={696} y={334} className="fill-muted-foreground text-[11px]">
              one uncollateralised line per human
            </text>
            <text x={696} y={350} className="fill-muted-foreground text-[11px]">
              borrow · repay · limit grows
            </text>
            <text x={696} y={370} className="fill-muted-foreground text-[11px]">
              miss a deadline and it freezes
            </text>
          </Box>

          <path
            d="M 664 334 H 674"
            stroke="url(#hiw-flow)"
            strokeWidth="2"
            markerEnd="url(#hiw-arrow)"
          />

          <text x={400} y={412} className="fill-muted-foreground text-[11px]">
            HumanGate and any other Creditcoin contract read
          </text>
          <text x={400} y={430} className="fill-brand-2 font-mono text-[11px]">
            isHuman(address) · humanOf(address) · lineOf(human)
          </text>

          {/* ─────────────────────────── World App / ZK proof ────────────────────────── */}
          <Box x={16} y={296} w={232} h={84} tone="accent">
            <text x={32} y={322} className="fill-foreground text-[13px] font-semibold">
              World App / IDKit
            </text>
            <text x={32} y={342} className="fill-muted-foreground text-[11px]">
              Orb credential, or the simulator
            </text>
            <text x={32} y={362} className="fill-muted-foreground text-[11px]">
              on the staging tree
            </text>
          </Box>

          <path
            d="M 256 338 H 376"
            stroke="url(#hiw-flow)"
            strokeWidth="2"
            strokeDasharray="5 4"
            markerEnd="url(#hiw-arrow)"
          />
          <text x={258} y={318} className="fill-brand text-[10px] font-semibold">
            zero-knowledge
          </text>
          <text x={258} y={330} className="fill-brand text-[10px] font-semibold">
            proof
          </text>
          <text x={258} y={358} className="fill-muted-foreground text-[9.5px]">
            no identity leaves
          </text>
          <text x={258} y={369} className="fill-muted-foreground text-[9.5px]">
            the device
          </text>

          <text x={16} y={424} className="fill-muted-foreground text-[11px]">
            Nothing in the pipeline is trusted:
          </text>
          <text x={16} y={440} className="fill-muted-foreground text-[11px]">
            a bad proof reverts, an out-of-order
          </text>
          <text x={16} y={456} className="fill-muted-foreground text-[11px]">
            root reverts, a replay reverts.
          </text>
        </svg>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        Remove Attestcoin and Humanline has no roots, no humans and no credit.
      </figcaption>
    </figure>
  );
}

function Box({
  x,
  y,
  w,
  h,
  tone,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: "neutral" | "brand" | "strong" | "accent";
  children: React.ReactNode;
}) {
  const fill =
    tone === "strong"
      ? "var(--brand)"
      : tone === "brand"
        ? "var(--brand-2)"
        : tone === "accent"
          ? "var(--brand)"
          : "var(--card)";
  const fillOpacity = tone === "neutral" ? 0.9 : tone === "strong" ? 0.12 : 0.08;
  const stroke =
    tone === "strong"
      ? "var(--brand)"
      : tone === "brand"
        ? "var(--brand-2)"
        : tone === "accent"
          ? "var(--brand)"
          : "currentColor";
  const strokeOpacity = tone === "neutral" ? 0.16 : 0.4;

  return (
    <g className="text-foreground">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={12}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={1}
      />
      {children}
    </g>
  );
}
