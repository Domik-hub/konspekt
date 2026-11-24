export type QuestionKind = "choice" | "open";
export type Format = "mixed" | "choice" | "open";
export type Difficulty = "easy" | "medium" | "hard";
export type Language = "ru" | "kk" | "en";
export type Question = {
  id: string;
  kind: QuestionKind;
  prompt: string;
  answer: string;
  options: string[];
  source: string;
  sourceName: string;
  rubric?: string[];
  explanation?: string;
  generatedBy?: "ai" | "local";
};
export type Material = { name: string; text: string };
export type StudySet = {
  id: string;
  title: string;
  createdAt: string;
  questions: Question[];
  words: number;
  difficulty: Difficulty;
  sourceNames: string[];
  generatedBy?: "ai" | "local";
  language?: Language;
  optionOrderVersion?: 1;
};
export type Attempt = { id: string; setId: string; title: string; at: string; correct: number; total: number };

const STOP = new Set(("который которая которые которое этого этому этот этой эти также только очень может могут будет будут чтобы потому является являются представляет собой например далее таким образом между через после перед когда тогда кроме более менее всего такой такая такое таких можно нужно следует данной данный данном здесь имеет имеют составляет составляют происходит происходят the this that those these which with from have has been were are and for not into than then their there about such some however therefore being would could should").split(" "));
const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");

function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function wordCount(text: string) { return (text.match(/[\p{L}\p{N}]+/gu) || []).length; }

type Fact = { source: string; sourceName: string; term?: string; definition?: string; keyword: string; offset: number };
function facts(materials: Material[], difficulty: Difficulty): Fact[] {
  const result: Fact[] = [];
  const seen = new Set<string>();
  for (const material of materials) {
    const cleaned = material.text.replace(/\r/g, "").replace(/([\p{L}])-\n(?=[\p{L}])/gu, "$1").replace(/[ \t]+/g, " ");
    const segmenter = new Intl.Segmenter("ru", { granularity: "sentence" });
    const segments = [...segmenter.segment(cleaned)].flatMap(s => s.segment.split(/\n\s*\n|\n(?=[•*–—-] )/));
    for (const raw of segments) {
      const source = raw.replace(/^[\s•*#–—-]+/, "").replace(/\s+/g, " ").trim();
      if (source.length < 35 || source.length > 650 || wordCount(source) < 6 || seen.has(norm(source))) continue;
      seen.add(norm(source));
      const def = source.match(/^([\p{L}\p{N}][\p{L}\p{N}\s(),-]{1,75}?)\s+(?:[—–-]\s*(?:это\s+)?|это\s+|is\s+(?:an?\s+)?)(.+)[.!?]?$/iu);
      const tokens = [...source.matchAll(/[\p{L}][\p{L}-]{4,}/gu)].filter(m => !STOP.has(m[0].toLowerCase()) && !/^(котор|данн|следующ|некотор|различн|основн|важн)/i.test(m[0]));
      if (!tokens.length) continue;
      const numeric = source.match(/\b\d+(?:[,.]\d+)?(?:\s*(?:%|год[ауов]*|лет|дн[яей]*|час[аов]*|минут[ауы]*|секунд[ауы]*))?/u);
      const candidate = difficulty === "easy" && numeric ? numeric : [...tokens].sort((a,b)=>b[0].length - a[0].length)[0];
      result.push({ source, sourceName: material.name, term: def?.[1].trim(), definition: def?.[2].replace(/[.!?]$/, "").trim(), keyword: candidate[0], offset: candidate.index! });
    }
  }
  return result;
}

export function generateQuestions(materials: Material[], count: number, format: Format, difficulty: Difficulty, seed = Date.now()): Question[] {
  const all = facts(materials, difficulty);
  if (all.length < 2) throw new Error("Нужно чуть больше материала: добавьте хотя бы 2–3 полных предложения с фактами или определениями.");
  const rng = random(seed);
  const candidates = shuffle(all, rng);
  const selected = candidates.slice(0, Math.min(count, candidates.length));
  return selected.map((fact, i) => {
    let kind: QuestionKind = format === "mixed" ? (i % 3 === 2 ? "open" : "choice") : format;
    if (difficulty === "hard" && format === "mixed") kind = i % 3 === 0 ? "choice" : "open";
    let answer = fact.term || fact.keyword;
    const prompt = fact.definition
      ? (kind === "open" && difficulty === "hard" ? `Объясните своими словами, что такое «${fact.term}».` : `Какое понятие соответствует определению?\n«${fact.definition}»`)
      : `Восстановите пропуск в утверждении из лекции:\n«${fact.source.slice(0, fact.offset)}_____${fact.source.slice(fact.offset + fact.keyword.length)}»`;
    if (kind === "open" && difficulty === "hard" && fact.definition) answer = fact.source;
    const pool = (fact.term ? all.filter(f => f.term).map(f => f.term!) : all.map(f => f.keyword).filter(word => {
      // Keep Russian word-completion alternatives grammatically comparable.
      // If the lecture does not supply enough, use an open question.
      return !/[а-яё]/i.test(answer) || word.toLowerCase().slice(-3) === answer.toLowerCase().slice(-3);
    }))
      .filter(v => norm(v) !== norm(answer) && !norm(fact.source).includes(norm(v)) && /[а-яё]/i.test(v) === /[а-яё]/i.test(answer));
    const unique = [...new Map(pool.map(v => [norm(v), v])).values()];
    const distractors = shuffle(unique, rng).slice(0, 3);
    if (kind === "choice" && distractors.length < 2) kind = "open";
    return { id: `q-${seed}-${i}`, kind, prompt, answer, options: kind === "choice" ? shuffle([answer, ...distractors], rng) : [], source: fact.source, sourceName: fact.sourceName };
  });
}

export const DEMO_TEXT = `Память — это способность сохранять, накапливать и воспроизводить информацию о прошлом опыте.

Сенсорная память — это кратковременное удержание информации, поступающей от органов чувств.

Кратковременная память — это система временного хранения небольшого объёма информации.

Долговременная память — это система хранения знаний и опыта в течение продолжительного времени.

Рабочая память — это система, которая временно удерживает информацию и позволяет использовать её при решении текущих задач.

Эпизодическая память — это память о личных событиях, связанных с определённым местом и временем.

Семантическая память — это память о фактах, значениях слов и общих знаниях о мире.

Процедурная память — это память о навыках и способах выполнения привычных действий.

Активное воспроизведение — это попытка вспомнить изученный материал без подсказок и повторного чтения.

Интервальное повторение — это повторение изученного материала через постепенно увеличивающиеся промежутки времени.

Осмысленное связывание новой информации с уже известной помогает лучше её запомнить.

Во время сна происходит закрепление и упорядочивание полученной за день информации.

Внимание помогает отбирать информацию для дальнейшей обработки и запоминания.

Чередование разных типов задач помогает научиться выбирать подходящий способ решения.`;
