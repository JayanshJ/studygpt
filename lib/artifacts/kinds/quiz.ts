import { registerKind, hasOnlyKeys, isPlainObject, boundedString, optionalString, stringArray } from "../registry";

// Two quiz item shapes: multiple-choice and true/false.
export type McqItem = {
  prompt: string;
  options: string[];
  answer: number; // index into options
  explanation?: string;
};

export type TrueFalseItem = {
  prompt: string;
  statement: string;
  answer: boolean;
  explanation?: string;
};

export type QuizItem = McqItem | TrueFalseItem;
export type QuizData = { items: QuizItem[] };

const MAX_ITEMS = 20;
const MAX_OPTIONS = 6;

function isMcqItem(value: unknown): value is McqItem {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["prompt", "options", "answer", "explanation"])) return false;
  if (!boundedString(value.prompt, 2000)) return false;
  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > MAX_OPTIONS || !value.options.every((o) => boundedString(o, 1000))) return false;
  if (typeof value.answer !== "number" || !Number.isInteger(value.answer) || value.answer < 0 || value.answer >= value.options.length) return false;
  if (!optionalString(value.explanation, 2000)) return false;
  return true;
}

function isTrueFalseItem(value: unknown): value is TrueFalseItem {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["prompt", "statement", "answer", "explanation"])) return false;
  if (!boundedString(value.prompt, 2000)) return false;
  if (!boundedString(value.statement, 2000)) return false;
  if (typeof value.answer !== "boolean") return false;
  if (!optionalString(value.explanation, 2000)) return false;
  return true;
}

registerKind({
  kind: "quiz",
  label: "Quiz",
  promptSpec: `data:{items:[{prompt,options:string[],answer:number,explanation?}|{prompt,statement,answer:boolean,explanation?}]}`,
  aliases: ["mcq", "multiple-choice", "question", "questions"],
  validate(data): { ok: true; data: QuizData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["items"]) || !Array.isArray(d.items) || d.items.length === 0 || d.items.length > MAX_ITEMS) {
      return { ok: false, reason: `Quiz must contain between 1 and ${MAX_ITEMS} items` };
    }
    const items: QuizItem[] = [];
    for (const item of d.items) {
      if (isMcqItem(item)) {
        items.push({
          prompt: item.prompt,
          options: item.options,
          answer: item.answer,
          ...(item.explanation !== undefined ? { explanation: item.explanation } : {}),
        });
      } else if (isTrueFalseItem(item)) {
        items.push({
          prompt: item.prompt,
          statement: item.statement,
          answer: item.answer,
          ...(item.explanation !== undefined ? { explanation: item.explanation } : {}),
        });
      } else {
        return { ok: false, reason: "Quiz items must be {prompt,options,answer,explanation?} or {prompt,statement,answer,explanation?}" };
      }
    }
    return { ok: true, data: { items } };
  },
});