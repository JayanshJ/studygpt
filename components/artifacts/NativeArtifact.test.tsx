import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InvalidArtifact, NativeArtifact } from "./NativeArtifact";
import * as ArtifactFrameModule from "./ArtifactFrame";
import type { NativeArtifact as NativeArtifactEnvelope } from "@/lib/artifacts/schema";

const tableArtifact: NativeArtifactEnvelope = {
  schema: "studygpt.artifact",
  version: 1,
  kind: "table",
  title: "Selection pushdown",
  summary: "Move filters close to the data source.",
  data: {
    columns: ["Rule", "Benefit"],
    rows: [["Push σ down", "Smaller intermediate result"]],
  },
};

test("renders a native table in platform chrome", () => {
  const markup = renderToStaticMarkup(<NativeArtifact artifact={tableArtifact} />);

  assert.match(markup, /Selection pushdown/);
  assert.match(markup, /Data table/);
  assert.match(markup, /Move filters close to the data source\./);
  assert.match(markup, /<th[^>]*>[\s\S]*Rule[\s\S]*<\/th>/);
});

test("renders each native study renderer semantically", () => {
  const comparisonMarkup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "comparison",
        data: { items: [{ label: "Read", value: "Shared", detail: "No lock" }] },
      }}
    />,
  );
  const stepsMarkup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "steps",
        data: { items: [{ title: "Scan", detail: "Read each tuple", emphasis: "key" }] },
      }}
    />,
  );
  const calloutMarkup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "callout",
        data: { label: "Key idea", body: "Selection reduces relation size.", tone: "idea" },
      }}
    />,
  );
  const chartMarkup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "chart",
        title: "Query cost",
        data: {
          chartType: "line",
          labels: ["Before", "After"],
          series: [{ label: "Rows", values: [100, 20] }],
        },
      }}
    />,
  );

  assert.match(comparisonMarkup, /Read/);
  assert.match(stepsMarkup, /<ol[^>]*>/);
  assert.match(stepsMarkup, /Scan/);
  assert.match(calloutMarkup, /Selection reduces relation size\./);
  assert.match(chartMarkup, /role="img"/);
  assert.match(chartMarkup, /Query cost/);
  assert.match(chartMarkup, /Rows/);
  assert.match(chartMarkup, /data-chart-tick/);
  assert.match(chartMarkup, /data-chart-grid/);
});

test("renders invalid source in a compact fallback", () => {
  const markup = renderToStaticMarkup(
    <InvalidArtifact source="{invalid" reason="Source is not valid JSON" />,
  );

  assert.match(markup, /Couldn&#x27;t render artifact/);
  assert.match(markup, /Source is not valid JSON/);
  assert.match(markup, /<details/);
  assert.match(markup, /\{invalid/);
});

test("uses unique chart labels and a zero baseline for negative bar values", () => {
  const artifact: NativeArtifactEnvelope = {
    schema: "studygpt.artifact",
    version: 1,
    kind: "chart",
    title: "Balance",
    data: {
      chartType: "bar",
      labels: ["Credit", "Debit"],
      series: [{ label: "Amount", values: [12, -8] }],
    },
  };
  const markup = renderToStaticMarkup(<><NativeArtifact artifact={artifact} /><NativeArtifact artifact={artifact} /></>);
  const chartTitleIds = [...markup.matchAll(/<title id="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(chartTitleIds).size, 2);
  assert.doesNotMatch(markup, /height="-/);
});

test("keeps artifact frames gently animated and charts fluid", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "chart",
        data: {
          chartType: "line",
          labels: ["Before", "After"],
          series: [{ label: "Rows", values: [100, 20] }],
        },
      }}
    />,
  );

  assert.match(markup, /animate-in/);
  assert.match(markup, /duration-150/);
  assert.match(markup, /w-full/);
  assert.doesNotMatch(markup, /min-w-\[28rem\]/);
});

test("handles rejected clipboard writes without surfacing an error", async () => {
  const copyArtifactSource = (
    ArtifactFrameModule as typeof ArtifactFrameModule & {
      copyArtifactSource?: (source: string) => Promise<boolean>;
    }
  ).copyArtifactSource;
  assert.equal(typeof copyArtifactSource, "function");
  if (!copyArtifactSource) return;

  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("Denied"); } } },
  });
  try {
    assert.equal(await copyArtifactSource("native envelope"), false);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});

test("renders a Chen-style ER figure as inline SVG with shapes and connectors", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "figure",
        title: "Chen-style ER",
        data: {
          width: 520,
          height: 300,
          shapes: [
            { id: "s", type: "rect", x: 40, y: 120, w: 120, h: 60, label: "STUDENT", kind: "entity" },
            { id: "e", type: "rect", x: 360, y: 120, w: 120, h: 60, label: "ENROLLS", kind: "entity" },
            { id: "r", type: "diamond", x: 240, y: 110, w: 80, h: 80, label: "has", kind: "relationship" },
          ],
          connectors: [
            { id: "c1", from: "s", to: "r", style: "solid", arrow: "none", cardinality: "1" },
            { id: "c2", from: "r", to: "e", style: "solid", arrow: "none", cardinality: "N" },
          ],
          legend: [{ label: "relationship", swatch: "diamond" }],
        },
      }}
    />,
  );

  assert.match(markup, /role="img"/);
  assert.match(markup, /Chen-style ER/);
  assert.match(markup, /STUDENT/);
  assert.match(markup, /<polygon/); // diamond
  assert.match(markup, /<rect/); // entity boxes
  assert.match(markup, /<line/); // connectors
  assert.match(markup, /cardinality|1|N/);
  assert.match(markup, /relationship/); // legend
});

test("renders an area chart with axis labels and a legend", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "chart",
        title: "Revenue",
        data: {
          chartType: "area",
          xLabel: "Quarter",
          yLabel: "USD",
          labels: ["Q1", "Q2", "Q3"],
          series: [
            { label: "Product A", values: [100, 140, 160] },
            { label: "Product B", values: [80, 90, 110] },
          ],
        },
      }}
    />,
  );
  assert.match(markup, /Quarter/);
  assert.match(markup, /USD/);
  assert.match(markup, /Product A/);
  assert.match(markup, /Product B/);
  assert.match(markup, /data-chart-grid/);
  assert.match(markup, /data-chart-tick/);
});

test("renders a pie chart with slices and percentages", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "chart",
        data: {
          chartType: "pie",
          labels: ["A", "B", "C"],
          series: [{ label: "Share", values: [30, 50, 20] }],
        },
      }}
    />,
  );
  assert.match(markup, /role="img"/);
  assert.match(markup, /<path/); // pie slices
  assert.match(markup, /%/); // percentage labels
});

test("renders a scatter chart with data points", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "chart",
        data: {
          chartType: "scatter",
          labels: ["A", "B", "C", "D"],
          series: [{ label: "Points", values: [2, 5, 8, 3] }],
        },
      }}
    />,
  );
  assert.match(markup, /<circle/);
});

test("existing bar chart still renders after the upgrade (backward compat)", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "chart",
        title: "Balance",
        data: {
          chartType: "bar",
          labels: ["Credit", "Debit"],
          series: [{ label: "Amount", values: [12, -8] }],
        },
      }}
    />,
  );
  assert.match(markup, /Balance/);
  assert.match(markup, /<rect/);
  assert.match(markup, /data-chart-grid/);
});

test("renders a definition with term, meaning, example, and related chips", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "definition",
        title: "Recursion",
        data: {
          term: "Recursion",
          partOfSpeech: "noun",
          meaning: "A function that calls itself.",
          example: "factorial(n) = n * factorial(n-1)",
          related: ["base case", "stack overflow"],
          tone: "key",
        },
      }}
    />,
  );
  assert.match(markup, /Recursion/);
  assert.match(markup, /A function that calls itself\./);
  assert.match(markup, /factorial/);
  assert.match(markup, /RELATED/);
  assert.match(markup, /base case/);
  assert.match(markup, /stack overflow/);
});

test("renders a quiz with MCQ options (pre-reveal state)", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "quiz",
        data: {
          items: [
            { prompt: "What is 2+2?", options: ["3", "4", "5"], answer: 1, explanation: "Basic addition." },
          ],
        },
      }}
    />,
  );
  assert.match(markup, /What is 2\+2\?/);
  assert.match(markup, /3/);
  assert.match(markup, /4/);
  assert.match(markup, /5/);
  // Pre-reveal: options are buttons, not revealed as correct/incorrect
  assert.match(markup, /<button/);
});

test("renders a true/false quiz question", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "quiz",
        data: {
          items: [
            { prompt: "Is this true?", statement: "The sky is blue.", answer: true, explanation: "On a clear day." },
          ],
        },
      }}
    />,
  );
  assert.match(markup, /Is this true\?/);
  assert.match(markup, /The sky is blue\./);
  assert.match(markup, /True/);
  assert.match(markup, /False/);
});
