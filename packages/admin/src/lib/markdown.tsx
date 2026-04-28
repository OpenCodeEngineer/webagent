import React, { Fragment, type ReactNode } from "react";

type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

type MarkdownBlock =
  | { type: "paragraph"; lines: InlineToken[][] }
  | { type: "code"; language?: string; value: string }
  | { type: "list"; ordered: boolean; items: InlineToken[][] };

const INLINE_TOKEN_RE = /`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
const ORDERED_LIST_RE = /^(\d+)\.\s+(.*)$/;
const UNORDERED_LIST_RE = /^[-*+]\s+(.*)$/;

const isSafeHref = (href: string): boolean => {
  if (!href) return false;
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) {
    return true;
  }

  try {
    const parsed = new URL(href, "https://example.com");
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const parseInlineTokens = (input: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  INLINE_TOKEN_RE.lastIndex = 0;
  while ((match = INLINE_TOKEN_RE.exec(input)) !== null) {
    const [fullMatch, code, label, href] = match;
    const start = match.index;
    if (start > cursor) {
      tokens.push({ type: "text", value: input.slice(cursor, start) });
    }

    if (code !== undefined) {
      tokens.push({ type: "code", value: code });
    } else if (label !== undefined && href !== undefined && isSafeHref(href.trim())) {
      tokens.push({ type: "link", value: label, href: href.trim() });
    } else {
      tokens.push({ type: "text", value: fullMatch });
    }

    cursor = start + fullMatch.length;
  }

  if (cursor < input.length) {
    tokens.push({ type: "text", value: input.slice(cursor) });
  }

  return tokens;
};

const parseMarkdown = (input: string): MarkdownBlock[] => {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeStart = line.match(/^```(\w+)?\s*$/);
    if (codeStart) {
      const language = codeStart[1];
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", language, value: codeLines.join("\n") });
      continue;
    }

    const listMatch = line.match(ORDERED_LIST_RE) ?? line.match(UNORDERED_LIST_RE);
    if (listMatch) {
      const ordered = ORDERED_LIST_RE.test(line);
      const items: InlineToken[][] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const currentMatch = ordered ? current.match(ORDERED_LIST_RE) : current.match(UNORDERED_LIST_RE);
        if (!currentMatch) break;
        items.push(parseInlineTokens((currentMatch[2] ?? currentMatch[1] ?? "").trim()));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: InlineToken[][] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!current.trim()) break;
      if (current.startsWith("```")) break;
      if (current.match(ORDERED_LIST_RE) || current.match(UNORDERED_LIST_RE)) break;
      paragraphLines.push(parseInlineTokens(current));
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraphLines });
  }

  return blocks;
};

const renderInlineTokens = (tokens: InlineToken[], keyPrefix: string): ReactNode[] =>
  tokens.map((token, tokenIndex) => {
    const key = `${keyPrefix}-${tokenIndex}`;
    if (token.type === "code") {
      return (
        <code key={key} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-100">
          {token.value}
        </code>
      );
    }

    if (token.type === "link") {
      return (
        <a
          key={key}
          href={token.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-300 underline decoration-sky-500/70 underline-offset-2 hover:text-sky-200"
        >
          {token.value}
        </a>
      );
    }

    return <Fragment key={key}>{token.value}</Fragment>;
  });

export const renderMarkdownToReactNodes = (input: string): ReactNode[] =>
  parseMarkdown(input).map((block, blockIndex) => {
    if (block.type === "code") {
      return (
        <pre
          key={`code-${blockIndex}`}
          className="overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        >
          <code>{block.value}</code>
        </pre>
      );
    }

    if (block.type === "list") {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag
          key={`list-${blockIndex}`}
          className={block.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}
        >
          {block.items.map((tokens, itemIndex) => (
            <li key={`list-item-${blockIndex}-${itemIndex}`}>
              {renderInlineTokens(tokens, `list-token-${blockIndex}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>
      );
    }

    return (
      <p key={`p-${blockIndex}`}>
        {block.lines.map((lineTokens, lineIndex) => (
          <Fragment key={`line-${blockIndex}-${lineIndex}`}>
            {lineIndex > 0 ? <br /> : null}
            {renderInlineTokens(lineTokens, `p-token-${blockIndex}-${lineIndex}`)}
          </Fragment>
        ))}
      </p>
    );
  });
