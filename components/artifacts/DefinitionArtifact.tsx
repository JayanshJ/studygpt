import { cn } from "@/lib/cn";
import type { DefinitionData } from "@/lib/artifacts/kinds/definition";

export function DefinitionArtifact({
  term,
  pronunciation,
  partOfSpeech,
  meaning,
  example,
  related,
  tone = "default",
}: DefinitionData) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className={cn("font-serif text-[1.15rem] font-semibold leading-tight", tone === "key" ? "text-rule" : "text-ink")}>
          {term}
        </h3>
        {pronunciation && <span className="mono text-[11px] text-content-faint">{pronunciation}</span>}
        {partOfSpeech && <span className="mono text-[10px] italic text-content-faint">{partOfSpeech}</span>}
      </div>
      <p className="text-[13px] leading-relaxed text-content">{meaning}</p>
      {example && (
        <blockquote className="border-l-2 border-border-strong pl-3 text-[12px] italic leading-relaxed text-content-muted">
          {example}
        </blockquote>
      )}
      {related && related.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mono text-[10px] tracking-wide text-content-faint">RELATED</span>
          {related.map((term) => (
            <span
              key={term}
              className="mono rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11px] text-content-muted"
            >
              {term}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}