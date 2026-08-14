import assert from "node:assert/strict";
import test from "node:test";
import { artifactKindLabel, classifyArtifact } from "./schema";

test("classifies a versioned table envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "table",
      title: "Selection pushdown",
      data: { columns: ["Rule"], rows: [["Push σ down"]] },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "table");
});

test("classifies a Mermaid envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "diagram",
      data: { mermaid: "flowchart LR\n  A --> B" },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "diagram");
});

test("classifies a comparison envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "comparison",
      data: { items: [{ label: "Latency", value: "Lower", detail: "Fewer round trips" }] },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "comparison");
});

test("classifies a steps envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "steps",
      data: { items: [{ title: "Parse", detail: "Read the input", emphasis: "key" }] },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "steps");
});

test("classifies a callout envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "callout",
      data: { label: "Idea", body: "Cache the result", tone: "idea" },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "callout");
});

test("classifies a chart envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "chart",
      data: {
        chartType: "bar",
        labels: ["Before", "After"],
        series: [{ label: "Latency", values: [12, 7] }],
      },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "chart");
});

test("normalizes the chart shape generated for dated series", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart",
    data: {
      chartType: "line", title: "India's nominal GDP",
      xAxis: { label: "Year", values: ["1995", "1996", "1997"] },
      yAxis: { label: "GDP (USD billions)" },
      series: [{ name: "Nominal GDP", color: "#2563eb", values: [360, 393, 416] }],
    },
  }));

  assert.equal(result.type, "native");
  assert.deepEqual(result.type === "native" && result.artifact.data, {
    chartType: "line",
    labels: ["1995", "1996", "1997"],
    series: [{ label: "Nominal GDP", values: [360, 393, 416] }],
  });
  assert.equal(result.type === "native" && result.artifact.title, "India's nominal GDP");
});

test("normalizes labeled chart metadata and named series", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart", title: "India GDP",
    data: { chartType: "line", xLabel: "Year", yLabel: "USD", labels: ["2023", "2024"], series: [{ name: "GDP", color: "#4C8BF5", values: [3500, 3761] }] },
  }));

  assert.equal(result.type, "native");
  assert.deepEqual(result.type === "native" && result.artifact.data, {
    chartType: "line", labels: ["2023", "2024"], series: [{ label: "GDP", values: [3500, 3761] }],
  });
});

test("classifies legacy HTML without parsing it as native JSON", () => {
  const html = "<!doctype html><html><body>Legacy</body></html>";
  const result = classifyArtifact(`  ${html}  `);

  assert.deepEqual(result, { type: "legacy-html", html });
});

test("rejects an unknown native kind", () => {
  const source = JSON.stringify({
    schema: "studygpt.artifact",
    version: 1,
    kind: "timeline",
    data: {},
  });

  const result = classifyArtifact(source);

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /kind/i);
});

test("rejects malformed JSON", () => {
  const result = classifyArtifact('{"schema":"studygpt.artifact"');

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /JSON/i);
});

test("rejects a payload missing schema", () => {
  const result = classifyArtifact(
    JSON.stringify({
      version: 1,
      kind: "callout",
      data: { body: "Remember this" },
    }),
  );

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /schema/i);
});

test("rejects a table exceeding the row limit", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "table",
      data: {
        columns: ["Value"],
        rows: Array.from({ length: 61 }, (_, index) => [index]),
      },
    }),
  );

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /rows/i);
});

test("enforces strict markup, length, and shape limits", () => {
  const cases = [
    {
      name: "markup key",
      payload: {
        schema: "studygpt.artifact",
        version: 1,
        kind: "callout",
        html: "<b>unsafe</b>",
        data: { body: "Safe" },
      },
    },
    {
      name: "title length",
      payload: {
        schema: "studygpt.artifact",
        version: 1,
        kind: "callout",
        title: "x".repeat(161),
        data: { body: "Safe" },
      },
    },
    {
      name: "cell length",
      payload: {
        schema: "studygpt.artifact",
        version: 1,
        kind: "table",
        data: { columns: ["Value"], rows: [["x".repeat(1001)]] },
      },
    },
    {
      name: "unknown field",
      payload: {
        schema: "studygpt.artifact",
        version: 1,
        kind: "callout",
        data: { body: "Safe", extra: true },
      },
    },
  ];

  for (const { name, payload } of cases) {
    const result = classifyArtifact(JSON.stringify(payload));
    assert.equal(result.type, "invalid", name);
  }
});

test("labels every native artifact kind", () => {
  assert.equal(artifactKindLabel("diagram"), "Diagram");
  assert.equal(artifactKindLabel("table"), "Data table");
  assert.equal(artifactKindLabel("comparison"), "Comparison");
  assert.equal(artifactKindLabel("steps"), "Steps");
  assert.equal(artifactKindLabel("callout"), "Callout");
  assert.equal(artifactKindLabel("chart"), "Chart");
});
