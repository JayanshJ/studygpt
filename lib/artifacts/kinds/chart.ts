import { registerKind, hasOnlyKeys, isPlainObject, boundedString, stringArray, optionalString } from "../registry";

export type ChartData = {
  chartType: "bar" | "line" | "area" | "scatter" | "pie" | "dotted";
  labels: string[];
  series: { label: string; values: number[] }[];
  xLabel?: string;
  yLabel?: string;
};

// Normalizes the loose chart shapes the model emits into the canonical form
// before validation: `data.xAxis.values`→`labels`, `series.name`→`label`,
// `data.title` hoisted to the top-level envelope `title` (only when the
// envelope doesn't already carry one), and `data.xLabel`/`data.yLabel` /
// `data.xAxis.label`/`data.yAxis.label` promoted to `xLabel`/`yLabel`.
function normalizeChart(value: Record<string, unknown>): Record<string, unknown> {
  const data = value.data;
  if (!isPlainObject(data)) return value;
  const labels = Array.isArray(data.labels)
    ? data.labels
    : isPlainObject(data.xAxis) && Array.isArray(data.xAxis.values)
      ? data.xAxis.values
      : null;
  if (!labels || !Array.isArray(data.series) || !data.series.every(isPlainObject)) return value;

  const xLabel = data.xLabel ?? (isPlainObject(data.xAxis) ? data.xAxis.label : undefined);
  const yLabel = data.yLabel ?? (isPlainObject(data.yAxis) ? data.yAxis.label : undefined);

  return {
    ...value,
    ...(value.title === undefined && typeof data.title === "string" ? { title: data.title } : {}),
    data: {
      chartType: data.chartType,
      labels,
      ...(typeof xLabel === "string" ? { xLabel } : {}),
      ...(typeof yLabel === "string" ? { yLabel } : {}),
      series: data.series.map((series) => ({ label: series.label ?? series.name, values: series.values })),
    },
  };
}

const CHART_TYPES = new Set(["bar", "line", "area", "scatter", "pie", "dotted"]);

registerKind({
  kind: "chart",
  label: "Chart",
  promptSpec: `data:{chartType:"bar"|"line"|"area"|"scatter"|"pie"|"dotted",labels:string[],series:[{label:string,values:number[]}],xLabel?:string,yLabel?:string}`,
  normalize: normalizeChart,
  validate(data): { ok: true; data: ChartData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["chartType", "labels", "series", "xLabel", "yLabel"]) || typeof d.chartType !== "string" || !CHART_TYPES.has(d.chartType) || !stringArray(d.labels, 60, 1000) || !Array.isArray(d.series) || d.series.length > 12) {
      return { ok: false, reason: "Chart data contains invalid types or limits" };
    }
    if (!optionalString(d.xLabel, 200) || !optionalString(d.yLabel, 200)) {
      return { ok: false, reason: "Chart axis labels must be at most 200 characters" };
    }
    const series: ChartData["series"] = [];
    for (const entry of d.series) {
      if (!isPlainObject(entry) || !hasOnlyKeys(entry, ["label", "values"]) || !boundedString(entry.label, 1000) || !Array.isArray(entry.values) || entry.values.length !== d.labels.length || entry.values.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
        return { ok: false, reason: "Chart series must match labels and contain finite numbers" };
      }
      series.push({ label: entry.label, values: entry.values });
    }
    return {
      ok: true,
      data: {
        chartType: d.chartType as ChartData["chartType"],
        labels: d.labels,
        series,
        ...(typeof d.xLabel === "string" ? { xLabel: d.xLabel } : {}),
        ...(typeof d.yLabel === "string" ? { yLabel: d.yLabel } : {}),
      },
    };
  },
});
