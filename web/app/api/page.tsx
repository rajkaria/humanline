import type { Metadata } from "next";

import { CommandBlock } from "@/components/command-block";
import { PageHeader, PageShell, SectionHeading } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OPENAPI } from "@/lib/api/openapi";

export const metadata: Metadata = {
  title: "API",
  description: "Public, CORS-open read API: is this wallet a verified human, and what is this human's credit line.",
};

type Operation = {
  operationId: string;
  summary: string;
  parameters: ReadonlyArray<{ name: string; in: string; required: boolean; description: string }>;
  responses: Record<string, { description: string; content?: { "application/json": { example?: unknown } } }>;
};

export default function ApiPage() {
  const paths = Object.entries(OPENAPI.paths) as Array<[string, { get: Operation }]>;
  return (
    <PageShell width="wide" className="flex flex-col gap-12 pb-24">
      <PageHeader
        eyebrow="For builders"
        title="Public API"
        description={OPENAPI.info.description}
      />

      <section className="flex flex-col gap-4">
        <SectionHeading id="spec" title="Specification" description="OpenAPI 3.1, machine-readable. Drop it into any client generator and go." />
        <CommandBlock command="curl -s https://humanline.credit/api/openapi.json" />
        <p className="text-sm text-muted-foreground">
          Prefer TypeScript? The same reads, plus a React hook and the <code className="font-mono">HumanGated</code> Solidity
          modifier, ship in <code className="font-mono">@humanline/sdk</code>.
        </p>
      </section>

      {paths.map(([path, { get }]) => {
        const example = get.responses["200"]?.content?.["application/json"]?.example;
        const sample = path.replace("{address}", "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3").replace(
          "{nullifier}",
          "0x06d6d24ba1cb97b3d3456e9a3bdfc4f707072ecd96e79998dfb7dce49529b6d4",
        );
        return (
          <section key={path} className="flex flex-col gap-4">
            <SectionHeading id={get.operationId} title={get.summary} description={`GET ${path}`} />
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-sm">GET {path}</CardTitle>
                <CardDescription>
                  {get.parameters.map((p) => (
                    <span key={p.name} className="block">
                      <code className="font-mono">{p.name}</code> ({p.in}
                      {p.required ? ", required" : ""}): {p.description}
                    </span>
                  ))}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <CommandBlock command={`curl -s "https://humanline.credit${sample}"`} />
                {example ? (
                  <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs">{JSON.stringify(example, null, 2)}</pre>
                ) : null}
                <ul className="text-xs text-muted-foreground">
                  {Object.entries(get.responses).map(([code, r]) => (
                    <li key={code}>
                      <code className="font-mono">{code}</code> {r.description}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        );
      })}
    </PageShell>
  );
}
