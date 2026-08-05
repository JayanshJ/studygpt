"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { CodeBlock } from "./CodeBlock";
import { SourcesPanel } from "./SourcesPanel";
import type { SourceEntry, Attachment } from "@/lib/db/schema";

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  sources?: SourceEntry[];
  attachments?: Attachment[] | null;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
  canRegenerate?: boolean;
}

export function ChatMessage({
  role,
  content,
  streaming,
  sources,
  attachments,
  onCopy,
  onRegenerate,
  onEdit,
  canRegenerate,
}: Props) {
  const isUser = role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
    onCopy?.();
  }

  function commitEdit() {
    const t = draft.trim();
    if (!t) return;
    setEditing(false);
    if (t !== content) onEdit?.(t);
  }

  function cancelEdit() {
    setDraft(content);
    setEditing(false);
  }

  if (isUser && editing) {
    return (
      <div className="flex justify-end">
        <div className="w-[80%] max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-paper-3 px-4 py-2.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            rows={Math.min(8, Math.max(1, draft.split("\n").length))}
            className="mono w-full resize-none rounded-[2px] border border-line bg-paper-2 px-2 py-1 text-[13px] leading-6 text-ink outline-none focus:border-ink"
          />
          <div className="mono mt-1 flex justify-end gap-3 text-[10px] tracking-wide text-ink-3">
            <button onClick={cancelEdit} className="hover:text-ink">
              cancel
            </button>
            <button onClick={commitEdit} className="text-rule hover:opacity-80">
              save ↵
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-paper-3 px-4 py-2.5">
          <div className="mono mb-1 flex items-center justify-end gap-2 text-[10px] tracking-wide text-rule">
            <span>you</span>
            {onEdit && (
              <button
                onClick={() => {
                  setDraft(content);
                  setEditing(true);
                }}
                aria-label="Edit and resend"
                className="opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
              >
                edit
              </button>
            )}
          </div>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {content}
          </div>
          {attachments && attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a, i) =>
                a.type === "image" ? (
                  <img
                    key={i}
                    src={a.dataUrl}
                    alt={a.name}
                    className="max-h-32 rounded-[2px] border border-line object-contain"
                  />
                ) : (
                  <span
                    key={i}
                    className="mono rounded-[2px] border border-line bg-paper-2 px-2 py-0.5 text-[11px] text-ink-2"
                  >
                    📎 {a.name} ({a.charCount.toLocaleString()}c)
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-start">
      <div className="msg-bubble max-w-[85%] rounded-[3px] border border-line bg-paper-2 px-4 py-3 shadow-[0_1px_2px_rgba(31,32,32,0.04)]">
        <div className="mono mb-1.5 flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3">
          <span className="h-1 w-1 rounded-full bg-rule" />
          studygpt
          <div className="ml-auto flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <button onClick={copy} aria-label="Copy message" className="hover:text-ink">
              {copied ? "copied" : "copy"}
            </button>
            {canRegenerate && onRegenerate && !streaming && (
              <button onClick={onRegenerate} aria-label="Regenerate" className="hover:text-ink">
                regen
              </button>
            )}
          </div>
        </div>
        <div className="prose-chat text-ink">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{ pre: CodeBlock }}
          >
            {content || ""}
          </ReactMarkdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
          )}
        </div>
        {!streaming && <SourcesPanel sources={sources ?? []} />}
      </div>
    </div>
  );
}