"use client";

import { useState, useMemo } from "react";
import { motion } from "motion/react";
import { Copy, Check, RefreshCw, Pencil, Download, X, Paperclip } from "lucide-react";
import { Markdown } from "./Markdown";
import { SourcesPanel } from "./SourcesPanel";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { useMotion, fadeUp } from "@/lib/motion";
import { estimateTokens, userTurnText } from "@/lib/tokens";
import type { SourceEntry, Attachment } from "@/lib/db/schema";

// Shallow equality on the attachments an edit produced vs. the originals, so
// we only persist (and re-run) when something actually changed. Compares by
// identity of each attachment's distinguishing fields; attachments are
// immutable once created (image data URLs / inlined file text).
function sameAttachments(a: Attachment[], b: Attachment[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.type !== y.type) return false;
    if (x.type === "image" && y.type === "image") {
      if (x.dataUrl !== y.dataUrl || x.name !== y.name) return false;
    } else if (x.type === "file" && y.type === "file") {
      if (x.name !== y.name || x.text !== y.text) return false;
    } else {
      return false;
    }
  }
  return true;
}

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  sources?: SourceEntry[];
  attachments?: Attachment[] | null;
  kind?: "chat" | "document";
  id?: string;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newContent: string, attachments: Attachment[]) => void;
  canRegenerate?: boolean;
  conversationTitle?: string;
  conversationId?: string;
  status?: string;
  reasoning?: string;
  allMaterials?: { id: string; title: string }[];
}

const STATUS_LABELS: Record<string, string> = {
  thinking: "thinking…",
  "reading-materials": "reading your materials…",
  "drafting-document": "drafting document…",
  searching: "searching the web…",
  writing: "writing…",
};

export function ChatMessage({
  role,
  content,
  streaming,
  sources,
  attachments,
  kind,
  id,
  onCopy,
  onRegenerate,
  onEdit,
  canRegenerate,
  conversationTitle,
  conversationId,
  status,
  reasoning,
  allMaterials,
}: Props) {
  const isUser = role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([]);
  const [copied, setCopied] = useState(false);
  const m = useMotion();
  const tok = useMemo(
    () => estimateTokens(userTurnText(content, attachments)),
    [content, attachments],
  );

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
    const atts = draftAttachments;
    setEditing(false);
    const contentChanged = t !== content;
    const attsChanged = !sameAttachments(atts, attachments ?? []);
    if (contentChanged || attsChanged) onEdit?.(t, atts);
  }

  function cancelEdit() {
    setDraft(content);
    setDraftAttachments(attachments ? [...attachments] : []);
    setEditing(false);
  }

  function removeDraftAttachment(i: number) {
    setDraftAttachments((prev) => prev.filter((_, idx) => idx !== i));
  }

  function startEdit() {
    setDraft(content);
    setDraftAttachments(attachments ? [...attachments] : []);
    setEditing(true);
  }

  if (isUser && editing) {
    return (
      <motion.div {...m} variants={fadeUp} className="flex justify-end">
        <div className="w-[80%] max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-surface-2 px-4 py-2.5">
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
            className="mono w-full resize-none rounded-[3px] border border-border bg-surface px-2 py-1 text-[13px] leading-6 text-ink outline-none focus:border-border-strong focus-visible:ring-2 focus-visible:ring-ring-accent/60"
          />
          {draftAttachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {draftAttachments.map((a, i) =>
                a.type === "image" ? (
                  <div key={i} className="relative">
                    <img
                      src={a.dataUrl}
                      alt={a.name}
                      className="max-h-20 rounded-[3px] border border-border object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => removeDraftAttachment(i)}
                      aria-label="Remove attachment"
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-content-faint hover:text-rule"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <span
                    key={i}
                    className="mono flex items-center gap-1.5 rounded-[3px] border border-border bg-surface px-2 py-0.5 text-[11px] text-content-muted"
                  >
                    <Paperclip size={11} /> {a.name} ({a.charCount.toLocaleString()}c)
                    <button
                      type="button"
                      onClick={() => removeDraftAttachment(i)}
                      aria-label="Remove attachment"
                      className="text-content-faint hover:text-rule"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ),
              )}
            </div>
          )}
          <div className="mono mt-1 flex justify-end gap-3 text-[10px] tracking-wide text-content-faint">
            <button onClick={cancelEdit} className="hover:text-content">
              cancel
            </button>
            <button onClick={commitEdit} className="text-rule hover:opacity-80">
              save
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (isUser) {
    return (
      <motion.div {...m} variants={fadeUp} className="group flex justify-end">
        <div className="max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-surface-2 px-4 py-2.5">
          <div className="mono mb-1 flex items-center justify-end gap-2 text-[10px] tracking-wide text-rule">
            <span>you</span>
            <span className="text-content-faint">· {tok.toLocaleString()} tok</span>
            {onEdit && (
              <IconButton
                label="Edit and resend"
                size="sm"
                className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-content"
                onClick={startEdit}
              >
                <Pencil size={12} />
              </IconButton>
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
                    className="max-h-32 rounded-[3px] border border-border object-contain"
                  />
                ) : (
                  <span
                    key={i}
                    className="mono flex items-center gap-1 rounded-[3px] border border-border bg-surface px-2 py-0.5 text-[11px] text-content-muted"
                  >
                    <Paperclip size={11} /> {a.name} ({a.charCount.toLocaleString()}c)
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  if (kind === "document") {
    return (
      <motion.div {...m} variants={fadeUp} className="group flex justify-start">
        <div className="max-w-[680px] rounded-[4px] border border-border bg-surface px-8 py-7 shadow-card">
          <div className="mono mb-3 flex items-center gap-2 text-[10px] tracking-wide text-content-faint">
            <span className="h-1 w-1 rounded-full bg-rule" />
            document
            <span>· {tok.toLocaleString()} tok</span>
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <IconButton label={copied ? "Copied" : "Copy document"} size="sm" onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </IconButton>
              {canRegenerate && onRegenerate && !streaming && (
                <IconButton label="Regenerate" size="sm" onClick={onRegenerate}>
                  <RefreshCw size={13} />
                </IconButton>
              )}
            </div>
          </div>
          {status && (
            <div className="mono mb-2 flex items-center gap-1.5 text-[10px] tracking-wide text-content-faint">
              <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-feynman" />
              {STATUS_LABELS[status] ?? status}
            </div>
          )}
          {reasoning && (
            <details className="mb-3 rounded-[3px] border border-border bg-surface-2/60 px-3 py-2">
              <summary className="mono cursor-pointer text-[10px] tracking-wide text-content-faint hover:text-content">
                thinking
              </summary>
              <Markdown content={reasoning} className="prose-chat mt-2 text-[13px] text-content-muted" />
            </details>
          )}
          <Markdown
            content={content}
            className="prose-chat text-ink"
            streaming={streaming}
            conversationTitle={conversationTitle}
            conversationId={conversationId}
          />
          {streaming && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
          )}
          {!streaming && id && (
            <div className="mono mt-5 flex items-center gap-3 text-[12px] tracking-wide">
              <Button asChild variant="primary" size="sm">
                <a href={`/print/${id}`} target="_blank" rel="noopener noreferrer">
                  <Download size={14} />
                  download PDF
                </a>
              </Button>
              <span className="text-content-faint">opens a clean page, then click save as PDF</span>
            </div>
          )}
          {!streaming && <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div {...m} variants={fadeUp} className="group flex justify-start">
      <div className="max-w-[85%] rounded-[4px] border border-border bg-surface px-5 py-4 shadow-card">
        <div className="mono mb-1.5 flex items-center gap-1.5 text-[10px] tracking-wide text-content-faint">
          <span className="h-1 w-1 rounded-full bg-rule" />
          studygpt
          <span>· {tok.toLocaleString()} tok</span>
          <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <IconButton label={copied ? "Copied" : "Copy message"} size="sm" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </IconButton>
            {canRegenerate && onRegenerate && !streaming && (
              <IconButton label="Regenerate" size="sm" onClick={onRegenerate}>
                <RefreshCw size={13} />
              </IconButton>
            )}
          </div>
        </div>
        {status && (
          <div className="mono mb-2 flex items-center gap-1.5 text-[10px] tracking-wide text-content-faint">
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-feynman" />
            {STATUS_LABELS[status] ?? status}
          </div>
        )}
        {reasoning && (
          <details className="mb-3 rounded-[3px] border border-border bg-surface-2/60 px-3 py-2">
            <summary className="mono cursor-pointer text-[10px] tracking-wide text-content-faint hover:text-content">
              thinking
            </summary>
            <Markdown content={reasoning} className="prose-chat mt-2 text-[13px] text-content-muted" />
          </details>
        )}
        <Markdown
          content={content}
          className="prose-chat text-ink"
          streaming={streaming}
          conversationTitle={conversationTitle}
          conversationId={conversationId}
        />
        {streaming && (
          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
        )}
        {!streaming && <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />}
      </div>
    </motion.div>
  );
}