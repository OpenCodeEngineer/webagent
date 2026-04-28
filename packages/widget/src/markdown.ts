type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string };

type MarkdownBlock =
  | { type: 'paragraph'; lines: InlineToken[][] }
  | { type: 'code'; language?: string; value: string }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] };

const INLINE_TOKEN_RE = /`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
const ORDERED_LIST_RE = /^(\d+)\.\s+(.*)$/;
const UNORDERED_LIST_RE = /^[-*+]\s+(.*)$/;

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isSafeHref = (href: string): boolean => {
  if (!href) return false;
  if (href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
    return true;
  }

  try {
    const parsed = new URL(href, 'https://example.com');
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol);
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
      tokens.push({ type: 'text', value: input.slice(cursor, start) });
    }

    if (code !== undefined) {
      tokens.push({ type: 'code', value: code });
    } else if (label !== undefined && href !== undefined && isSafeHref(href.trim())) {
      tokens.push({ type: 'link', value: label, href: href.trim() });
    } else {
      tokens.push({ type: 'text', value: fullMatch });
    }

    cursor = start + fullMatch.length;
  }

  if (cursor < input.length) {
    tokens.push({ type: 'text', value: input.slice(cursor) });
  }

  return tokens;
};

const parseMarkdown = (input: string): MarkdownBlock[] => {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeStart = line.match(/^```(\w+)?\s*$/);
    if (codeStart) {
      const language = codeStart[1];
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: 'code', language, value: codeLines.join('\n') });
      continue;
    }

    const listMatch = line.match(ORDERED_LIST_RE) ?? line.match(UNORDERED_LIST_RE);
    if (listMatch) {
      const ordered = ORDERED_LIST_RE.test(line);
      const items: InlineToken[][] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const currentMatch = ordered ? current.match(ORDERED_LIST_RE) : current.match(UNORDERED_LIST_RE);
        if (!currentMatch) break;
        items.push(parseInlineTokens((currentMatch[2] ?? currentMatch[1] ?? '').trim()));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraphLines: InlineToken[][] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (!current.trim()) break;
      if (current.startsWith('```')) break;
      if (current.match(ORDERED_LIST_RE) || current.match(UNORDERED_LIST_RE)) break;
      paragraphLines.push(parseInlineTokens(current));
      index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }

  return blocks;
};

const renderInlineTokens = (tokens: InlineToken[]): string =>
  tokens
    .map((token) => {
      if (token.type === 'code') {
        return `<code>${escapeHtml(token.value)}</code>`;
      }

      if (token.type === 'link') {
        return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(token.value)}</a>`;
      }

      return escapeHtml(token.value);
    })
    .join('');

export const renderMarkdownToSafeHtml = (input: string): string =>
  parseMarkdown(input)
    .map((block) => {
      if (block.type === 'code') {
        const languageClass = block.language ? ` class="language-${escapeHtml(block.language)}"` : '';
        return `<pre><code${languageClass}>${escapeHtml(block.value)}</code></pre>`;
      }

      if (block.type === 'list') {
        const tag = block.ordered ? 'ol' : 'ul';
        const items = block.items.map((item) => `<li>${renderInlineTokens(item)}</li>`).join('');
        return `<${tag}>${items}</${tag}>`;
      }

      const lines = block.lines.map((line) => renderInlineTokens(line)).join('<br>');
      return `<p>${lines}</p>`;
    })
    .join('');
