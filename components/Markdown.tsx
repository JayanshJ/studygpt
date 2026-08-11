"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { CodeBlock } from "./CodeBlock";
import { Artifact } from "./Artifact";
import { FlashcardDeck } from "./FlashcardDeck";
import { extractText } from "@/lib/markdown/extract-text";
import { normalizeMathDelimiters } from "@/lib/markdown/normalize-math";

// Route a fenced code block by its language: an ```artifact fence renders a
// live sandboxed HTML visualization; a ```flashcard fence renders an
// interactive flip deck. Any other fence renders the normal CodeBlock. While
// streaming, an artifact/flashcard fence shows a placeholder — mounting the
// widget on a half-streamed block would reload/re-parse it on every chunk.
// `children` is the inner <code> element react-markdown places inside <pre>;
// its className carries the language as `language-<lang>`.
function PreBlock({
  children,
  streaming,
  conversationTitle,
  conversationId,
}: {
  children?: ReactNode;
  streaming?: boolean;
  conversationTitle?: string;
  conversationId?: string;
}) {
  const codeEl = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string } }
    | undefined;
  const className = codeEl?.props?.className ?? "";
  const lang = /language-([\w-]+)/.exec(className)?.[1];
  if (lang === "artifact") {
    if (streaming) {
      return (
        <div className="mono my-2 flex items-center gap-1.5 rounded-[3px] border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-feynman" />
          building visualization…
        </div>
      );
    }
    return <Artifact html={extractText(children)} />;
  }
  if (lang === "flashcard") {
    if (streaming) {
      return (
        <div className="mono my-2 flex items-center gap-1.5 rounded-[3px] border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-feynman" />
          building flashcards…
        </div>
      );
    }
    return (
      <FlashcardDeck
        source={extractText(children)}
        conversationTitle={conversationTitle}
        conversationId={conversationId}
      />
    );
  }
  return <CodeBlock>{children}</CodeBlock>;
}

// The single markdown-rendering config for the app: remark-math + remark-gfm
// (tables/strikethrough/autolinks/task-lists) + rehype-katex, with LaTeX
// delimiters normalized before parse so \(...\)/\[...\] also render. `pre` is
// routed via PreBlock (artifact/flashcard vs. CodeBlock). Shared by ChatMessage
// and the /print page so a document renders identically in the chat card and
// the PDF. `conversationTitle`/`conversationId` thread through so an inline
// flashcard deck can title + link the deck it saves to the originating chat.
export function Markdown({
  content,
  className,
  streaming,
  conversationTitle,
  conversationId,
}: {
  content: string;
  className?: string;
  streaming?: boolean;
  conversationTitle?: string;
  conversationId?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: (props) => (
            <PreBlock
              {...props}
              streaming={streaming}
              conversationTitle={conversationTitle}
              conversationId={conversationId}
            />
          ),
        }}
      >
        {normalizeMathDelimiters(content || "")}
      </ReactMarkdown>
    </div>
  );
}