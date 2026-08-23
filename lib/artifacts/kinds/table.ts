import { registerKind, hasOnlyKeys, stringArray, boundedString, isPlainObject } from "../registry";

// A cell is either a plain string/number (backward compat — normalized to
// {text}) or a rich object: {text, emphasis?, align?, tone?}.
export type CellEmphasis = "default" | "strong" | "muted";
export type CellAlign = "left" | "center" | "right";
export type CellTone = "default" | "key" | "warning";

export type RichCell = {
  text: string | number;
  emphasis?: CellEmphasis;
  align?: CellAlign;
  tone?: CellTone;
};

export type TableCell = string | number | RichCell;

export type TableData = {
  columns: string[];
  rows: TableCell[][];
  columnAlign?: CellAlign[];
};

const CELL_KEYS = new Set(["text", "emphasis", "align", "tone"]);
const EMPHASIS = new Set(["default", "strong", "muted"]);
const ALIGNS = new Set(["left", "center", "right"]);
const TONES = new Set(["default", "key", "warning"]);

function isRichCell(value: unknown): value is RichCell {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["text", "emphasis", "align", "tone"])) return false;
  if (typeof value.text !== "string" && typeof value.text !== "number") return false;
  if (typeof value.text === "string" && !boundedString(value.text, 1000)) return false;
  if (value.emphasis !== undefined && (typeof value.emphasis !== "string" || !EMPHASIS.has(value.emphasis))) return false;
  if (value.align !== undefined && (typeof value.align !== "string" || !ALIGNS.has(value.align))) return false;
  if (value.tone !== undefined && (typeof value.tone !== "string" || !TONES.has(value.tone))) return false;
  return true;
}

// Normalize a cell to the rich form (plain string/number → {text}). Plain
// values pass through; rich objects keep their styling fields.
function normalizeCell(value: unknown): RichCell | null {
  if (typeof value === "string" || typeof value === "number") {
    if (typeof value === "string" && !boundedString(value, 1000)) return null;
    return { text: value };
  }
  if (isRichCell(value)) {
    return {
      text: value.text,
      ...(value.emphasis !== undefined ? { emphasis: value.emphasis } : {}),
      ...(value.align !== undefined ? { align: value.align } : {}),
      ...(value.tone !== undefined ? { tone: value.tone } : {}),
    };
  }
  return null;
}

registerKind({
  kind: "table",
  label: "Data table",
  promptSpec: `data:{columns:string[],rows:[[{text,emphasis?,align?,tone?}|string|number][]],columnAlign?:["left"|"center"|"right"]}`,
  validate(data): { ok: true; data: TableData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["columns", "rows", "columnAlign"]) || !stringArray(d.columns, 12, 1000)) {
      return { ok: false, reason: "Table columns must contain at most 12 strings" };
    }
    if (!Array.isArray(d.rows) || d.rows.length > 60) return { ok: false, reason: "Table rows must contain at most 60 rows" };

    // Optional per-column alignment.
    let columnAlign: CellAlign[] | undefined;
    if (d.columnAlign !== undefined) {
      if (!Array.isArray(d.columnAlign) || d.columnAlign.length !== d.columns.length || d.columnAlign.some((a) => typeof a !== "string" || !ALIGNS.has(a))) {
        return { ok: false, reason: "Table columnAlign must match the columns and contain left/center/right" };
      }
      columnAlign = d.columnAlign as CellAlign[];
    }

    const rows: TableCell[][] = [];
    for (const row of d.rows) {
      if (!Array.isArray(row) || row.length !== d.columns.length) {
        return { ok: false, reason: "Table rows must match the columns" };
      }
      const normalized: RichCell[] = [];
      for (const cell of row) {
        const n = normalizeCell(cell);
        if (!n) return { ok: false, reason: "Table cells must be bounded strings, numbers, or {text,emphasis?,align?,tone?}" };
        normalized.push(n);
      }
      rows.push(normalized);
    }
    return { ok: true, data: { columns: d.columns as string[], rows, ...(columnAlign ? { columnAlign } : {}) } };
  },
});