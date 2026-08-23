import { registerKind, hasOnlyKeys, isPlainObject, boundedString, optionalString, stringArray } from "../registry";

export type DefinitionData = {
  term: string;
  pronunciation?: string;
  partOfSpeech?: string;
  meaning: string;
  example?: string;
  related?: string[];
  tone?: "default" | "key";
};

registerKind({
  kind: "definition",
  label: "Definition",
  promptSpec: `data:{term:string,pronunciation?:string,partOfSpeech?:string,meaning:string,example?:string,related?:string[],tone?:"default"|"key"}`,
  aliases: ["key-term", "term", "glossary"],
  validate(data): { ok: true; data: DefinitionData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["term", "pronunciation", "partOfSpeech", "meaning", "example", "related", "tone"])) {
      return { ok: false, reason: "Definition data contains unsupported keys" };
    }
    if (!boundedString(d.term, 200)) return { ok: false, reason: "Definition term must be a string of at most 200 characters" };
    if (!boundedString(d.meaning, 2000)) return { ok: false, reason: "Definition meaning must be a string of at most 2000 characters" };
    if (!optionalString(d.pronunciation, 200)) return { ok: false, reason: "Definition pronunciation must be at most 200 characters" };
    if (!optionalString(d.partOfSpeech, 100)) return { ok: false, reason: "Definition partOfSpeech must be at most 100 characters" };
    if (!optionalString(d.example, 2000)) return { ok: false, reason: "Definition example must be at most 2000 characters" };
    if (d.tone !== undefined && d.tone !== "default" && d.tone !== "key") {
      return { ok: false, reason: "Definition tone must be default or key" };
    }
    let related: string[] | undefined;
    if (d.related !== undefined) {
      if (!stringArray(d.related, 12, 200)) return { ok: false, reason: "Definition related must contain at most 12 strings" };
      related = d.related;
    }
    return {
      ok: true,
      data: {
        term: d.term,
        meaning: d.meaning,
        ...(d.pronunciation !== undefined ? { pronunciation: d.pronunciation } : {}),
        ...(d.partOfSpeech !== undefined ? { partOfSpeech: d.partOfSpeech } : {}),
        ...(d.example !== undefined ? { example: d.example } : {}),
        ...(related ? { related } : {}),
        ...(d.tone !== undefined ? { tone: d.tone } : {}),
      },
    };
  },
});