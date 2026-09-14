import {
  BookOpenIcon,
  CodeIcon,
  LockKeyholeIcon,
  PackageIcon,
  ScaleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { Metadata } from "next";

import { CommandBlock } from "@/components/command-block";
import { Markdown } from "@/components/markdown";
import { PageHeader, PageShell, SectionHeading } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { creditcoinTestnet, PRECOMPILES } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import docs from "@/lib/generated/docs.json";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How a lender integrates Humanline in two view calls, how the Attestcoin integration works, what the security model covers, and what it deliberately does not.",
};

const RPC = creditcoinTestnet.rpcUrls.default.http[0];
const SDK_NPM_URL = "https://www.npmjs.com/package/@humanline/sdk";

const NAV = [
  { href: "#integrate", label: "Integration guide" },
  { href: "#attestcoin", label: "Attestcoin integration" },
  { href: "#security", label: "Security model" },
  { href: "#limitations", label: "Known limitations" },
];

export default function DocsPage() {
  const attestcoinDoc = (docs as Record<string, string>).attestcoinIntegration;

  return (
    <PageShell className="pb-24">
      <PageHeader
        eyebrow="For integrators"
        title="Docs"
        description="Humanline is a read-only dependency. Add two view calls and you get a sybil-resistant answer with no API key, no oracle and no account with us. You never have to talk to us, though we'd enjoy it."
      />

      <nav className="flex flex-wrap gap-2 border-b border-foreground/10 py-4" aria-label="On this page">
        {NAV.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="rounded-lg bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-16 pt-10">
        <IntegrationGuide />
        <AttestcoinSection doc={attestcoinDoc} />
        <SecurityModel />
        <Limitations />
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ integrate */

const READS = [
  {
    signature: "isHuman(address wallet) → bool",
    what: "Is this wallet bound to a unique World ID nullifier right now?",
    who: "Airdrops, governance, one-per-person gates.",
  },
  {
    signature: "humanOf(address wallet) → uint256",
    what: "The nullifier behind the wallet, or 0. This is the account identifier, and it stays put across re-binds.",
    who: "Anything that needs to key state by person rather than by address.",
  },
  {
    signature: "walletOf(uint256 human) → address",
    what: "The wallet a human is currently bound to.",
    who: "Paying a human whose current key you do not know.",
  },
  {
    signature: "registeredAt(uint256 human) → uint64",
    what: "When the human first registered. Account age, not wallet age.",
    who: "Risk models that want tenure.",
  },
  {
    signature: "lineOf(uint256 human) → Line",
    what: "limit, principal, dueAt, openedAt, loansRepaid, loansLate, frozen.",
    who: "A lender pricing a second facility on Humanline history.",
  },
  {
    signature: "isInDefault(uint256 human) → bool",
    what: "Past due plus grace with principal outstanding.",
    who: "A lender deciding whether to extend anything at all.",
  },
];

function IntegrationGuide() {
  return (
    <section id="integrate" className="flex flex-col gap-6 scroll-mt-20">
      <SectionHeading
        title="Integration guide"
        description="Two interfaces, all view functions, no permissions to request."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CodeIcon className="size-4 text-brand" />
            The whole integration
          </CardTitle>
          <CardDescription>
            Copy this into your contract. There is no registration step, no allowlist, and
            nothing to pay. That is the entire onboarding.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <pre className="overflow-x-auto rounded-xl bg-card/70 p-4 font-mono text-[11.5px] leading-relaxed ring-1 ring-foreground/10">
            <code>{`interface IHumanRegistry {
    function isHuman(address wallet) external view returns (bool);
    function humanOf(address wallet) external view returns (uint256);
}

interface ICreditLine {
    struct Line {
        uint256 limit;
        uint256 principal;
        uint64  dueAt;
        uint64  openedAt;
        uint32  loansRepaid;
        uint32  loansLate;
        bool    frozen;
    }
    function lineOf(uint256 human) external view returns (Line memory);
    function isInDefault(uint256 human) external view returns (bool);
}

contract OnePerHuman {
    IHumanRegistry public immutable REGISTRY;
    mapping(uint256 => bool) public claimed;

    error NotHuman(address wallet);
    error AlreadyClaimed(uint256 human);

    constructor(IHumanRegistry registry) { REGISTRY = registry; }

    function claim() external {
        uint256 human = REGISTRY.humanOf(msg.sender);
        if (human == 0) revert NotHuman(msg.sender);
        if (claimed[human]) revert AlreadyClaimed(human);
        claimed[human] = true;
        // ...pay out exactly once per person, forever.
    }
}`}</code>
          </pre>

          <p className="text-sm text-muted-foreground">
            Key by <code className="font-mono text-xs">humanOf(msg.sender)</code>, never by{" "}
            <code className="font-mono text-xs">msg.sender</code>. That single choice is what
            makes the guarantee survive a user moving to a new wallet, and what makes a sybil
            farm&rsquo;s tenth wallet return the same human as its first.
          </p>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>View call</TableHead>
              <TableHead className="hidden md:table-cell">What it answers</TableHead>
              <TableHead className="hidden lg:table-cell">Who wants it</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {READS.map((read) => (
              <TableRow key={read.signature}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {read.signature}
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                  {read.what}
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  {read.who}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageIcon className="size-4 text-brand" />
            From TypeScript or React: @humanline/sdk
          </CardTitle>
          <CardDescription>
            The same reads over any viem client, a <code className="font-mono text-xs">useHuman</code>{" "}
            hook, and <code className="font-mono text-xs">HumanGated.sol</code>, published on{" "}
            <a
              href={SDK_NPM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline-offset-4 hover:underline"
            >
              npm
            </a>
            . No wallet needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CommandBlock title="Install" command="npm install @humanline/sdk viem" />
          <pre className="overflow-x-auto rounded-xl bg-card/70 p-4 font-mono text-[11.5px] leading-relaxed ring-1 ring-foreground/10">
            <code>{`import { createHumanlineClient, isHuman, humanOf, lineOf } from "@humanline/sdk";

const client = createHumanlineClient();       // CC3 testnet
await isHuman(client, "0xBorrower");          // sybil check
const human = await humanOf(client, "0xBorrower");
const line = await lineOf(client, human);     // limit, principal, due date, repaid/late`}</code>
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">From a script, with no contract at all</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CommandBlock
            title="Sybil check"
            command={`.tools/cast call ${CONTRACTS.humanRegistry.address ?? "<HumanRegistry>"} \\\n  "isHuman(address)(bool)" 0xBorrower \\\n  --rpc-url ${RPC}`}
          />
          <CommandBlock
            title="Pull the loan history a lender would price against"
            command={`HUMAN=$(.tools/cast call ${CONTRACTS.humanRegistry.address ?? "<HumanRegistry>"} \\\n  "humanOf(address)(uint256)" 0xBorrower --rpc-url ${RPC})\n\n.tools/cast call ${CONTRACTS.creditLine.address ?? "<CreditLine>"} \\\n  "lineOf(uint256)((uint256,uint256,uint64,uint64,uint32,uint32,bool))" "$HUMAN" \\\n  --rpc-url ${RPC}`}
          />
          <p className="text-xs text-muted-foreground">
            Events mirror a standard loan lifecycle:{" "}
            <code className="font-mono">LineOpened</code>,{" "}
            <code className="font-mono">Borrowed</code>,{" "}
            <code className="font-mono">Repaid</code>,{" "}
            <code className="font-mono">LimitChanged</code>,{" "}
            <code className="font-mono">Defaulted</code>, all indexed by{" "}
            <code className="font-mono">human</code>, so an indexer can build a per-person
            history without touching wallet addresses.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

/* ----------------------------------------------------------------- attestcoin */

const SURFACES = [
  {
    surface: "verifyAndEmit (0x0FD2)",
    where: "ASCBase.execute",
    why: "No root enters the verifier without it.",
  },
  {
    surface: "Batch verification",
    where: "worker getBatchProof → execute per tx sharing one continuity proof",
    why: "Hourly roots land in 3–10 batches instead of one transaction each.",
  },
  {
    surface: "Calldata decoding",
    where: "decodeCommonTxFields(tx).data → postRoot, humansAdded",
    why: "Cross-checks the event and feeds the dashboard counters.",
  },
  {
    surface: "Log decoding",
    where: "getLogsByEventSignature on TreeChanged",
    why: "The root itself.",
  },
  {
    surface: "Emitter and status binding",
    where: "to == manager, log.address_ == manager, status == 1",
    why: "Rejects look-alike events and reverted transactions.",
  },
  {
    surface: "calculateTxIndex",
    where: "queryId and sourceTxIndex in RootRelayed",
    why: "The replay key, and the ordering evidence on /relay.",
  },
  {
    surface: "ChainInfo (0x0FD3)",
    where: "finality depth guard",
    why: "A root is only accepted 32+ blocks behind the attested tip.",
  },
  {
    surface: "AttestorStash (0x0FD4)",
    where: "quorum floor",
    why: "Refuses roots attested by a thin set.",
  },
  {
    surface: "Two source chains",
    where: "mainnet chainKey 3, Sepolia chainKey 1",
    why: "A production path and a judge-reproducible one.",
  },
  {
    surface: "Zero-knowledge on top",
    where: "Semaphore verifier over an Attestcoin-anchored root",
    why: "Without Attestcoin the verifier has no trusted root.",
  },
];

function AttestcoinSection({ doc }: { doc?: string }) {
  return (
    <section id="attestcoin" className="flex flex-col gap-6 scroll-mt-20">
      <SectionHeading
        title="Attestcoin integration"
        description="Ten load-bearing surfaces. Remove Attestcoin and Humanline has no roots, no humans and no credit."
      />

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Surface</TableHead>
              <TableHead className="hidden md:table-cell">Where</TableHead>
              <TableHead>Why it is load-bearing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SURFACES.map((row) => (
              <TableRow key={row.surface}>
                <TableCell className="text-xs font-medium whitespace-nowrap">
                  {row.surface}
                </TableCell>
                <TableCell className="hidden font-mono text-[11px] text-muted-foreground md:table-cell">
                  {row.where}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.why}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenIcon className="size-4 text-brand-2" />
              docs/ATTESTCOIN_INTEGRATION.md
            </CardTitle>
            <Badge variant={doc ? "secondary" : "outline"}>
              {doc ? "rendered from the repo" : "not written yet"}
            </Badge>
          </div>
          <CardDescription>
            The full technical write-up required by the hackathon, rendered straight from the
            repository at build time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {doc ? (
            <Markdown source={doc} />
          ) : (
            <p className="text-sm text-muted-foreground">
              The write-up has not landed in the repository yet. When{" "}
              <code className="font-mono text-xs">docs/ATTESTCOIN_INTEGRATION.md</code> exists
              at build time it is rendered here in full. The table above is the summary it
              expands on.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Precompile addresses</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-xs sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">BlockProver</dt>
              <dd className="font-mono break-all">{PRECOMPILES.blockProver}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">ChainInfo</dt>
              <dd className="font-mono break-all">{PRECOMPILES.chainInfo}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">AttestorStash</dt>
              <dd className="font-mono break-all">{PRECOMPILES.attestorStash}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------- security */

const GUARDS = [
  "Receipt status must be 1. A reverted registerIdentities proves nothing.",
  "The transaction target and the log emitter must both be World's identity manager.",
  "The function selector must be registerIdentities or deleteIdentities.",
  "The postRoot decoded from calldata must equal the postRoot in the TreeChanged log.",
  "preRoot must chain to a root the contract already holds, so roots arrive in order.",
  "The source block must be FINALITY_DEPTH behind the tip ChainInfo reports.",
  "AttestorStash must report at least MIN_ATTESTORS backing the source chain.",
  "queryId = keccak(chainKey, blockHeight, txIndex) is recorded; replays revert.",
  "rootHistory entries expire after a week, so a stale root cannot be used forever.",
  "One nullifier maps to one wallet, and one wallet to one nullifier.",
];

function SecurityModel() {
  return (
    <section id="security" className="flex flex-col gap-6 scroll-mt-20">
      <SectionHeading
        title="Security model"
        description="Attestcoin proves inclusion and continuity. Everything else is Humanline's job, and all of it is on-chain."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LockKeyholeIcon className="size-4 text-brand" />
              What the contracts check
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-muted-foreground marker:text-brand">
              {GUARDS.map((guard) => (
                <li key={guard} className="leading-relaxed">
                  {guard}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScaleIcon className="size-4 text-brand-2" />
              What nobody can do
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              There are no admin keys, no pause switch and no upgrade path. Every constant is
              an immutable or a constructor argument, fixed at deployment and visible on
              Blockscout.
            </p>
            <p>
              Anyone can relay a root. The relayer address in{" "}
              <code className="font-mono text-xs">RootRelayed</code> is whoever paid the gas,
              and it carries no privilege. A worker that stops does not stop the protocol; a
              worker that lies cannot get a lie past the precompile.
            </p>
            <p>
              Nothing about a user leaves their device. Creditcoin sees a nullifier and a
              Groth16 proof. Not an identity, not a biometric, not a country.
            </p>
            <p>
              Every failure path reverts with a named custom error, and every one of them has
              a test. The list is on{" "}
              <a href="/judge#negative" className="text-brand underline-offset-4 hover:underline">
                /judge
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- limitations */

const LIMITATIONS: Array<{ title: string; body: string }> = [
  {
    title: "hUSD is a test asset",
    body: "We mint it, it has a public faucet, and it is worth nothing. Lender deposits on this deployment are testnet funds.",
  },
  {
    title: "Demo loan terms are minutes, not months",
    body: "TERM and GRACE are constructor arguments. The demo deployment uses 600 and 300 seconds so a full borrow-repay-grow cycle fits in a three-minute video; production values are 30 days and 7 days.",
  },
  {
    title: "Attestcoin cannot prove a payment did not happen",
    body: "Defaults are declared by a deadline passing with principal still outstanding on Creditcoin. That is native state, not a cross-chain absence claim, and we don't pretend otherwise.",
  },
  {
    title: "Personhood is only as strong as World ID",
    body: "Humanline inherits World's sybil resistance, including its limits. An Orb credential is a strong signal, not a legal identity, and a compromised World ID is a compromised Humanline account.",
  },
  {
    title: "Registration depends on a relayed root",
    body: "A proof can only be verified against a root that has already arrived. If no worker is running, new World ID identities cannot register until one relays the root that contains them. Anyone can run the worker, which is the mitigation, not a promise that someone is.",
  },
  {
    title: "World ID 4.0 credentials are not yet verifiable on-chain here",
    body: "The on-chain verifier consumes World ID 3.0 Semaphore proofs. The widget requests the legacy Orb preset for exactly that reason; a 4.0-only credential is reported clearly rather than silently failing.",
  },
  {
    title: "Root history expires after a week",
    body: "A proof built against a root older than the expiry window will be rejected. That is intentional, since it bounds how stale an accepted identity set can be, but it does mean an offline user must re-prove.",
  },
  {
    title: "Testnet RPC and explorer availability",
    body: "This site reads CC3 over a public RPC endpoint. When that endpoint is slow, tables show skeletons and counters show a dash rather than a fabricated zero.",
  },
];

function Limitations() {
  return (
    <section id="limitations" className="flex flex-col gap-6 scroll-mt-20">
      <SectionHeading
        title="Known limitations"
        description="Written down because a system you can't criticise is a system you can't trust."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {LIMITATIONS.map((limitation) => (
          <Card key={limitation.title} size="sm">
            <CardHeader>
              <CardTitle className="flex items-start gap-2 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                {limitation.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{limitation.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
