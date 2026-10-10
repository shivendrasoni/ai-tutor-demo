import { confidenceFrom, sanitizeAnswers, type Decider, type DeciderAnswer, type DeciderQuestion } from './types';

type Probs = Record<string, number>;

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Probability map with `top` on `key` and the rest shared equally (sums to 1). */
function spread(keys: string[], key: string, top: number): Probs {
  const rest = keys.length - 1;
  return Object.fromEntries(keys.map((k) => [k, k === key ? (rest === 0 ? 1 : top) : (1 - top) / rest]));
}

const choiceAnswer = (keys: string[], key: string, top: number): DeciderAnswer => {
  const probabilities = spread(keys, key, top);
  return { type: 'choice', choice: key, probabilities, confidence: confidenceFrom(probabilities) };
};

// Only clearly harmful phrasing; bare words like "sex cells", "atom bomb" or "drugs" are curriculum vocabulary.
const UNSAFE =
  /\b(kill (myself|him|her|them)|suicide|self[- ]?harm|(hurt|harm|cut) myself|want to die|how (to|do i) (make|build) (a )?(bomb|weapon|explosives?)|porn)\b/i;
const FINAL_ANSWER =
  /\b(just|only)\s+(tell|give)\s+me\s+(the\s+)?(final\s+)?answer\b|\b(give|tell)\s+me\s+(the\s+)?(final\s+)?answers?\b|\bwhat'?s the answer\b|\bsolve it for me\b|\bdo (it|this|my homework) for me\b/i;
const EXAM = /\b(exams?|tests?|revise|revision|quiz|board|practice paper|prepare for)\b/i;
const SOLVE = /\b(solve|calculate|compute|simplify|find the|evaluate|factori[sz]e|prove)\b|\d\s*[+\-*/=^x×÷]\s*\d|=/i;
const OFF_TOPIC =
  /\b(joke|movie|film|song|lyrics|netflix|instagram|tiktok|youtube|video game|minecraft|fortnite|roblox|cricket score|celebrity|girlfriend|boyfriend|pizza|recipe|weather)\b/i;

/** Words that point at a subject even when its name is not said. Keys are matched against subject names. */
const SUBJECT_HINTS: Record<string, string[]> = {
  math: ['equation', 'fraction', 'algebra', 'triangle', 'angle', 'geometry', 'multiply', 'divide', 'integer', 'decimal', 'polynomial'],
  scien: ['photosynthesis', 'cell', 'atom', 'molecule', 'force', 'energy', 'plant', 'acid', 'gravity', 'physics', 'chemistry', 'biology'],
  eng: ['grammar', 'noun', 'verb', 'adjective', 'poem', 'essay', 'sentence', 'tense'],
  hist: ['empire', 'king', 'revolution', 'war', 'dynasty', 'independence'],
  geo: ['map', 'river', 'continent', 'climate', 'latitude', 'monsoon'],
};

/** Overlap score between the message and an option's label: prefix-matching words of length >= 4 count once each. */
function labelScore(msg: string[], label: string): number {
  const stems = words(label).filter((w) => w.length >= 4);
  let score = 0;
  for (const stem of stems) {
    const s = stem.slice(0, 4);
    if (msg.some((m) => m.length >= 4 && (m.startsWith(s) || stem.startsWith(m.slice(0, 4))))) score += 1;
  }
  for (const [prefix, hints] of Object.entries(SUBJECT_HINTS)) {
    if (words(label).some((w) => w.startsWith(prefix)) && msg.some((m) => hints.includes(m) || hints.includes(m.replace(/s$/, '')))) {
      score += 1;
    }
  }
  return score;
}

function intentOf(text: string, subjectMatched: boolean): string {
  if (UNSAFE.test(text)) return 'unsafe';
  if (FINAL_ANSWER.test(text)) return 'wants_final_answer';
  if (OFF_TOPIC.test(text) && !subjectMatched) return 'off_topic';
  if (EXAM.test(text)) return 'exam_prep';
  if (SOLVE.test(text)) return 'solve_problem';
  return 'learn_concept';
}

const STEP_WORDS = /\b(step|steps|explain|why|derive|prove|how do|in detail)\b/i;

function difficultyOf(text: string, levelCount: number): number {
  const n = words(text).length;
  const level = n >= 25 || /\bstep[- ]by[- ]step\b|\bsteps\b/i.test(text) ? 2 : n < 8 && !STEP_WORDS.test(text) ? 0 : 1;
  return Math.min(level, levelCount - 1);
}

/**
 * The latest user message: everything from the last line starting with `user: ` to the end of the state, so a
 * message containing its own `assistant: ` lines is kept whole. Limitation: a message that itself contains a line
 * starting with `user: ` is cut at that line (the `role: content` format cannot disambiguate it).
 */
function lastUserText(state: string): string {
  let start = -1;
  const re = /^user: /gm;
  for (let m = re.exec(state); m; m = re.exec(state)) start = m.index + m[0].length;
  return start < 0 ? state : state.slice(start);
}

/**
 * Deterministic Jev stand-in for keyless runs: keyword rules only, no I/O. Answers every question it can and
 * passes its output through `sanitizeAnswers`; a question it cannot answer is omitted ("no answer").
 */
export class MockDecider implements Decider {
  async decide(state: string, questions: Record<string, DeciderQuestion>): Promise<Record<string, DeciderAnswer>> {
    const text = lastUserText(state);
    const msg = words(text);
    const raw: Record<string, unknown> = {};
    const matchedSubject = (() => {
      const q = questions.subject;
      return q?.type === 'choice' && Object.entries(q.options).some(([id, label]) => id !== 'other' && labelScore(msg, label) > 0);
    })();

    for (const [id, q] of Object.entries(questions)) {
      if (q.type === 'yesno') {
        raw[id] = { type: 'yesno', p: 0.02 };
      } else if (q.type === 'score') {
        const score = difficultyOf(text, q.levels.length);
        const probabilities = spread(q.levels, q.levels[score], 0.7);
        raw[id] = { type: 'score', score, probabilities, confidence: confidenceFrom(probabilities) };
      } else if (id === 'intent') {
        const keys = Object.keys(q.options);
        const pick = intentOf(text, matchedSubject);
        if (keys.includes(pick)) raw[id] = choiceAnswer(keys, pick, 0.9);
      } else {
        const keys = Object.keys(q.options);
        const fallback = keys.find((k) => k === 'other' || k === 'none');
        let best: { key: string; score: number } | null = null;
        for (const [key, label] of Object.entries(q.options)) {
          if (key === fallback) continue;
          const score = labelScore(msg, label);
          if (score > 0 && (!best || score > best.score)) best = { key, score };
        }
        if (best) raw[id] = choiceAnswer(keys, best.key, 0.85);
        else if (fallback) raw[id] = choiceAnswer(keys, fallback, 0.6);
      }
    }
    return sanitizeAnswers(questions, raw);
  }
}
