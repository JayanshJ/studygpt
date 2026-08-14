export const NATIVE_ARTIFACT_SCHEMA = "studygpt.artifact" as const;
export const NATIVE_ARTIFACT_VERSION = 1 as const;

export type NativeArtifactKind =
  | "diagram"
  | "table"
  | "comparison"
  | "steps"
  | "callout"
  | "chart";

export type NativeArtifact =
  | {
      schema: typeof NATIVE_ARTIFACT_SCHEMA;
      version: typeof NATIVE_ARTIFACT_VERSION;
      kind: "diagram";
      title?: string;
      summary?: string;
      data: { mermaid: string };
    }
  | {
      schema: typeof NATIVE_ARTIFACT_SCHEMA;
      version: typeof NATIVE_ARTIFACT_VERSION;
      kind: "table";
      title?: string;
      summary?: string;
      data: { columns: string[]; rows: (string | number)[][] };
    }
  | {
      schema: typeof NATIVE_ARTIFACT_SCHEMA;
      version: typeof NATIVE_ARTIFACT_VERSION;
      kind: "comparison";
      title?: string;
      summary?: string;
      data: { items: { label: string; value: string; detail?: string }[] };
    }
  | {
      schema: typeof NATIVE_ARTIFACT_SCHEMA;
      version: typeof NATIVE_ARTIFACT_VERSION;
      kind: "steps";
      title?: string;
      summary?: string;
      data: {
        items: { title: string; detail: string; emphasis?: "default" | "key" }[];
      };
    }
  | {
      schema: typeof NATIVE_ARTIFACT_SCHEMA;
      version: typeof NATIVE_ARTIFACT_VERSION;
      kind: "callout";
      title?: string;
      summary?: string;
      data: {
        label?: string;
        body: string;
        tone?: "idea" | "warning" | "formula";
      };
    }
  | {
      schema: typeof NATIVE_ARTIFACT_SCHEMA;
      version: typeof NATIVE_ARTIFACT_VERSION;
      kind: "chart";
      title?: string;
      summary?: string;
      data: {
        chartType: "bar" | "line";
        labels: string[];
        series: { label: string; values: number[] }[];
      };
    };

export type ArtifactClassification =
  | { type: "native"; artifact: NativeArtifact }
  | { type: "legacy-html"; html: string }
  | { type: "invalid"; source: string; reason: string };

const FORBIDDEN_KEYS = new Set(["html", "css", "script", "svg", "url", "href", "src"]);

export function classifyArtifact(source: string): ArtifactClassification {
  const trimmed = source.trim();

  if (/^<!doctype\b/i.test(trimmed) || /^<html(?:\s|>)/i.test(trimmed) || /^<[a-z][^>]*>/i.test(trimmed)) {
    return { type: "legacy-html", html: trimmed };
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return invalid(trimmed, "Source is not valid JSON");
  }

  const validation = validateArtifact(normalizeArtifact(value));
  return validation.artifact
    ? { type: "native", artifact: validation.artifact }
    : invalid(trimmed, validation.reason ?? "Invalid native artifact");
}

export function artifactKindLabel(kind: NativeArtifactKind): string {
  switch (kind) {
    case "diagram":
      return "Diagram";
    case "table":
      return "Data table";
    case "comparison":
      return "Comparison";
    case "steps":
      return "Steps";
    case "callout":
      return "Callout";
    case "chart":
      return "Chart";
  }
}

function invalid(source: string, reason: string): ArtifactClassification {
  return { type: "invalid", source, reason };
}

function validateArtifact(value: unknown): { artifact?: NativeArtifact; reason?: string } {
  if (!isPlainObject(value)) return { reason: "Artifact must be a plain JSON object" };
  if (value.schema !== NATIVE_ARTIFACT_SCHEMA) return { reason: "Artifact schema is missing or unsupported" };
  if (value.version !== NATIVE_ARTIFACT_VERSION) return { reason: "Artifact version is unsupported" };
  if (typeof value.kind !== "string") return { reason: "Artifact kind is required" };
  if (!hasOnlyKeys(value, ["schema", "version", "kind", "title", "summary", "data"])) {
    return { reason: "Artifact contains unsupported keys" };
  }
  if (!optionalString(value.title, 160, "title")) return { reason: "Title must be at most 160 characters" };
  if (!optionalString(value.summary, 320, "summary")) return { reason: "Summary must be at most 320 characters" };
  if (!isPlainObject(value.data)) return { reason: "Artifact data must be an object" };

  switch (value.kind) {
    case "diagram":
      return validateDiagram(value);
    case "table":
      return validateTable(value);
    case "comparison":
      return validateComparison(value);
    case "steps":
      return validateSteps(value);
    case "callout":
      return validateCallout(value);
    case "chart":
      return validateChart(value);
    default:
      return { reason: "Artifact kind is unsupported" };
  }
}

function normalizeArtifact(value: unknown): unknown {
  if (!isPlainObject(value) || value.kind !== "chart" || !isPlainObject(value.data)) return value;
  const data = value.data;
  const labels = Array.isArray(data.labels)
    ? data.labels
    : isPlainObject(data.xAxis) && Array.isArray(data.xAxis.values)
      ? data.xAxis.values
      : null;
  if (!labels || !Array.isArray(data.series)) return value;
  if (!data.series.every(isPlainObject)) return value;

  return {
    ...value,
    ...(value.title === undefined && typeof data.title === "string" ? { title: data.title } : {}),
    data: {
      chartType: data.chartType,
      labels,
      series: data.series.map((series) => ({ label: series.label ?? series.name, values: series.values })),
    },
  };
}

function validateDiagram(value: Record<string, unknown>): { artifact?: NativeArtifact; reason?: string } {
  const data = value.data as Record<string, unknown>;
  if (!hasOnlyKeys(data, ["mermaid"]) || !boundedString(data.mermaid, 1000)) {
    return { reason: "Diagram data must contain a Mermaid string of at most 1,000 characters" };
  }
  return { artifact: value as NativeArtifact };
}

function validateTable(value: Record<string, unknown>): { artifact?: NativeArtifact; reason?: string } {
  const data = value.data as Record<string, unknown>;
  if (!hasOnlyKeys(data, ["columns", "rows"]) || !stringArray(data.columns, 12, 1000)) {
    return { reason: "Table columns must contain at most 12 strings" };
  }
  if (!Array.isArray(data.rows) || data.rows.length > 60) return { reason: "Table rows must contain at most 60 rows" };
  for (const row of data.rows) {
    if (!Array.isArray(row) || row.length !== data.columns.length || row.some((cell) => !cellValue(cell))) {
      return { reason: "Table rows must match the columns and contain bounded strings or numbers" };
    }
  }
  return { artifact: value as NativeArtifact };
}

function validateComparison(value: Record<string, unknown>): { artifact?: NativeArtifact; reason?: string } {
  const data = value.data as Record<string, unknown>;
  if (!hasOnlyKeys(data, ["items"]) || !Array.isArray(data.items) || data.items.length > 60) {
    return { reason: "Comparison items must contain at most 60 items" };
  }
  for (const item of data.items) {
    if (!isPlainObject(item) || !hasOnlyKeys(item, ["label", "value", "detail"]) || !boundedString(item.label, 1000) || !boundedString(item.value, 1000) || !optionalString(item.detail, 1000, "detail")) {
      return { reason: "Comparison items contain invalid strings or keys" };
    }
  }
  return { artifact: value as NativeArtifact };
}

function validateSteps(value: Record<string, unknown>): { artifact?: NativeArtifact; reason?: string } {
  const data = value.data as Record<string, unknown>;
  if (!hasOnlyKeys(data, ["items"]) || !Array.isArray(data.items) || data.items.length > 60) {
    return { reason: "Steps items must contain at most 60 items" };
  }
  for (const item of data.items) {
    if (!isPlainObject(item) || !hasOnlyKeys(item, ["title", "detail", "emphasis"]) || !boundedString(item.title, 1000) || !boundedString(item.detail, 1000) || (item.emphasis !== undefined && item.emphasis !== "default" && item.emphasis !== "key")) {
      return { reason: "Steps items contain invalid strings or values" };
    }
  }
  return { artifact: value as NativeArtifact };
}

function validateCallout(value: Record<string, unknown>): { artifact?: NativeArtifact; reason?: string } {
  const data = value.data as Record<string, unknown>;
  if (!hasOnlyKeys(data, ["label", "body", "tone"]) || !boundedString(data.body, 1000) || !optionalString(data.label, 1000, "label") || (data.tone !== undefined && data.tone !== "idea" && data.tone !== "warning" && data.tone !== "formula")) {
    return { reason: "Callout data contains invalid strings or values" };
  }
  return { artifact: value as NativeArtifact };
}

function validateChart(value: Record<string, unknown>): { artifact?: NativeArtifact; reason?: string } {
  const data = value.data as Record<string, unknown>;
  if (!hasOnlyKeys(data, ["chartType", "labels", "series"]) || (data.chartType !== "bar" && data.chartType !== "line") || !stringArray(data.labels, 60, 1000) || !Array.isArray(data.series) || data.series.length > 12) {
    return { reason: "Chart data contains invalid types or limits" };
  }
  for (const series of data.series) {
    if (!isPlainObject(series) || !hasOnlyKeys(series, ["label", "values"]) || !boundedString(series.label, 1000) || !Array.isArray(series.values) || series.values.length !== data.labels.length || series.values.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      return { reason: "Chart series must match labels and contain finite numbers" };
    }
  }
  return { artifact: value as NativeArtifact };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key) && !FORBIDDEN_KEYS.has(key));
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function optionalString(value: unknown, maxLength: number, _field: string): value is string | undefined {
  return value === undefined || boundedString(value, maxLength);
}

function stringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => boundedString(item, maxLength));
}

function cellValue(value: unknown): value is string | number {
  return (typeof value === "string" && value.length <= 1000) || (typeof value === "number" && Number.isFinite(value));
}
