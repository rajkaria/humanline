import { Fragment } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";

/**
 * Render repo Markdown as real React elements.
 *
 * No `dangerouslySetInnerHTML`: the parser produces a node tree and this walks
 * it, so nothing in a source document can inject markup.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      const className =
        block.depth === 1
          ? "text-2xl font-semibold tracking-tight scroll-mt-20"
          : block.depth === 2
            ? "text-xl font-semibold tracking-tight pt-4 scroll-mt-20"
            : block.depth === 3
              ? "text-base font-semibold pt-2 scroll-mt-20"
              : "text-sm font-semibold text-muted-foreground scroll-mt-20";
      const Tag = (`h${block.depth}` as const) satisfies "h1" | "h2" | "h3" | "h4";
      return (
        <Tag id={block.id} className={className}>
          <InlineView nodes={block.children} />
        </Tag>
      );
    }

    case "paragraph":
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <InlineView nodes={block.children} />
        </p>
      );

    case "list":
      return block.ordered ? (
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground marker:text-brand">
          {block.items.map((item, index) => (
            <li key={index} className="leading-relaxed">
              <InlineView nodes={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground marker:text-brand">
          {block.items.map((item, index) => (
            <li key={index} className="leading-relaxed">
              <InlineView nodes={item} />
            </li>
          ))}
        </ul>
      );

    case "code":
      return (
        <pre className="overflow-x-auto rounded-xl bg-card/70 p-4 font-mono text-[11.5px] leading-relaxed ring-1 ring-foreground/10">
          <code>{block.value}</code>
        </pre>
      );

    case "quote":
      return (
        <blockquote className="border-l-2 border-brand/50 pl-4 text-sm text-foreground/80 italic">
          <InlineView nodes={block.children} />
        </blockquote>
      );

    case "hr":
      return <hr className="border-foreground/10" />;

    case "table":
      return (
        <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                {block.head.map((cell, index) => (
                  <TableHead key={index}>
                    <InlineView nodes={cell} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className="text-xs text-muted-foreground">
                      <InlineView nodes={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
  }
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>
          <InlineNode node={node} />
        </Fragment>
      ))}
    </>
  );
}

function InlineNode({ node }: { node: Inline }) {
  switch (node.type) {
    case "text":
      return <>{node.value}</>;
    case "code":
      return (
        <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11.5px] text-foreground/90">
          {node.value}
        </code>
      );
    case "strong":
      return (
        <strong className="font-semibold text-foreground">
          <InlineView nodes={node.children} />
        </strong>
      );
    case "em":
      return (
        <em>
          <InlineView nodes={node.children} />
        </em>
      );
    case "link": {
      const external = /^https?:\/\//.test(node.href);
      return (
        <a
          href={node.href}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer noopener" : undefined}
          className="text-brand underline-offset-4 hover:underline"
        >
          <InlineView nodes={node.children} />
        </a>
      );
    }
  }
}
