"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { CodeBlock } from "./CodeBlock";
import { Artifact } from "./Artifact";
import { extractText } from "@/lib/markdown/extract-text";
import { normalizeMathDelimiters } from "@/lib/markdown/normalize-math";

// Route a fenced code block by its language: an ```artifact fence renders a
// live sandboxed HTML visualization; any other fence renders the normal
// CodeBlock. While streaming, an artifact fence shows a placeholder —
// mounting an iframe on a half-streamed HTML document would reload it on
// every chunk and flash broken content. `children` is the inner <code>
// element react-markdown places inside <pre>; its className carries the
// language as `language-<lang>`.
function PreBlock({ children, streaming }: { children?: ReactNode; streaming?: boolean }) {
  const codeEl = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string } }
    | undefined;
  const className = codeEl?.props?.className ?? "";
  const lang = /language-([\w-]+)/.exec(className)?.[1];
  if (lang === "artifact") {
    if (streaming) {
      return (
        <div className="mono my-2 rounded-[3px] border border-line bg-paper-2 px-4 py-3 text-[12px] text-ink-3">
          building visualization…
        </div>
      );
    }
    return <Artifact html={extractText(children)} />;
  }
  return <CodeBlock>{children}</CodeBlock>;
}

// The single markdown-rendering config for the app: remark-math + remark-gfm
// (tables/strikethrough/autolinks/task-lists) + rehype-katex, with LaTeX
// delimiters normalized before parse so \(...\)/\[...\] also render. `pre` is
// routed via PreBlock (artifact vs. CodeBlock). Shared by ChatMessage and the
// /print page so a document renders identically in the chat card and the PDF.
export function Markdown({ content, className, streaming }: { content: string; className?: string; streaming?: boolean }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{ pre: (props) => <PreBlock {...props} streaming={streaming} /> }}
      >
        {normalizeMathDelimiters(content || "")}
      </ReactMarkdown>
    </div>
  );
}