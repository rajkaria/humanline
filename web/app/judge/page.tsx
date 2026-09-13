import {
  BookCheckIcon,
  FileJson2Icon,
  ShieldAlertIcon,
  TerminalIcon,
} from "lucide-react";
import type { Metadata } from "next";

import { BrowserVerifyDemo } from "@/components/browser-verify-demo";
import { CommandBlock } from "@/components/command-block";
import { E2eEvidence } from "@/components/e2e-evidence";
import { EvidenceLog } from "@/components/evidence-log";
import { HashLink } from "@/components/hash-link";
import { PageHeader, PageShell, SectionHeading } from "@/components/page-shell";
import { ProveItWidget } from "@/components/prove-it-widget";
import { SignalHashCheck } from "@/components/signal-hash-check";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  creditcoinTestnet,
  EVM_V1_DECODER,
  PRECOMPILES,
  PROOF_BUILDER_URL,
  SOURCE_CHAIN_LIST,
  scopeForChainKey,
  TREE_CHANGED_TOPIC,
} from "@/lib/chains";
import { CONTRACT_LIST, WORLD_ACTION, WORLD_APP_ID, WORLD_RP_ID } from "@/lib/contracts";
import { PROFILES, termLabel } from "@/lib/profiles";
import { NEGATIVE_PATHS, NEGATIVE_PATH_FILTER } from "@/lib/negative-paths";

export const metadata: Metadata = {
  title: "Judge",
  description:
    "Every Humanline claim, with the exact command that checks it — no wallet required.",
};

// The RP status probe hits a third-party endpoint; never cache a failure.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RPC = creditcoinTestnet.rpcUrls.default.http[0];

export default async function JudgePage() {
  const rpStatus = await fetchRpStatus();

  return (
    <PageShell width="wide" className="flex flex-col gap-14 pb-24">
      <PageHeader
        eyebrow="Reproducibility"
        title="Check every claim yourself"
        description="Nothing on this page asks you to trust the site. Each row is a value you can read off the chain, a command you can run, or a test you can execute."
      />

      <Addresses />
      <ProductionAddresses />

      <section className="flex flex-col gap-4">
        <SectionHeading
          id="happened"
          title="What has already happened"
          description="Not instructions — receipts. A real World ID identity verified on Creditcoin, and a full borrow-and-repay cycle, both with transaction hashes you can open."
        />
        <E2eEvidence />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          id="prove"
          title="Prove a transaction, live"
          description="The same verification AttestedWorldID performs, as a read-only call."
        />
        <ProveItWidget />
        <BrowserVerifyDemo />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          id="commands"
          title="Verify without a wallet"
          description="Copy, paste, run. `cast` is Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup."
        />
        <VerifyCommands />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          id="negative"
          title="Negative paths"
          description="Every attack in the security model, the guard that stops it, and the test that fires it."
        />
        <NegativePathTable />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          id="worldid"
          title="World ID configuration"
          description="What the widget is pinned to, and what the registry pinned itself to at deployment."
        />
        <WorldIdCard rpStatus={rpStatus} />
        <SignalHashCheck />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          id="evidence"
          title="Relay evidence"
          description="The worker's own log, committed to the repo at evidence/relay-log.jsonl."
        />
        <EvidenceLog />
      </section>
    </PageShell>
  );
}

function Addresses() {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        id="addresses"
        title="Addresses"
        description={`Everything on Creditcoin CC3 testnet, chainId ${creditcoinTestnet.id}. The table below is the reproducible deployment — the one you can run end to end with World's simulator. The Orb-tree deployment for real verified humans follows it.`}
      />

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="hidden xl:table-cell">What it does</TableHead>
              <TableHead className="text-right">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CONTRACT_LIST.map((contract) => (
              <TableRow key={contract.key}>
                <TableCell className="font-medium whitespace-nowrap">{contract.name}</TableCell>
                <TableCell>
                  {contract.address ? (
                    <HashLink value={contract.address} scope="creditcoin" kind="address" />
                  ) : (
                    <span className="text-xs text-muted-foreground">not deployed yet</span>
                  )}
                </TableCell>
                <TableCell className="hidden max-w-md text-xs text-muted-foreground xl:table-cell">
                  {contract.blurb}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={contract.source === "missing" ? "outline" : "secondary"}>
                    {contract.source === "deployments"
                      ? "deployments.json"
                      : contract.source === "env"
                        ? "env"
                        : "—"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}

            <TableRow>
              <TableCell className="font-medium whitespace-nowrap">
                BlockProver precompile
              </TableCell>
              <TableCell>
                <HashLink value={PRECOMPILES.blockProver} kind="address" />
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                Attestcoin&rsquo;s native query verifier. No root enters the system without it.
              </TableCell>
              <TableCell className="text-right">
                <Badge variant="outline">native</Badge>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium whitespace-nowrap">ChainInfo precompile</TableCell>
              <TableCell>
                <HashLink value={PRECOMPILES.chainInfo} kind="address" />
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                Supported chains and attested tips — the finality-depth guard.
              </TableCell>
              <TableCell className="text-right">
                <Badge variant="outline">native</Badge>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium whitespace-nowrap">
                AttestorStash precompile
              </TableCell>
              <TableCell>
                <HashLink value={PRECOMPILES.attestorStash} kind="address" />
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                Attestor counts per source chain — the quorum floor.
              </TableCell>
              <TableCell className="text-right">
                <Badge variant="outline">native</Badge>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium whitespace-nowrap">EvmV1Decoder library</TableCell>
              <TableCell>
                <HashLink value={EVM_V1_DECODER} scope="creditcoin" kind="address" />
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                Deployed decoder the contracts link against.
              </TableCell>
              <TableCell className="text-right">
                <Badge variant="outline">shared</Badge>
              </TableCell>
            </TableRow>

            {SOURCE_CHAIN_LIST.map((chain) => (
              <TableRow key={chain.chainKey}>
                <TableCell className="font-medium whitespace-nowrap">
                  World ID manager · {chain.label}
                </TableCell>
                <TableCell>
                  <HashLink
                    value={chain.identityManager}
                    scope={scopeForChainKey(chain.chainKey)}
                    kind="address"
                  />
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                  {chain.tier === "production"
                    ? "World's Orb identity tree. Updated roughly hourly by World's sequencer."
                    : "World's staging tree, used by the simulator and reproducible by a judge."}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline">chainKey {chain.chainKey}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <dl className="grid gap-2 rounded-xl bg-card/40 p-4 text-xs ring-1 ring-foreground/10 sm:grid-cols-2">
        <KeyValue label="RPC" value={RPC} />
        <KeyValue label="Proof builder" value={PROOF_BUILDER_URL} />
        <KeyValue label="Explorer" value={creditcoinTestnet.blockExplorers.default.url} />
        <KeyValue label="TreeChanged topic0" value={TREE_CHANGED_TOPIC} />
      </dl>
    </section>
  );
}

/**
 * The second deployment: same contracts, wired to the Ethereum mainnet Orb tree.
 *
 * A judge should be able to see that "real humans can use this" is a claim backed by
 * deployed, verified bytecode rather than a roadmap line.
 */
function ProductionAddresses() {
  const profile = PROFILES.production;
  const rows = profile.deployment.list.filter((c) =>
    ["humanRegistry", "creditLine", "humanGate"].includes(c.key),
  );
  if (!profile.available) return null;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        id="addresses-production"
        title="The Orb-tree deployment"
        description={`The same contracts verifying against the Ethereum mainnet identity tree instead of Sepolia staging — ${termLabel(profile)} terms, for people with an Orb-verified World ID. Open /app?profile=production to use it. hUSD and both AttestedWorldID instances are shared with the table above.`}
      />
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="hidden xl:table-cell">Verifies against</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((contract) => (
              <TableRow key={contract.key}>
                <TableCell className="font-medium whitespace-nowrap">{contract.name}</TableCell>
                <TableCell>
                  {contract.address ? (
                    <HashLink value={contract.address} scope="creditcoin" kind="address" />
                  ) : (
                    <span className="text-xs text-muted-foreground">not deployed yet</span>
                  )}
                </TableCell>
                <TableCell className="hidden max-w-md text-xs text-muted-foreground xl:table-cell">
                  {contract.key === "humanRegistry"
                    ? "AttestedWorldID (Ethereum mainnet) — World's Orb-verified tree, relayed by Attestcoin."
                    : contract.blurb}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function VerifyCommands() {
  const registry = CONTRACT_LIST.find((c) => c.key === "humanRegistry")?.address;
  const mainnet = CONTRACT_LIST.find((c) => c.key === "attestedWorldIDMainnet")?.address;
  const creditLine = CONTRACT_LIST.find((c) => c.key === "creditLine")?.address;

  const A = (address: string | undefined, fallback: string) => address ?? `<${fallback}>`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TerminalIcon className="size-4 text-brand" />
            Read the chain
          </CardTitle>
          <CardDescription>
            Nothing here needs a private key; every call is an <code className="font-mono">eth_call</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CommandBlock
            title="How many real World ID roots have been relayed?"
            command={`cast call ${A(mainnet, "AttestedWorldID")} \\\n  "rootCount()(uint256)" \\\n  --rpc-url ${RPC}\n\ncast call ${A(mainnet, "AttestedWorldID")} \\\n  "humansAddedTotal()(uint256)" \\\n  --rpc-url ${RPC}`}
          />
          <CommandBlock
            title="Is an address a unique human?"
            description="This is the entire lender integration."
            command={`cast call ${A(registry, "HumanRegistry")} \\\n  "isHuman(address)(bool)" 0xYourWallet \\\n  --rpc-url ${RPC}`}
          />
          <CommandBlock
            title="What is that human's credit line?"
            command={`cast call ${A(creditLine, "CreditLine")} \\\n  "lineOf(uint256)((uint256,uint256,uint64,uint64,uint32,uint32,bool))" \\\n  $(cast call ${A(registry, "HumanRegistry")} "humanOf(address)(uint256)" 0xYourWallet --rpc-url ${RPC}) \\\n  --rpc-url ${RPC}`}
          />
          <CommandBlock
            title="Ask the precompiles directly"
            description="Supported chains from 0x0FD3, attestor count from 0x0FD4."
            command={`cast call ${PRECOMPILES.chainInfo} \\\n  "get_supported_chains()((uint64,uint64,bytes,uint8)[])" \\\n  --rpc-url ${RPC}\n\ncast call ${PRECOMPILES.attestorStash} \\\n  "getAttestorsCount(uint64)(uint32)" 3 \\\n  --rpc-url ${RPC}`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookCheckIcon className="size-4 text-brand-2" />
            Run the suite
          </CardTitle>
          <CardDescription>
            Clone with <code className="font-mono">--recurse-submodules</code>, then{" "}
            <code className="font-mono">bun install &amp;&amp; (cd contracts &amp;&amp; bun install)</code>.
            Foundry is not vendored — install it with{" "}
            <code className="font-mono">curl -L https://foundry.paradigm.xyz | bash &amp;&amp; foundryup</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CommandBlock
            title="Every contract test, including the negative paths"
            command={`cd contracts && forge test -vv`}
          />
          <CommandBlock
            title="Only the negative paths"
            description="52 tests. Each one should reject the attack listed below, most with a named custom error."
            command={`cd contracts && forge test --match-test "${NEGATIVE_PATH_FILTER}" -vvv`}
          />
          <CommandBlock
            title="One row from the table below"
            description="Every test name in that table is checked against contracts/test/*.t.sol by web's own test suite, so none of them can be invented."
            command={`cd contracts && forge test --match-test "^test_RevertsOnThinAttestorQuorum$" -vvv`}
          />
          <CommandBlock
            title="Fork tests against live CC3 state"
            description="Skipped unless CC3_FORK is set, so the default suite stays hermetic."
            command={`cd contracts && CC3_FORK=${RPC} forge test --match-contract Fork -vv`}
          />
          <CommandBlock
            title="Web unit tests — World ID hashing and formatting"
            description="Reproduces hashToField and the external nullifier exactly as the Solidity does."
            command={`cd web && bun test`}
          />
          <CommandBlock
            title="Build a proof for any Ethereum transaction"
            description="The same endpoint the widget above uses."
            command={`cast rpc --rpc-url ${RPC} eth_blockNumber\n\n# proof builder (chainKey 3 = Ethereum mainnet)\n${PROOF_BUILDER_URL}/api/v1/proof-by-tx/3/<txHash>`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function NegativePathTable() {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Attack</TableHead>
            <TableHead className="hidden lg:table-cell">What stops it</TableHead>
            <TableHead>Reverts with</TableHead>
            <TableHead>Test</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {NEGATIVE_PATHS.map((path) => (
            <TableRow key={path.test}>
              <TableCell className="font-medium whitespace-nowrap">
                <span className="flex items-center gap-2">
                  <ShieldAlertIcon className="size-3.5 shrink-0 text-warning" aria-hidden />
                  {path.threat}
                </span>
              </TableCell>
              <TableCell className="hidden max-w-lg text-xs text-muted-foreground lg:table-cell">
                {path.defence}
              </TableCell>
              <TableCell className="font-mono text-xs whitespace-nowrap">
                {path.error ?? <span className="text-muted-foreground">proof invalid</span>}
              </TableCell>
              <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                {path.suite}.t.sol :: {path.test}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type RpStatus =
  | { ok: true; body: string }
  | { ok: false; reason: string };

async function fetchRpStatus(): Promise<RpStatus | null> {
  try {
    const response = await fetch(
      `https://developer.world.org/api/v4/rp-status/${WORLD_RP_ID}`,
      { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(6000) },
    );
    const text = (await response.text()).slice(0, 400);
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    return { ok: true, body: text };
  } catch {
    // The endpoint is a convenience, not a dependency. If it is unreachable the
    // section simply says so rather than failing the page.
    return null;
  }
}

function WorldIdCard({ rpStatus }: { rpStatus: RpStatus | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileJson2Icon className="size-4 text-brand" />
          World ID parameters
        </CardTitle>
        <CardDescription>
          The app id and action here must match{" "}
          <code className="font-mono text-xs">HumanRegistry.APP_ID()</code> and{" "}
          <code className="font-mono text-xs">HumanRegistry.ACTION()</code>, because the
          registry derives its external nullifier from them at construction.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
          <KeyValue label="app_id" value={WORLD_APP_ID} />
          <KeyValue label="action" value={WORLD_ACTION} />
          <KeyValue label="rp_id" value={WORLD_RP_ID} />
          <KeyValue label="preset" value="orbLegacy · allow_legacy_proofs" />
        </dl>

        <CommandBlock
          title="Recompute the external nullifier"
          description="hashToField(abi.encodePacked(hashToField(app_id), action)) — the web test asserts this equals what the registry stores."
          command={`cd web && bun test test/worldid.test.ts`}
        />

        <div className="flex flex-col gap-1 rounded-lg bg-muted/30 p-3 text-xs">
          <span className="font-medium">Relying-party status</span>
          {rpStatus === null ? (
            <span className="text-muted-foreground">
              developer.world.org did not answer. The RP status endpoint is informational —
              registration is verified on Creditcoin, not by World&rsquo;s API.
            </span>
          ) : rpStatus.ok ? (
            <pre className="overflow-x-auto font-mono text-[11px] text-muted-foreground">
              {rpStatus.body}
            </pre>
          ) : (
            <span className="text-muted-foreground">
              developer.world.org returned {rpStatus.reason}.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-[11px]" title={value}>
        {value}
      </dd>
    </div>
  );
}
