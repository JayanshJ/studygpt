"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Copy, Check, RefreshCw, Pencil, Download, X, Paperclip } from "lucide-react";
import { Markdown } from "./Markdown";
import { SourcesPanel } from "./SourcesPanel";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { useMotion, fadeUp } from "@/lib/motion";
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
      <motion.div {...m} variants={fadeUp}>
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
          className="mono w-full resize-none rounded-[3px] border border-border bg-surface-2/40 px-3 py-2 text-[13px] leading-6 text-ink outline-none focus:border-border-strong focus-visible:ring-2 focus-visible:ring-ring-accent/60"
        />
        {draftAttachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 pl-5">
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
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            cancel
          </Button>
          <Button variant="accent" size="sm" onClick={commitEdit}>
            save
          </Button>
        </div>
      </motion.div>
    );
  }

  if (isUser) {
    return (
      <motion.div {...m} variants={fadeUp} className="group relative">
        <div className="border-l-2 border-rule pl-3 font-mono italic text-[13px] leading-relaxed text-content">
          {content}
        </div>
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 pl-5">
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
        {onEdit && (
          <div className="absolute -right-1 top-0 opacity-0 transition-opacity group-hover:opacity-100">
            <IconButton variant="ghost" size="sm" label="Edit message" onClick={startEdit}>
              <Pencil size={12} />
            </IconButton>
          </div>
        )}
      </motion.div>
    );
  }

  if (kind === "document") {
    return (
      <motion.div {...m} variants={fadeUp} className="group relative">
        {status && (
          <div className="mono mb-2 flex items-center gap-1.5 text-[11px] text-content-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-rule animate-pulse" />
            {STATUS_LABELS[status] ?? status}
          </div>
        )}
        {reasoning && (
          <details className="mb-3 rounded-[3px] border border-border bg-surface-2/50 px-3 py-2">
            <summary className="mono text-[11px] text-content-faint">thinking</summary>
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
        {!streaming && (
          <>
            <div className="absolute right-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <IconButton variant="ghost" size="sm" label={copied ? "Copied" : "Copy document"} onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </IconButton>
              {canRegenerate && onRegenerate && (
                <IconButton variant="ghost" size="sm" label="Regenerate" onClick={onRegenerate}>
                  <RefreshCw size={13} />
                </IconButton>
              )}
            </div>
            {id && (
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
            <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />
          </>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div {...m} variants={fadeUp} className="group relative">
      {status && (
        <div className="mono mb-2 flex items-center gap-1.5 text-[11px] text-content-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-rule animate-pulse" />
          {STATUS_LABELS[status] ?? status}
        </div>
      )}
      {reasoning && (
        <details className="mb-3 rounded-[3px] border border-border bg-surface-2/50 px-3 py-2">
          <summary className="mono text-[11px] text-content-faint">thinking</summary>
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
      {!streaming && (
        <>
          <div className="absolute right-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <IconButton variant="ghost" size="sm" label={copied ? "Copied" : "Copy message"} onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </IconButton>
            {canRegenerate && onRegenerate && (
              <IconButton variant="ghost" size="sm" label="Regenerate" onClick={onRegenerate}>
                <RefreshCw size={13} />
              </IconButton>
            )}
          </div>
          <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />
        </>
      )}
    </motion.div>
  );
}
