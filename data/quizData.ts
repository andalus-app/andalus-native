/**
 * Quiz data layer — V2
 *
 * Rule: difficulty is ONLY derived from the actual data.
 * A category shows difficulty selection only when its questions carry
 * a `difficulty` field AND more than one value is present.
 * In the current dataset only "profeter_i_islam" qualifies.
 * All other categories expose all their questions without any difficulty filter.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import rawData from './quizQuestions.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuizDifficulty = 'Lätt' | 'Medel' | 'Svår';

export interface QuizQuestion {
  id:            string;
  categoryId:    string;   // injected from parent category at parse-time
  categoryTitle: string;   // injected from parent category at parse-time
  question:      string;
  options:       string[];
  correctAnswer: string;
  difficulty?:   QuizDifficulty;
}

export interface QuizPlayableCategory {
  id:                    string;
  title:                 string;
  totalQuestions:        number;
  hasDifficultyLevels:   boolean;          // true only if >1 difficulty in data
  availableDifficulties: QuizDifficulty[]; // empty for non-difficulty categories
}

export interface QuizSessionQuestion extends QuizQuestion {
  shuffledOptions: string[];
}

export interface QuizSessionConfig {
  categoryId:   string;
  difficulty?:  QuizDifficulty; // only set when hasDifficultyLevels === true
  limit:        number;
  timeLimitSec: number;         // 0 = unlimited
}

export interface QuizAnswerResult {
  questionId:     string;
  categoryId:     string;
  categoryTitle:  string;
  difficulty?:    QuizDifficulty;
  question:       string;
  selectedAnswer: string | null;
  correctAnswer:  string;
  isCorrect:      boolean;
  timeSpentMs:    number;
}

export interface QuizSummary {
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers:   number;
  percentage:     number;
  bestStreak:     number;
  averageTimeMs:  number;
}

export interface QuizStoredStats {
  highScorePercentage: number;
  bestStreak:          number;
  totalCompletedRuns:  number;
  latestSummary?:      QuizSummary;
}

// ── Internal parsed data ──────────────────────────────────────────────────────

interface ParsedCategory {
  id:        string;
  title:     string;
  questions: QuizQuestion[];
}

const PARSED_CATEGORIES: ParsedCategory[] = (rawData as any).categories.map(
  (cat: any): ParsedCategory => ({
    id:    cat.id    as string,
    title: cat.title as string,
    questions: (cat.questions as any[]).map((q: any): QuizQuestion => ({
      id:            q.id            as string,
      categoryId:    cat.id          as string,
      categoryTitle: cat.title       as string,
      question:      q.question      as string,
      options:       q.options       as string[],
      correctAnswer: q.correctAnswer as string,
      difficulty:    q.difficulty    as QuizDifficulty | undefined,
    })),
  }),
);

// ── Utilities ─────────────────────────────────────────────────────────────────

const DIFFICULTY_ORDER: QuizDifficulty[] = ['Lätt', 'Medel', 'Svår'];

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Returns only the difficulty values that actually appear in the question set. */
function getAvailableDifficulties(questions: QuizQuestion[]): QuizDifficulty[] {
  const found = new Set<QuizDifficulty>();
  for (const q of questions) {
    if (q.difficulty) found.add(q.difficulty);
  }
  return DIFFICULTY_ORDER.filter(d => found.has(d));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** All categories with metadata derived strictly from the data. */
export function getPlayableCategories(): QuizPlayableCategory[] {
  return PARSED_CATEGORIES
    .filter(c => c.questions.length > 0)
    .map(c => {
      const diffs = getAvailableDifficulties(c.questions);
      return {
        id:                    c.id,
        title:                 c.title,
        totalQuestions:        c.questions.length,
        hasDifficultyLevels:   diffs.length > 1,
        availableDifficulties: diffs,
      };
    });
}

/**
 * How many questions are available for a given category + optional difficulty.
 * Used to cap the question-count selector and check for empty combos.
 */
export function getAvailableCount(categoryId: string, difficulty?: QuizDifficulty): number {
  const cat = PARSED_CATEGORIES.find(c => c.id === categoryId);
  if (!cat) return 0;
  if (!difficulty) return cat.questions.length;
  return cat.questions.filter(q => q.difficulty === difficulty).length;
}

/**
 * Build a shuffled quiz session.
 * - Shuffles question order (Fisher-Yates).
 * - Shuffles each question's answer options.
 * - Applies difficulty filter ONLY when the category actually has difficulty levels.
 * - Slices to `config.limit`.
 */
export function buildQuizSession(config: QuizSessionConfig): QuizSessionQuestion[] {
  const cat = PARSED_CATEGORIES.find(c => c.id === config.categoryId);
  if (!cat) return [];

  const diffs = getAvailableDifficulties(cat.questions);
  let pool    = [...cat.questions];

  // Strict difficulty filter — only applies to categories with actual difficulty data
  if (diffs.length > 1 && config.difficulty) {
    pool = pool.filter(q => q.difficulty === config.difficulty);
  }

  const shuffled = shuffleArray(pool).map(q => ({
    ...q,
    shuffledOptions: shuffleArray(q.options),
  }));

  return shuffled.slice(0, Math.min(config.limit, shuffled.length));
}

/** Pure summary calculation — no side effects. */
export function calculateSummary(answers: QuizAnswerResult[]): QuizSummary {
  let correct = 0, streak = 0, best = 0, totalMs = 0;
  for (const a of answers) {
    totalMs += a.timeSpentMs;
    if (a.isCorrect) { correct++; streak++; best = Math.max(best, streak); }
    else               { streak = 0; }
  }
  const total = answers.length;
  return {
    totalQuestions: total,
    correctAnswers: correct,
    wrongAnswers:   total - correct,
    percentage:     total > 0 ? Math.round((correct / total) * 100) : 0,
    bestStreak:     best,
    averageTimeMs:  total > 0 ? Math.round(totalMs / total) : 0,
  };
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'andalus_quiz_stats_v2';

const DEFAULT_STATS: QuizStoredStats = {
  highScorePercentage: 0,
  bestStreak:          0,
  totalCompletedRuns:  0,
};

export async function loadQuizStats(): Promise<QuizStoredStats> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_STATS, ...JSON.parse(raw) } : DEFAULT_STATS;
  } catch {
    return DEFAULT_STATS;
  }
}

export async function saveQuizSummary(summary: QuizSummary): Promise<QuizStoredStats> {
  const prev = await loadQuizStats();
  const next: QuizStoredStats = {
    highScorePercentage: Math.max(prev.highScorePercentage, summary.percentage),
    bestStreak:          Math.max(prev.bestStreak, summary.bestStreak),
    totalCompletedRuns:  prev.totalCompletedRuns + 1,
    latestSummary:       summary,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
