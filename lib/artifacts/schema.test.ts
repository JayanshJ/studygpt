import assert from "node:assert/strict";
import test from "node:test";
import { artifactKindLabel, artifactKindListPrompt, classifyArtifact } from "./schema";
import { registerKind, resolveKindCandidates } from "./registry";

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
    xLabel: "Year",
    yLabel: "GDP (USD billions)",
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
    chartType: "line", labels: ["2023", "2024"], series: [{ label: "GDP", values: [3500, 3761] }], xLabel: "Year", yLabel: "USD",
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

// Alias recovery: an ad-hoc model-emitted kind like `erm`/`flowchart`/`graph`
// normalizes to a native kind instead of producing a dead-end "unsupported
// kind". The canonical kind's validator must still accept the payload —
// recovery, not silent acceptance. This is the direct fix for the
// "ERM → artifact not supported" failure.
test("normalizes an ad-hoc `erm` kind with Mermaid data to a native diagram", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "erm",
      data: { mermaid: "erDiagram\n  STUDENT ||--o{ ENROLLMENT : has" },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "diagram");
});

test("normalizes ad-hoc flowchart/sequence/class/state aliases to a native diagram", () => {
  for (const kind of ["flowchart", "sequence-diagram", "class-diagram", "state-machine"]) {
    const result = classifyArtifact(
      JSON.stringify({
        schema: "studygpt.artifact",
        version: 1,
        kind,
        data: { mermaid: "flowchart LR\n  A --> B" },
      }),
    );
    assert.equal(result.type, "native", kind);
    assert.equal(result.type === "native" && result.artifact.kind, "diagram", kind);
  }
});

test("normalizes an ad-hoc `graph` kind to a native diagram", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "precedence-graph",
      data: { mermaid: "flowchart LR\n  T1 --> T2" },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "diagram");
});

test("an aliased kind whose data the target validator rejects still falls to invalid", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "erm",
      data: { entities: [{ name: "STUDENT" }] },
    }),
  );

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /mermaid/i);
});

test("a genuinely unknown kind with no alias is still invalid", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "timeline",
      data: { items: [] },
    }),
  );

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /kind/i);
});

// The prompt's kind list is derived from the registry, so it can never drift
// from the validators. Every registered kind appears with its data-shape hint.
test("artifactKindListPrompt lists every registered kind with its data shape", () => {
  const list = artifactKindListPrompt();
  for (const kind of ["diagram", "figure", "table", "comparison", "steps", "callout", "chart", "definition", "quiz"]) {
    assert.match(list, new RegExp(`\\b${kind} \\(`), `kind ${kind} in list`);
  }
  assert.match(list, /mermaid:string/);
  assert.match(list, /chartType/);
  assert.match(list, /shapes/);
});

// --- chart upgrades: new chartTypes + axis labels --------------------------

test("classifies a scatter chart with axis labels as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart", title: "Correlation",
    data: { chartType: "scatter", xLabel: "Hours studied", yLabel: "Score", labels: ["A", "B", "C"], series: [{ label: "Students", values: [2, 5, 8] }] },
  }));
  assert.equal(result.type, "native");
  assert.ok(result.type === "native" && result.artifact.kind === "chart");
  assert.equal(result.type === "native" && result.artifact.kind === "chart" && result.artifact.data.chartType, "scatter");
  assert.equal(result.type === "native" && result.artifact.kind === "chart" && result.artifact.data.xLabel, "Hours studied");
});

test("classifies an area chart as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart",
    data: { chartType: "area", labels: ["Q1", "Q2"], series: [{ label: "Revenue", values: [100, 140] }] },
  }));
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind === "chart" && result.artifact.data.chartType, "area");
});

test("classifies a pie chart as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart",
    data: { chartType: "pie", labels: ["A", "B", "C"], series: [{ label: "Share", values: [30, 50, 20] }] },
  }));
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind === "chart" && result.artifact.data.chartType, "pie");
});

test("classifies a dotted chart as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart",
    data: { chartType: "dotted", labels: ["1", "2", "3"], series: [{ label: "Points", values: [4, 1, 9] }] },
  }));
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind === "chart" && result.artifact.data.chartType, "dotted");
});

test("rejects an unsupported chartType", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart",
    data: { chartType: "radar", labels: ["A"], series: [{ label: "X", values: [1] }] },
  }));
  assert.equal(result.type, "invalid");
});

test("promotes xAxis.label / yAxis.label to xLabel / yLabel during normalization", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart",
    data: {
      chartType: "bar",
      xAxis: { label: "Month", values: ["Jan", "Feb"] },
      yAxis: { label: "Sales" },
      series: [{ name: "Units", values: [10, 20] }],
    },
  }));
  assert.equal(result.type, "native");
  const data = result.type === "native" && result.artifact.kind === "chart" ? result.artifact.data : null;
  assert.equal(data?.xLabel, "Month");
  assert.equal(data?.yLabel, "Sales");
});

// --- table upgrades: rich cells, alignment, backward compat ----------------

test("classifies a table with rich cell objects as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "table",
    data: {
      columns: ["Name", "Score"],
      rows: [
        [{ text: "Alice", emphasis: "strong" }, { text: 95, tone: "key" }],
        [{ text: "Bob", emphasis: "muted" }, { text: 60, tone: "warning" }],
      ],
    },
  }));
  assert.equal(result.type, "native");
  assert.ok(result.type === "native" && result.artifact.kind === "table");
  const rows = result.type === "native" && result.artifact.kind === "table" ? result.artifact.data.rows : null;
  const firstCell = rows?.[0]?.[0];
  const firstText = typeof firstCell === "object" && firstCell !== null ? firstCell.text : firstCell;
  assert.equal(firstText, "Alice");
});

test("classifies a table with columnAlign as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "table",
    data: {
      columns: ["Name", "Score"],
      columnAlign: ["left", "right"],
      rows: [["Alice", 95], ["Bob", 60]],
    },
  }));
  assert.equal(result.type, "native");
  const data = result.type === "native" && result.artifact.kind === "table" ? result.artifact.data : null;
  assert.deepEqual(data?.columnAlign, ["left", "right"]);
});

test("plain-string table cells still validate (backward compat)", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "table",
    data: { columns: ["Rule"], rows: [["Push σ down"]] },
  }));
  assert.equal(result.type, "native");
  const rows = result.type === "native" && result.artifact.kind === "table" ? result.artifact.data.rows : null;
  const plainCell = rows?.[0]?.[0];
  const plainText = typeof plainCell === "object" && plainCell !== null ? plainCell.text : plainCell;
  assert.equal(plainText, "Push σ down");
});

test("rejects a table with an invalid cell emphasis", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "table",
    data: { columns: ["A"], rows: [[{ text: "x", emphasis: "bold" }]] },
  }));
  assert.equal(result.type, "invalid");
});

test("rejects a table where columnAlign doesn't match columns", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "table",
    data: { columns: ["A", "B"], columnAlign: ["left"], rows: [["1", "2"]] },
  }));
  assert.equal(result.type, "invalid");
});

// --- definition kind -------------------------------------------------------

test("classifies a definition as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "definition",
    data: {
      term: "Recursion",
      pronunciation: "ri-kur-zhun",
      partOfSpeech: "noun",
      meaning: "A function that calls itself.",
      example: "factorial(n) = n * factorial(n-1)",
      related: ["base case", "stack overflow"],
      tone: "key",
    },
  }));
  assert.equal(result.type, "native");
  assert.ok(result.type === "native" && result.artifact.kind === "definition");
  const data = result.type === "native" && result.artifact.kind === "definition" ? result.artifact.data : null;
  assert.equal(data?.term, "Recursion");
  assert.deepEqual(data?.related, ["base case", "stack overflow"]);
});

test("normalizes a key-term alias to the definition kind", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "key-term",
    data: { term: "Entropy", meaning: "A measure of disorder." },
  }));
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "definition");
});

test("rejects a definition missing the term", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "definition",
    data: { meaning: "No term provided." },
  }));
  assert.equal(result.type, "invalid");
});

// --- quiz kind (first interactive native kind) -----------------------------

test("classifies an MCQ quiz as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "quiz",
    data: {
      items: [
        { prompt: "What is 2+2?", options: ["3", "4", "5"], answer: 1, explanation: "Basic addition." },
      ],
    },
  }));
  assert.equal(result.type, "native");
  assert.ok(result.type === "native" && result.artifact.kind === "quiz");
});

test("classifies a true/false quiz as native", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "quiz",
    data: {
      items: [
        { prompt: "Is the sky blue?", statement: "The sky is blue during a clear day.", answer: true },
      ],
    },
  }));
  assert.equal(result.type, "native");
  assert.ok(result.type === "native" && result.artifact.kind === "quiz");
});

test("normalizes an mcq alias to the quiz kind", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "mcq",
    data: { items: [{ prompt: "Q?", options: ["A", "B"], answer: 0 }] },
  }));
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "quiz");
});

test("rejects an MCQ with an out-of-range answer index", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "quiz",
    data: { items: [{ prompt: "Q?", options: ["A", "B"], answer: 5 }] },
  }));
  assert.equal(result.type, "invalid");
});

test("rejects a quiz with no items", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "quiz",
    data: { items: [] },
  }));
  assert.equal(result.type, "invalid");
});

test("rejects a quiz item that is neither MCQ nor true/false", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "quiz",
    data: { items: [{ prompt: "Q?" }] },
  }));
  assert.equal(result.type, "invalid");
});

// --- figure kind (notation-faithful vector DSL) ---------------------------

const chenErFigure = {
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
    legend: [{ label: "relationship", swatch: "diamond" }, { label: "entity", swatch: "rect" }],
  },
};

test("classifies a Chen-style ER figure as native", () => {
  const result = classifyArtifact(JSON.stringify(chenErFigure));
  assert.equal(result.type, "native");
  assert.ok(result.type === "native" && result.artifact.kind === "figure");
  assert.equal(result.type === "native" && result.artifact.kind === "figure" && result.artifact.data.shapes.length, 3);
});

test("an ad-hoc `erm` carrying figure DSL data routes to figure, not diagram", () => {
  const result = classifyArtifact(JSON.stringify({ ...chenErFigure, kind: "erm" }));
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "figure");
});

test("an ad-hoc `erm` carrying Mermaid data falls back to diagram", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "erm",
      data: { mermaid: "erDiagram\n  STUDENT ||--o{ ENROLLMENT : has" },
    }),
  );
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "diagram");
});

test("rejects a figure with no shapes", () => {
  const result = classifyArtifact(
    JSON.stringify({ schema: "studygpt.artifact", version: 1, kind: "figure", data: { shapes: [] } }),
  );
  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /shapes/i);
});

test("rejects a figure connector referencing a non-existent shape", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "figure",
      data: {
        shapes: [{ id: "a", type: "rect", x: 10, y: 10, w: 80, h: 40 }],
        connectors: [{ id: "c", from: "a", to: "missing", style: "solid" }],
      },
    }),
  );
  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /connector/i);
});

test("rejects a figure with an invalid shape type", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "figure",
      data: { shapes: [{ id: "a", type: "hexagon", x: 10, y: "10", w: 80, h: 40 }] },
    }),
  );
  assert.equal(result.type, "invalid");
});

// HMR safety: Next's Turbopack dev re-evaluates the side-effect kind modules
// (kinds/index.ts → kinds/*.ts) against the already-populated registry. A hard
// throw on repeat registration crashes the client module graph and React
// hydration fails — the symptom is "the page loads but nothing is clickable",
// which is exactly the bug this guard prevents. Re-registering the same kind
// (or the same alias) must be a no-op, not an error.
test("registerKind is idempotent — re-registering a kind does not throw (HMR-safe)", () => {
  assert.doesNotThrow(() => {
    registerKind({
      kind: "diagram",
      label: "Diagram",
      promptSpec: `data:{mermaid:string}`,
      aliases: ["flowchart"],
      validate: () => ({ ok: false as const, reason: "test stub" }),
    });
  });
  // The canonical diagram kind is still resolvable and its alias candidate
  // list has not been corrupted or reordered by the re-registration.
  assert.ok(resolveKindCandidates("flowchart").includes("diagram"));
  assert.equal(resolveKindCandidates("flowchart")[0], "diagram");
});
