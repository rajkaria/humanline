import type { Metadata } from "next";
import Link from "next/link";

import { HashLink } from "@/components/hash-link";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { readLine, type LineJson } from "@/lib/api/v1";
import { getPublicClient } from "@/lib/public-client";
import { PROFILES } from "@/lib/profiles";
import { findHumans, isShort } from "@/lib/share";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ short: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { short } = await params;
  return {
    title: `Human ${short}`,
    description: "A verified human on Creditcoin: one World ID, one credit line, whichever wallet they use.",
  };
}

const hUsd = (units: string) => (Number(BigInt(units)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const date = (s: number | null) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : "–");

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function LineCard({ line }: { line: LineJson }) {
  if (!line.exists) return <p className="text-sm text-muted-foreground">Verified, no credit line opened yet.</p>;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="Limit" value={`${hUsd(line.limit)} hUSD`} />
      <Stat label="Available" value={`${hUsd(line.available)} hUSD`} />
      <Stat label="Repaid on time" value={String(line.loansRepaid)} />
      <Stat label="Late" value={String(line.loansLate)} />
      <Stat label="Line opened" value={date(line.openedAt)} />
      <Stat label="Status" value={line.frozen ? "frozen (defaulted)" : line.principal !== "0" ? "borrowing" : "in good standing"} />
    </div>
  );
}

/**
 * `/h/{short}` — a public, wallet-free page for one human. Everything on it is read from the chain
 * when it renders: which deployments know this human, the wallet they hold today, and the credit
 * history that followed them there.
 */
export default async function HumanPage({ params }: Props) {
  const { short: raw } = await params;
  const short = raw.toLowerCase();
  const client = getPublicClient();
  const matches = isShort(short) ? await findHumans(client, short).catch(() => []) : [];
  const lines = await Promise.all(matches.map((m) => readLine(client, m.profile, m.human).catch(() => null)));

  return (
    <PageShell className="flex flex-col gap-8 pb-24">
      <PageHeader
        eyebrow="Verified human"
        title={`Human ${short}`}
        description="One World ID, proved on Creditcoin against a root that arrived through Attestcoin. The history below belongs to the person, not to any wallet they have held."
      />
      {matches.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No human with this id</CardTitle>
            <CardDescription>
              {isShort(short)
                ? "No registered World ID nullifier on either deployment starts with these 12 hex digits."
                : "A share id is the first 12 hex digits of a World ID nullifier."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link className="text-sm underline" href="/app">
              Verify your own World ID
            </Link>
          </CardContent>
        </Card>
      ) : (
        matches.map((m, i) => (
          <Card key={`${m.profile}-${m.human}`}>
            <CardHeader>
              <CardTitle>{PROFILES[m.profile].label}</CardTitle>
              <CardDescription className="flex flex-col gap-1">
                <span>
                  Nullifier <HashLink value={m.human} kind="root" />
                </span>
                <span>
                  Wallet today <HashLink value={m.wallet} scope="creditcoin" kind="address" />
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>{lines[i] ? <LineCard line={lines[i]!} /> : <p className="text-sm text-muted-foreground">Could not read the line.</p>}</CardContent>
          </Card>
        ))
      )}
    </PageShell>
  );
}
