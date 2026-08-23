"use client";

import { useMemo, useState } from "react";
import type { TableCell, RichCell, CellEmphasis, CellTone, CellAlign } from "@/lib/artifacts/kinds/table";

interface TableArtifactProps {
  columns: string[];
  rows: TableCell[][];
  columnAlign?: CellAlign[];
}

function asRich(cell: TableCell): RichCell {
  if (typeof cell === "string" || typeof cell === "number") return { text: cell };
  return cell;
}

const EMPHASIS_CLASS: Record<CellEmphasis, string> = {
  default: "text-content",
  strong: "font-semibold text-ink",
  muted: "text-content-faint",
};

const TONE_CLASS: Record<CellTone, string> = {
  default: "",
  key: "text-rule",
  warning: "text-band-slipping",
};

const ALIGN_CLASS: Record<CellAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function cellText(cell: RichCell): string | number {
  return cell.text;
}

function compareCells(a: RichCell, b: RichCell): number {
  const ta = a.text;
  const tb = b.text;
  if (typeof ta === "number" && typeof tb === "number") return ta - tb;
  return String(ta).localeCompare(String(tb));
}

export function TableArtifact({ columns, rows, columnAlign }: TableArtifactProps) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedRows = useMemo(() => {
    if (sortCol === null) return rows;
    const indexed = rows.map((row, i) => ({ row, i }));
    indexed.sort((a, b) => {
      const cmp = compareCells(asRich(a.row[sortCol] ?? ""), asRich(b.row[sortCol] ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return indexed.map((x) => x.row);
  }, [rows, sortCol, sortDir]);

  function toggleSort(col: number) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-[12px] leading-relaxed text-content">
        <thead className="mono border-b border-border text-[10px] tracking-wide text-content-faint">
          <tr>
            {columns.map((column, i) => {
              const align = columnAlign?.[i] ?? "left";
              const isActive = sortCol === i;
              return (
                <th
                  key={column}
                  scope="col"
                  className={`px-3 py-2 font-medium ${ALIGN_CLASS[align]} cursor-pointer select-none transition-colors hover:text-content ${isActive ? "text-content" : ""}`}
                  onClick={() => toggleSort(i)}
                  aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {column}
                    {isActive && <span className="text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {sortedRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => {
                const rich = asRich(cell);
                const align = rich.align ?? columnAlign?.[columnIndex] ?? "left";
                return (
                  <td
                    key={columnIndex}
                    className={`px-3 py-2 align-top ${ALIGN_CLASS[align]} ${EMPHASIS_CLASS[rich.emphasis ?? "default"]} ${TONE_CLASS[rich.tone ?? "default"]}`}
                  >
                    {String(rich.text)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}