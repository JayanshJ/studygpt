"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { QuizItem, McqItem, TrueFalseItem } from "@/lib/artifacts/kinds/quiz";

interface QuizArtifactProps {
  items: QuizItem[];
}

export function QuizArtifact({ items }: QuizArtifactProps) {
  return (
    <ol className="space-y-4">
      {items.map((item, i) => (
        <li key={i}>
          <QuizQuestion item={item} index={i} />
        </li>
      ))}
    </ol>
  );
}

function QuizQuestion({ item, index }: { item: QuizItem; index: number }) {
  const isMcq = "options" in item;
  if (isMcq) return <McqQuestion item={item as McqItem} index={index} />;
  return <TrueFalseQuestion item={item as TrueFalseItem} index={index} />;
}

function McqQuestion({ item, index }: { item: McqItem; index: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="rounded-control border border-border/70 bg-surface/50 p-3">
      <p className="text-[13px] font-medium leading-relaxed text-content">
        <span className="mono mr-1.5 text-content-faint">{index + 1}.</span>
        {item.prompt}
      </p>
      <div className="mt-2.5 space-y-1.5">
        {item.options.map((option, i) => {
          const isCorrect = i === item.answer;
          const isSelected = i === selected;
          return (
            <button
              key={i}
              type="button"
              disabled={revealed}
              onClick={() => {
                setSelected(i);
                setRevealed(true);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-control border px-3 py-2 text-left text-[12px] leading-relaxed transition-colors",
                !revealed && "border-border hover:border-border-strong hover:bg-surface-2 text-content",
                revealed && isCorrect && "border-feynman/60 bg-feynman/10 text-content",
                revealed && isSelected && !isCorrect && "border-band-slipping/60 bg-band-slipping/10 text-content",
                revealed && !isCorrect && !isSelected && "border-border text-content-faint opacity-60",
              )}
            >
              <span className={cn(
                "mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                !revealed && "border border-border text-content-faint",
                revealed && isCorrect && "bg-feynman text-paper",
                revealed && isSelected && !isCorrect && "bg-band-slipping text-paper",
                revealed && !isCorrect && !isSelected && "border border-border text-content-faint",
              )}>
                {revealed && isCorrect && <Check size={12} />}
                {revealed && isSelected && !isCorrect && <X size={12} />}
                {!revealed && String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{option}</span>
            </button>
          );
        })}
      </div>
      {revealed && item.explanation && (
        <p className="mt-2.5 rounded-control bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-content-muted">
          {item.explanation}
        </p>
      )}
      {revealed && (
        <button
          type="button"
          onClick={() => { setSelected(null); setRevealed(false); }}
          className="mono mt-2 text-[11px] text-content-faint transition-colors hover:text-content"
        >
          try again
        </button>
      )}
    </div>
  );
}

function TrueFalseQuestion({ item, index }: { item: TrueFalseItem; index: number }) {
  const [selected, setSelected] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="rounded-control border border-border/70 bg-surface/50 p-3">
      <p className="text-[13px] font-medium leading-relaxed text-content">
        <span className="mono mr-1.5 text-content-faint">{index + 1}.</span>
        {item.prompt}
      </p>
      <p className="mt-2 rounded-control bg-surface-2 px-3 py-2 text-[12px] italic leading-relaxed text-content-muted">
        {item.statement}
      </p>
      <div className="mt-2.5 flex gap-2">
        {[true, false].map((val) => {
          const isCorrect = val === item.answer;
          const isSelected = val === selected;
          return (
            <button
              key={String(val)}
              type="button"
              disabled={revealed}
              onClick={() => { setSelected(val); setRevealed(true); }}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-control border px-3 py-2 text-[12px] font-medium transition-colors",
                !revealed && "border-border hover:border-border-strong hover:bg-surface-2 text-content",
                revealed && isCorrect && "border-feynman/60 bg-feynman/10 text-content",
                revealed && isSelected && !isCorrect && "border-band-slipping/60 bg-band-slipping/10 text-content",
                revealed && !isCorrect && !isSelected && "border-border text-content-faint opacity-60",
              )}
            >
              {revealed && isCorrect && <Check size={13} className="text-feynman" />}
              {revealed && isSelected && !isCorrect && <X size={13} className="text-band-slipping" />}
              {val ? "True" : "False"}
            </button>
          );
        })}
      </div>
      {revealed && item.explanation && (
        <p className="mt-2.5 rounded-control bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-content-muted">
          {item.explanation}
        </p>
      )}
      {revealed && (
        <button
          type="button"
          onClick={() => { setSelected(null); setRevealed(false); }}
          className="mono mt-2 text-[11px] text-content-faint transition-colors hover:text-content"
        >
          try again
        </button>
      )}
    </div>
  );
}