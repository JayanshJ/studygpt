// Mastery-aware RAG for chat. `scoreChunks` is pure (cosine + optional
// mastery re-rank) and unit-tested; `retrieve` is the DB+embed orchestrator
// extracted verbatim from app/api/chat/route.ts (behavior-preserving).

import { embedText, decodeEmbedding, cosine } from "@/lib/embed";
import { listChunkEmbeddingsForProject } from "@/lib/db";
import { conceptMasteryForProject, chunksToConcepts } from "@/lib/db/mastery";
import type { Band } from "@/lib/mastery/model";
import type { SourceEntry, Message } from "@/lib/db/schema";

export interface ChunkEmb {
  materialId: string;
  ordinal: number;
  text: string;
  materialTitle: string;
  embedding: Buffer;
}

export interface ScoredChunk {
  c: ChunkEmb;
  sim: number;
  score: number;
}

const DEFAULT_FLOOR = 0.22;

// Pure: cosine score + floor + sort. Mastery re-rank is added in Task 5 via opts.
export function scoreChunks(
  queryVec: Float32Array,
  chunks: ChunkEmb[],
  opts?: {
    floor?: number;
    masteryByConcept?: Map<string, number>;
    conceptsForChunk?: Map<string, { conceptId: string; label: string }[]>;
  },
): ScoredChunk[] {
  const floor = opts?.floor ?? DEFAULT_FLOOR;
  const MASTERY_WEIGHT = 0.15;
  return chunks
    .map((c) => {
      const sim = cosine(queryVec, decodeEmbedding(c.embedding));
      let score = sim;
      if (opts?.masteryByConcept && opts?.conceptsForChunk) {
        const linked = opts.conceptsForChunk.get(`${c.materialId}:${c.ordinal}`);
        if (linked && linked.length) {
          // max numeric mastery among reviewed concepts; untested/unknown absent
          let chunkMastery: number | null = null;
          for (const lc of linked) {
            const m = opts.masteryByConcept.get(lc.conceptId);
            if (m != null && Number.isFinite(m)) {
              chunkMastery = chunkMastery == null ? m : Math.max(chunkMastery, m);
            }
          }
          if (chunkMastery != null) score = sim + MASTERY_WEIGHT * (1 - chunkMastery);
        }
      }
      return { c, sim, score } as ScoredChunk;
    })
    .filter((s) => Number.isFinite(s.sim) && s.sim >= floor)
    .sort((a, b) => b.score - a.score);
}

// Minimal structural shape `retrieve` reads from chat messages. The route
// passes its request-body messages (not full DB `Message` rows); only
// `role`/`content` are touched inside the orchestrator.
type RetrieveMessage = { role: Message["role"]; content: string };

export async function retrieve(opts: {
  projectId: string;
  lastUser: RetrieveMessage | undefined;
  lastUserContent: string;
  messages: RetrieveMessage[];
}): Promise<{ contextBlock: string; sources: SourceEntry[] } | null> {
  let contextBlock = "";
  let sources: SourceEntry[] = [];
  try {
    if (opts.projectId) {
      const chunks = listChunkEmbeddingsForProject(opts.projectId);
      // --- Mastery signal (SP4) --------------------------------------
      // Build per-project mastery map + chunk→concepts index once per
      // retrieve call. Empty when the project has no concepts/mastery → every
      // chunk neutral → behavior identical to Task 4 (regression guard).
      const now = Date.now();
      const masteryMap = conceptMasteryForProject(opts.projectId, now);
      // numeric mastery by concept id (only reviewed concepts have a number)
      const masteryByConcept = new Map<string, number>();
      for (const [cid, m] of masteryMap) {
        if (m.mastery != null) masteryByConcept.set(cid, m.mastery);
      }
      // Batched: one chunksToConcepts call per material with all its ordinals.
      const conceptsForChunk = new Map<string, { conceptId: string; label: string }[]>();
      const ordinalsByMaterial = new Map<string, number[]>();
      for (const c of chunks) {
        let arr = ordinalsByMaterial.get(c.materialId);
        if (!arr) {
          arr = [];
          ordinalsByMaterial.set(c.materialId, arr);
        }
        arr.push(c.ordinal);
      }
      for (const [mid, ords] of ordinalsByMaterial) {
        const m = chunksToConcepts(mid, ords);
        for (const [k, v] of m) conceptsForChunk.set(k, v);
      }
      if (chunks.length > 0 && opts.lastUser) {
        // Clean the query: strip leading `>` quote lines and markdown fences,
        // collapse whitespace, truncate to ~600 chars.
        const strippedFences = opts.lastUserContent.replace(/```[\s\S]*?```/g, " ");
        const withoutQuotes = strippedFences
          .split("\n")
          .filter((ln) => !/^\s*>/.test(ln))
          .join("\n");
        const cleaned = withoutQuotes.replace(/\s+/g, " ").trim().slice(0, 600);
        const cleanQuery = cleaned || opts.lastUserContent.slice(0, 600);

        // --- Explicit material reference detection ----------------------
        // A request like "make flashcards from Übungsblatt 6" is a *meta*
        // request: it names a material but isn't semantically similar to that
        // material's content. Pure cosine retrieval scores those chunks low,
        // drops them under the 0.22 floor, and selects whichever materials
        // have incidental similarity (e.g. sheets 1/7/9) instead. Detect when
        // the user names a material — by full title, or by "<word> <number>"
        // (e.g. "übungsblatt 6", "kapitel 6") — and force that material's
        // chunks in regardless of cosine. The word match is fuzzy so a mangled
        // spoken/typed word ("un-bungblatt") still matches "uebungsblatt".
        const normRef = (s: string) =>
          s
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/\.(pdf|txt|md|markdown|csv|tsv|json|docx?)$/i, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        const refTokens = (s: string) => {
          const t = normRef(s);
          return t ? t.split(" ").filter(Boolean) : [];
        };
        const isAlphaTok = (t: string) => /[a-z]/.test(t) && t.length >= 4;
        // Fuzzy word match tolerant of transcription/typo mangling, e.g.
        // "bungblatt" matches "uebungsblatt": contiguous substring either way,
        // OR subsequence (only for ≥5 chars so short words don't over-match).
        const fuzzyWord = (a: string, b: string) => {
          if (!a || !b) return false;
          if (a.includes(b) || b.includes(a)) return true;
          if (a.length < 5 || b.length < 5) return false;
          const [hay, needle] = a.length >= b.length ? [a, b] : [b, a];
          let i = 0;
          for (const ch of hay) {
            if (ch === needle[i]) {
              i++;
              if (i === needle.length) return true;
            }
          }
          return false;
        };

        const materialTitles = new Map<string, string>();
        for (const c of chunks) {
          if (!materialTitles.has(c.materialId)) materialTitles.set(c.materialId, c.materialTitle);
        }

        const detectRefs = (text: string): Set<string> => {
          const ids = new Set<string>();
          const qToks = refTokens(text);
          const qNorm = normRef(text);
          for (const [mid, title] of materialTitles) {
            const tToks = refTokens(title);
            const tNums = tToks.filter((t) => /^\d+$/.test(t));
            const tAlpha = tToks.filter(isAlphaTok);
            const tNorm = normRef(title);
            // (1) full normalized title appears in the query (clean mention)
            if (tNorm && tNorm.length >= 3 && qNorm.includes(tNorm)) {
              ids.add(mid);
              continue;
            }
            // (2) "<word> <number>": a query number matches a title number,
            // with an alpha qualifier right before it fuzzy-matching the
            // title's alpha token. Disambiguates "übungsblatt 6" →
            // 6._Uebungsblatt vs Kapitel_6, and ignores count words like
            // "make 10 flashcards" (no title word before the number).
            for (let qi = 0; qi < qToks.length; qi++) {
              if (!/^\d+$/.test(qToks[qi])) continue;
              if (!tNums.includes(qToks[qi])) continue;
              let qualifier = "";
              for (let j = qi - 1; j >= Math.max(0, qi - 3); j--) {
                if (isAlphaTok(qToks[j])) {
                  qualifier = qToks[j];
                  break;
                }
              }
              if (!qualifier) continue; // bare number → too ambiguous (could be a count)
              if (tAlpha.some((a) => fuzzyWord(a, qualifier))) {
                ids.add(mid);
                break;
              }
            }
          }
          return ids;
        };

        let explicitIds = detectRefs(opts.lastUserContent);
        // A bare follow-up like "again" / "make them again" carries no
        // material name; pull the reference from the prior user turn so the
        // redo keeps the same material instead of falling back to semantic.
        if (explicitIds.size === 0 && opts.lastUserContent.trim().split(/\s+/).length <= 10) {
          const prevUser = [...opts.messages]
            .reverse()
            .filter((m) => m.role === "user")
            .slice(1, 3)
            .map((m) => m.content)
            .join(" ");
          if (prevUser) explicitIds = detectRefs(prevUser);
        }

        // --- Semantic scoring (for non-explicit selection) ------------
        const qVec = new Float32Array(await embedText(cleanQuery));
        const scored = scoreChunks(qVec, chunks.map((c) => ({ materialId: c.materialId, ordinal: c.ordinal, text: c.text, materialTitle: c.materialTitle ?? "", embedding: c.embedding })), { masteryByConcept, conceptsForChunk });
        const eligible = scored; // already floored + sorted

        // Material routing: per-material max chunk score → rank → top 4
        // (or all if fewer). Only chunks from selected materials are eligible
        // for excerpt selection, but the inventory below lists every material.
        const perMaterial = new Map<string, { title: string; max: number }>();
        for (const s of eligible) {
          const cur = perMaterial.get(s.c.materialId);
          if (!cur || s.sim > cur.max) {
            perMaterial.set(s.c.materialId, { title: s.c.materialTitle, max: s.sim });
          }
        }
        const rankedMaterials = [...perMaterial.entries()]
          .sort((a, b) => b[1].max - a[1].max)
          .slice(0, 4)
          .map(([id]) => id);
        // Selected = top-4 semantic ∪ explicitly referenced materials.
        const selectedMatSet = new Set(rankedMaterials);
        for (const id of explicitIds) selectedMatSet.add(id);

        // Index every chunk in selected materials by `${materialId}:${ordinal}`
        // so neighbor expansion can look up ordinal ±1 regardless of score.
        const chunkIndex = new Map<string, ChunkEmb>();
        for (const c of chunks) {
          if (selectedMatSet.has(c.materialId)) {
            chunkIndex.set(`${c.materialId}:${c.ordinal}`, { materialId: c.materialId, ordinal: c.ordinal, text: c.text, materialTitle: c.materialTitle ?? "", embedding: c.embedding });
          }
        }

        const eligibleSelected = eligible
          .filter((s) => selectedMatSet.has(s.c.materialId))
          .sort((a, b) => b.score - a.score);

        // Inventory of ALL project materials (title + chunk count).
        const inventoryMap = new Map<string, { title: string; count: number }>();
        for (const c of chunks) {
          const cur = inventoryMap.get(c.materialId);
          if (cur) cur.count += 1;
          else inventoryMap.set(c.materialId, { title: c.materialTitle, count: 1 });
        }
        const inventory = [...inventoryMap.values()];

        // Greedily take top chunks with neighbor expansion (ordinal ±1),
        // dedup by first-80 chars, accumulate until ~6000-char budget.
        const BUDGET = 6000;
        const seenText = new Set<string>();
        const pickedOrdinals = new Set<string>();
        const picked: Array<{ c: ChunkEmb; sim: number }> = [];
        let totalChars = 0;

        const tryAdd = (chunk: ChunkEmb): boolean => {
          const textKey = chunk.text.slice(0, 80);
          const ordKey = `${chunk.materialId}:${chunk.ordinal}`;
          if (seenText.has(textKey) || pickedOrdinals.has(ordKey)) return false;
          if (totalChars + chunk.text.length > BUDGET && picked.length > 0) return false;
          seenText.add(textKey);
          pickedOrdinals.add(ordKey);
          picked.push({ c: chunk, sim: 0 });
          totalChars += chunk.text.length;
          return true;
        };

        // (A) Explicitly referenced materials FIRST: take their chunks in
        // natural document order (ordinal) up to a per-material slice of the
        // budget, bypassing the cosine floor — the user asked for THIS
        // material, so its content is relevant by reference, not similarity.
        if (explicitIds.size > 0) {
          const explicitSlice = Math.max(2500, Math.floor(BUDGET / explicitIds.size));
          for (const mid of explicitIds) {
            const ordered = chunks
              .filter((c) => c.materialId === mid)
              .sort((a, b) => a.ordinal - b.ordinal);
            let used = 0;
            for (const c of ordered) {
              if (used >= explicitSlice) break;
              if (tryAdd(c)) used += c.text.length;
            }
          }
        }

        // (B) Fill the remaining budget with the top semantic chunks from
        // the other selected materials, with neighbor expansion.
        for (const s of eligibleSelected) {
          if (totalChars >= BUDGET) break;
          if (explicitIds.has(s.c.materialId)) continue; // already seeded above
          tryAdd(s.c);
          for (const d of [-1, 1]) {
            const neighbor = chunkIndex.get(`${s.c.materialId}:${s.c.ordinal + d}`);
            if (neighbor) tryAdd(neighbor);
          }
        }

        sources = picked.map((s) => {
          const concepts = (conceptsForChunk.get(`${s.c.materialId}:${s.c.ordinal}`) ?? []).map((c) => ({
            label: c.label,
            band: masteryMap.get(c.conceptId)?.band ?? ("unknown" as Band),
          }));
          return {
            materialId: s.c.materialId,
            title: s.c.materialTitle,
            snippet: s.c.text.slice(0, 240),
            ordinal: s.c.ordinal,
            ...(concepts.length ? { concepts } : {}),
          } satisfies SourceEntry;
        });

        const inventoryLines = inventory
          .map((m, i) => `${i + 1}. ${m.title} (${m.count} chunk${m.count === 1 ? "" : "s"})`)
          .join("\n");

        // Group selected excerpts by material for the context block.
        const byMaterial = new Map<string, { title: string; texts: string[] }>();
        for (const s of picked) {
          let g = byMaterial.get(s.c.materialId);
          if (!g) {
            g = { title: s.c.materialTitle, texts: [] };
            byMaterial.set(s.c.materialId, g);
          }
          const concepts = conceptsForChunk.get(`${s.c.materialId}:${s.c.ordinal}`) ?? [];
          const header = concepts.length
            ? `[covers: ${concepts.map((c) => `${c.label} (${masteryMap.get(c.conceptId)?.band ?? "unknown"})`).join(", ")}]\n`
            : "";
          g.texts.push(header + s.c.text);
        }

        const excerpts = [...byMaterial.values()]
          .map((g) => `<excerpt material="${g.title}">\n${g.texts.join("\n\n")}\n</excerpt>`)
          .join("\n---\n");

        const explicitNote =
          explicitIds.size > 0
            ? `The user explicitly referenced: ${[...explicitIds]
                .map((id) => materialTitles.get(id) ?? "")
                .filter(Boolean)
                .join(", ")}. Focus on those materials' excerpts and cite them by title. `
            : "";

        contextBlock =
          `\n\n<context>\n` +
          `You are working within a study project with the following reference materials:\n` +
          `${inventoryLines}\n` +
          `${explicitNote}` +
          `The excerpts below are the most relevant passages retrieved for this question. ` +
          `Use them to ground your answer and cite a source by its title in square brackets when you rely on it. ` +
          `If the user names a specific material, focus your answer on that material. ` +
          `If the answer is not in the excerpts, say so, then either answer from general knowledge and say so, ` +
          `or use the web_search tool if web search is enabled.\n\n` +
          `${excerpts}\n</context>`;
      }
    }
  } catch {
    return null;
  }
  return { contextBlock, sources };
}