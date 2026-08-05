"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}

export function ChatMessage({ role, content, streaming }: Props) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-paper-3 px-4 py-2.5">
          <div className="mono mb-1 text-right text-[10px] tracking-wide text-rule">
            you
          </div>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-[3px] border border-line bg-paper-2 px-4 py-3 shadow-[0_1px_2px_rgba(31,32,32,0.04)]">
        <div className="mono mb-1.5 flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3">
          <span className="h-1 w-1 rounded-full bg-rule" />
          studygpt
        </div>
        <div className="prose-chat text-ink">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {content || ""}
          </ReactMarkdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
          )}
        </div>
      </div>
    </div>
  );
}