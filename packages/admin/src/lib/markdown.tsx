import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const renderMarkdownToReactNodes = (input: string): ReactNode => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    components={{
      h1: ({ children }) => <h1 className="mt-4 text-2xl font-semibold text-zinc-100 first:mt-0">{children}</h1>,
      h2: ({ children }) => <h2 className="mt-4 text-xl font-semibold text-zinc-100 first:mt-0">{children}</h2>,
      h3: ({ children }) => <h3 className="mt-3 text-lg font-semibold text-zinc-100 first:mt-0">{children}</h3>,
      p: ({ children }) => <p className="whitespace-pre-wrap leading-relaxed">{children}</p>,
      ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
      li: ({ children }) => <li>{children}</li>,
      a: ({ children, href }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-300 underline decoration-sky-500/70 underline-offset-2 hover:text-sky-200"
        >
          {children}
        </a>
      ),
      code: ({ children, className }) => (
        <code className={className ?? "rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-100"}>{children}</code>
      ),
      pre: ({ children }) => (
        <pre className="overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
          {children}
        </pre>
      ),
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-zinc-600 pl-4 text-zinc-300">{children}</blockquote>
      ),
      table: ({ children }) => (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="bg-zinc-800/70">{children}</thead>,
      th: ({ children }) => <th className="border border-zinc-700 px-3 py-2 text-left font-medium">{children}</th>,
      td: ({ children }) => <td className="border border-zinc-700 px-3 py-2 align-top">{children}</td>,
    }}
  >
    {input}
  </ReactMarkdown>
);
