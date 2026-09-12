/**
 * A deliberately small Markdown parser.
 *
 * `/docs` renders `docs/ATTESTCOIN_INTEGRATION.md` from the repo. That document
 * is written by us, in a known subset of Markdown, so pulling in a full parser
 * (and a sanitiser to go with it) would add weight and an HTML-injection surface
 * for no benefit. This handles exactly that subset and emits a node tree that
 * React renders as elements — no `dangerouslySetInnerHTML` anywhere.
 *
 * Supported: ATX headings, paragraphs, unordered and ordered lists, fenced code
 * blocks, GitHub tables, blockquotes, horizontal rules, and the inline set
 * `code`, `**bold**`, `*italic*` and `[links](…)`.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; depth: 1 | 2 | 3 | 4; children: Inline[]; id: string }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; lang?: string; value: string }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] }
  | { type: "quote"; children: Inline[] }
  | { type: "hr" };

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const depth = heading[1].length as 1 | 2 | 3 | 4;
      const text = heading[2].trim();
      blocks.push({
        type: "heading",
        depth,
        children: parseInline(text),
        id: slugify(text),
      });
      i += 1;
      continue;
    }

    // Table: a header row followed by a delimiter row
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]).map(parseInline));
        i += 1;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", children: parseInline(body.join(" ")) });
      continue;
    }

    // Lists
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const item = ordered
          ? lines[i].match(/^\s*\d+[.)]\s+(.*)$/)
          : lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (!item) break;
        // Fold continuation lines into the same item.
        let text = item[1];
        i += 1;
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
          !/^(#{1,4})\s+/.test(lines[i]) &&
          !/^```/.test(lines[i])
        ) {
          text += ` ${lines[i].trim()}`;
          i += 1;
        }
        items.push(parseInline(text));
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    }
  }

  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Inline parsing, in precedence order: code spans first (their contents are
 * literal), then links, then bold, then italic.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;

  while (rest.length > 0) {
    const code = rest.match(/`([^`]+)`/);
    const link = rest.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
    const strong = rest.match(/\*\*([^*]+)\*\*/);
    const em = rest.match(/(?<!\*)\*([^*]+)\*(?!\*)/);

    const candidates = [
      code && { index: code.index!, match: code, kind: "code" as const },
      link && { index: link.index!, match: link, kind: "link" as const },
      strong && { index: strong.index!, match: strong, kind: "strong" as const },
      em && { index: em.index!, match: em, kind: "em" as const },
    ].filter((c): c is { index: number; match: RegExpMatchArray; kind: "code" | "link" | "strong" | "em" } =>
      Boolean(c),
    );

    if (candidates.length === 0) {
      out.push({ type: "text", value: rest });
      break;
    }

    candidates.sort((a, b) => a.index - b.index);
    const next = candidates[0];

    if (next.index > 0) {
      out.push({ type: "text", value: rest.slice(0, next.index) });
    }

    switch (next.kind) {
      case "code":
        out.push({ type: "code", value: next.match[1] });
        break;
      case "link":
        out.push({
          type: "link",
          href: next.match[2],
          children: parseInline(next.match[1]),
        });
        break;
      case "strong":
        out.push({ type: "strong", children: parseInline(next.match[1]) });
        break;
      case "em":
        out.push({ type: "em", children: parseInline(next.match[1]) });
        break;
    }

    rest = rest.slice(next.index + next.match[0].length);
  }

  return out;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}
