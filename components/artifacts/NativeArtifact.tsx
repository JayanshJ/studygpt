import { MermaidGraphic } from "@/components/MermaidDiagram";
import type { NativeArtifact as NativeArtifactEnvelope } from "@/lib/artifacts/schema";
import { ArtifactFrame } from "./ArtifactFrame";
import { CalloutArtifact } from "./CalloutArtifact";
import { ChartArtifact } from "./ChartArtifact";
import { ComparisonArtifact } from "./ComparisonArtifact";
import { StepsArtifact } from "./StepsArtifact";
import { TableArtifact } from "./TableArtifact";

export function NativeArtifact({ artifact }: { artifact: NativeArtifactEnvelope }) {
  const source = JSON.stringify(artifact);

  return (
    <ArtifactFrame kind={artifact.kind} title={artifact.title} summary={artifact.summary} source={source}>
      {artifact.kind === "diagram" && <MermaidGraphic code={artifact.data.mermaid} />}
      {artifact.kind === "table" && <TableArtifact columns={artifact.data.columns} rows={artifact.data.rows} />}
      {artifact.kind === "comparison" && <ComparisonArtifact items={artifact.data.items} />}
      {artifact.kind === "steps" && <StepsArtifact items={artifact.data.items} />}
      {artifact.kind === "callout" && <CalloutArtifact {...artifact.data} />}
      {artifact.kind === "chart" && <ChartArtifact {...artifact.data} title={artifact.title} summary={artifact.summary} />}
    </ArtifactFrame>
  );
}

export function InvalidArtifact({ source, reason }: { source: string; reason: string }) {
  return (
    <ArtifactFrame kind="callout" title="Couldn't render artifact" summary={reason}>
      <details className="rounded-control border border-border/70 bg-surface/50 px-3 py-2">
        <summary className="mono cursor-pointer text-[11px] text-content-faint">View source</summary>
        <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-content-muted">{source}</pre>
      </details>
    </ArtifactFrame>
  );
}
