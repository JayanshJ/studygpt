"use client";

import { useId, useMemo, useState } from "react";

interface ChartArtifactProps {
  chartType: "bar" | "line" | "area" | "scatter" | "pie" | "dotted";
  labels: string[];
  series: { label: string; values: number[] }[];
  xLabel?: string;
  yLabel?: string;
  title?: string;
  summary?: string;
}

const WIDTH = 640;
const HEIGHT = 320;
const PADDING = { top: 24, right: 28, bottom: 56, left: 60 };
const PIE_CX = 220;
const PIE_CY = 150;
const PIE_R = 110;

// Distinct colors for series, cycled. All use the platform accent family so
// they stay on-theme; the first series is the rule (orange) accent.
const SERIES_CLASSES = [
  "text-rule",
  "text-feynman",
  "text-content",
  "text-content-muted",
  "text-band-learning",
  "text-band-slipping",
  "text-content-faint",
  "text-ink",
];

function tickIndexes(length: number): number[] {
  const stride = Math.max(1, Math.ceil((length - 1) / 7));
  return Array.from({ length }, (_, index) => index).filter((index) => index % stride === 0 || index === length - 1);
}

function formatValue(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

type PieSlice = {
  path: string;
  labelX: number;
  labelY: number;
  value: number;
  label: string;
  fraction: number;
  index: number;
};

function pieSlices(values: number[], labels: string[], total: number): PieSlice[] {
  const slices: PieSlice[] = [];
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    const fraction = Math.abs(value) / total;
    const startAngle = angle;
    const endAngle = angle + fraction * Math.PI * 2;
    angle = endAngle;
    const largeArc = fraction > 0.5 ? 1 : 0;
    const x1 = PIE_CX + PIE_R * Math.cos(startAngle);
    const y1 = PIE_CY + PIE_R * Math.sin(startAngle);
    const x2 = PIE_CX + PIE_R * Math.cos(endAngle);
    const y2 = PIE_CY + PIE_R * Math.sin(endAngle);
    const midAngle = (startAngle + endAngle) / 2;
    slices.push({
      path: `M ${PIE_CX} ${PIE_CY} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${PIE_R} ${PIE_R} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`,
      labelX: PIE_CX + PIE_R * 0.62 * Math.cos(midAngle),
      labelY: PIE_CY + PIE_R * 0.62 * Math.sin(midAngle),
      value,
      label: labels[index] ?? String(index),
      fraction,
      index,
    });
  });
  return slices;
}

export function ChartArtifact({ chartType, labels, series, xLabel, yLabel, title, summary }: ChartArtifactProps) {
  const chartId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<{ series: number; index: number } | null>(null);

  const visibleSeries = useMemo(() => series.filter((_, i) => !hidden.has(i)), [series, hidden]);
  const values = visibleSeries.flatMap((entry) => entry.values.filter(Number.isFinite));
  const pieSeries = visibleSeries[0] ?? series[0];
  const pieTotal = pieSeries ? pieSeries.values.reduce((a, b) => a + Math.abs(b), 0) || 1 : 1;
  const slices = useMemo(() => (pieSeries ? pieSlices(pieSeries.values, labels, pieTotal) : []), [pieSeries, pieTotal, labels]);
  if (!labels.length || !series.length || !values.length) {
    return <p className="mono rounded-control border border-border/70 bg-surface/50 px-3 py-2 text-[11px] text-content-faint">Chart data is unavailable.</p>;
  }

  const chartTitle = title ?? "Chart";
  const description = summary ?? `${chartType} chart showing ${series.map((entry) => entry.label).join(", ")} across ${labels.join(", ")}.`;
  const showLegend = series.length > 1;
  const bottomPad = (xLabel ? 70 : 56);

  const minimum = Math.min(0, ...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - bottomPad;
  const x = (index: number) => PADDING.left + (labels.length === 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const y = (value: number) => PADDING.top + ((maximum - value) / range) * plotHeight;
  const zeroY = y(0);
  const xTicks = tickIndexes(labels.length);
  const yTicks = Array.from({ length: 5 }, (_, index) => minimum + (range * index) / 4);
  const barWidth = Math.max(8, plotWidth / labels.length / Math.max(visibleSeries.length + 1, 2));

  const toggleSeries = (i: number) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // --- pie chart: only the first visible series is used ---
  if (chartType === "pie") {
    return (
      <ChartShell chartId={chartId} chartTitle={chartTitle} description={description} showLegend={false}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`artifact-chart-title-${chartId} artifact-chart-description-${chartId}`} className="h-auto w-full text-content">
          <title id={`artifact-chart-title-${chartId}`}>{chartTitle}</title>
          <desc id={`artifact-chart-description-${chartId}`}>{description}</desc>
          {slices.map((slice, i) => (
            <g
              key={i}
              className={SERIES_CLASSES[i % SERIES_CLASSES.length]}
              onMouseEnter={() => setHover({ series: 0, index: i })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            >
              <path d={slice.path} fill="currentColor" fillOpacity={hover?.index === i ? 0.95 : 0.75} stroke="var(--paper)" strokeWidth="2">
                <title>{`${slice.label}: ${formatValue(slice.value)} (${(slice.fraction * 100).toFixed(0)}%)`}</title>
              </path>
              {slice.fraction > 0.06 && (
                <text x={slice.labelX} y={slice.labelY} textAnchor="middle" dominantBaseline="middle" className="fill-current text-[10px] font-medium" style={{ fill: "var(--paper)" }}>
                  {(slice.fraction * 100).toFixed(0)}%
                </text>
              )}
            </g>
          ))}
          {/* legend for pie — the slices are labelled by `labels`, not series */}
          <g transform={`translate(${WIDTH - 180}, ${PADDING.top})`}>
            {slices.map((slice, i) => (
              <g
                key={i}
                transform={`translate(0, ${i * 18})`}
                className={SERIES_CLASSES[i % SERIES_CLASSES.length]}
                onMouseEnter={() => setHover({ series: 0, index: i })}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              >
                <rect width="12" height="12" rx="2" fill="currentColor" fillOpacity={hover?.index === i ? 0.95 : 0.75} />
                <text x="18" y="10" className="fill-current text-[11px] text-content-muted">{slice.label}</text>
              </g>
            ))}
          </g>
        </svg>
      </ChartShell>
    );
  }

  const isArea = chartType === "area";
  const isScatter = chartType === "scatter";
  const isDotted = chartType === "dotted";

  return (
    <ChartShell chartId={chartId} chartTitle={chartTitle} description={description} showLegend={showLegend} series={series} hidden={hidden} onToggle={toggleSeries}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={`artifact-chart-title-${chartId} artifact-chart-description-${chartId}`}
        className="h-auto w-full text-content"
      >
        <title id={`artifact-chart-title-${chartId}`}>{chartTitle}</title>
        <desc id={`artifact-chart-description-${chartId}`}>{description}</desc>
        {/* y-axis grid + ticks */}
        {yTicks.map((value) => (
          <g key={value} data-chart-grid>
            <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y(value)} y2={y(value)} stroke="currentColor" strokeOpacity="0.12" />
            <text x={PADDING.left - 10} y={y(value) + 4} textAnchor="end" className="fill-current text-[10px] text-content-faint">{formatValue(value)}</text>
          </g>
        ))}
        <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity="0.4" />
        {/* x-axis ticks */}
        {xTicks.map((index) => (
          <text key={labels[index]} data-chart-tick x={x(index)} y={HEIGHT - bottomPad + 16} textAnchor="middle" className="fill-current text-[10px] text-content-faint">
            {labels[index]}
          </text>
        ))}
        {/* axis labels */}
        {xLabel && (
          <text x={PADDING.left + plotWidth / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-current text-[11px] text-content-muted">{xLabel}</text>
        )}
        {yLabel && (
          <text x={14} y={PADDING.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 14 ${PADDING.top + plotHeight / 2})`} className="fill-current text-[11px] text-content-muted">{yLabel}</text>
        )}
        {/* series */}
        {series.map((entry, seriesIndex) => {
          if (hidden.has(seriesIndex)) return null;
          const cls = SERIES_CLASSES[seriesIndex % SERIES_CLASSES.length];
          if (chartType === "bar") {
            return entry.values.map((value, index) => Number.isFinite(value) && (
              <rect
                key={`${entry.label}-${index}`}
                x={x(index) - (visibleSeries.length * barWidth) / 2 + visibleIndex(seriesIndex, hidden) * barWidth}
                y={Math.min(y(value), zeroY)}
                width={barWidth - 2}
                height={Math.abs(zeroY - y(value))}
                className={cls}
                fill="currentColor"
                fillOpacity={hover?.series === seriesIndex && hover?.index === index ? 1 : 0.85}
                onMouseEnter={() => setHover({ series: seriesIndex, index })}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${entry.label}: ${labels[index]} ${value}`}</title>
              </rect>
            ));
          }
          if (isScatter || isDotted) {
            return entry.values.map((value, index) => Number.isFinite(value) && (
              <circle
                key={`${entry.label}-${index}`}
                cx={x(index)}
                cy={y(value)}
                r={isDotted ? 2.5 : 4}
                fill="currentColor"
                className={cls}
                fillOpacity={hover?.series === seriesIndex && hover?.index === index ? 1 : 0.7}
                onMouseEnter={() => setHover({ series: seriesIndex, index })}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${entry.label}: ${labels[index]} ${value}`}</title>
              </circle>
            ));
          }
          // line / area
          const points = entry.values.map((value, index) => Number.isFinite(value) ? `${x(index)},${y(value)}` : "").filter(Boolean).join(" ");
          const areaPath = `${points} L ${x(entry.values.length - 1)},${zeroY} L ${x(0)},${zeroY} Z`;
          return (
            <g key={entry.label} className={cls}>
              {isArea && <path d={areaPath} fill="currentColor" fillOpacity="0.15" />}
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth={hover?.series === seriesIndex ? 3 : 2}
                strokeDasharray={isDotted ? "2 4" : undefined}
                points={points}
                aria-label={entry.label}
              />
              {entry.values.map((value, index) => Number.isFinite(value) && (
                <circle
                  key={`${entry.label}-${index}`}
                  cx={x(index)}
                  cy={y(value)}
                  r={hover?.series === seriesIndex && hover?.index === index ? 5 : 3}
                  fill="currentColor"
                  onMouseEnter={() => setHover({ series: seriesIndex, index })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{`${entry.label}: ${labels[index]} ${value}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {/* hover readout */}
        {hover && (
          <g>
            <rect
              x={x(hover.index) - 50}
              y={PADDING.top - 4}
              width="100"
              height="22"
              rx="4"
              fill="var(--paper-2)"
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text x={x(hover.index)} y={PADDING.top + 10} textAnchor="middle" className="fill-current text-[10px] text-content">
              {series[hover.series]?.label}: {formatValue(series[hover.series]?.values[hover.index] ?? 0)}
            </text>
          </g>
        )}
      </svg>
    </ChartShell>
  );
}

// The visible index of a series (skipping hidden ones) — for bar positioning.
function visibleIndex(seriesIndex: number, hidden: Set<number>): number {
  let count = 0;
  for (let i = 0; i < seriesIndex; i++) if (!hidden.has(i)) count++;
  return count;
}

// Shared shell: legend (clickable to toggle series) + the SVG body slot.
function ChartShell({
  chartId,
  chartTitle,
  description,
  showLegend,
  series,
  hidden,
  onToggle,
  children,
}: {
  chartId: string;
  chartTitle: string;
  description: string;
  showLegend: boolean;
  series?: { label: string }[];
  hidden?: Set<number>;
  onToggle?: (i: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl overflow-hidden">
      {showLegend && series && onToggle && (
        <div className="mb-2 flex flex-wrap items-center gap-3">
          {series.map((entry, i) => (
            <button
              key={entry.label}
              type="button"
              onClick={() => onToggle(i)}
              className={`mono inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-[11px] transition-opacity ${hidden?.has(i) ? "text-content-faint opacity-50 line-through" : "text-content-muted hover:text-content"}`}
            >
              <span className={`inline-block h-2.5 w-2.5 rounded-[2px] ${SERIES_CLASSES[i % SERIES_CLASSES.length]}`} style={{ backgroundColor: "currentColor" }} />
              {entry.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}