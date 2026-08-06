import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { CodeBlock } from "./CodeBlock";
import { normalizeMathDelimiters } from "@/lib/markdown/normalize-math";

// The single markdown-rendering config for the app: remark-math + remark-gfm
// (tables/strikethrough/autolinks/task-lists) + rehype-katex, with LaTeX
// delimiters normalized before parse so \(...\)/\[...\] also render. `pre`
// is overridden with CodeBlock (copy button). Shared by ChatMessage and the
// /print page so a document renders identically in the chat card and the PDF.
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{ pre: CodeBlock }}
      >
        {normalizeMathDelimiters(content || "")}
      </ReactMarkdown>
    </div>
  );
}