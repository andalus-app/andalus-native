/**
 * wellbeingSearch.ts
 *
 * Search and wellbeing logic for Dhikr & Du'a.
 *
 * Two modes:
 *  1. Text search  — searchDhikr(query) — weighted across all fields
 *  2. Mood filter  — getDhikrForMood(moodId) — filter + sort by priority_score
 *
 * Ranking weights (from search_config in dhikrData.json):
 *   mood_tags: 10, problem_tags: 8, search_synonyms_sv: 7, intent_tags: 5,
 *   titel: 4, svensk_text: 2, kategori: 1, undersida: 1
 *
 * priority_score from flat_search_index is used as tie-breaker.
 */

import {
  FLAT_SEARCH_INDEX,
  FLAT_INDEX_BY_ID,
  DHIKR_BY_ID,
  WELLBEING_MOODS,
  type DhikrPost,
  type FlatSearchEntry,
} from '../data/dhikrRepository';

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * NFD-decompose + strip combining marks → diacritic-insensitive, lowercase.
 * Preserves character count so matchStart/matchEnd positions are valid.
 */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Search result type ────────────────────────────────────────────────────────

export type DhikrSearchResult = {
  dhikr: DhikrPost;
  score: number;
  matchedField: string; // highest-weight field that matched, for debugging
};

// ── Weighted text search ──────────────────────────────────────────────────────

const WEIGHTS = {
  mood_tags: 10,
  problem_tags: 8,
  search_synonyms_sv: 7,
  intent_tags: 5,
  titel: 4,
  // svensk_text and translitteration searched directly on DhikrPost (not in flat index)
  svensk_text: 2,
  kategori: 1,
  undersida: 1,
  translitteration: 1,
} as const;

function scoreEntry(entry: FlatSearchEntry, q: string): { score: number; matchedField: string } {
  let score = 0;
  let matchedField = '';

  const check = (
    value: string | string[],
    weight: number,
    field: string,
  ) => {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (normalizeText(v).includes(q)) {
        score += weight;
        if (!matchedField) matchedField = field;
        break;
      }
    }
  };

  check(entry.mood_tags,           WEIGHTS.mood_tags,           'mood_tags');
  check(entry.problem_tags,        WEIGHTS.problem_tags,        'problem_tags');
  check(entry.search_synonyms_sv,  WEIGHTS.search_synonyms_sv,  'search_synonyms_sv');
  check(entry.intent_tags,         WEIGHTS.intent_tags,         'intent_tags');
  check(entry.titel,               WEIGHTS.titel,               'titel');
  check(entry.kategori,            WEIGHTS.kategori,            'kategori');
  check(entry.undersida,           WEIGHTS.undersida,           'undersida');

  // Swedish text and translitteration — via DhikrPost (not in flat index)
  const post = DHIKR_BY_ID.get(entry.id);
  if (post) {
    if (normalizeText(post.svensk_text || '').includes(q)) {
      score += WEIGHTS.svensk_text;
      if (!matchedField) matchedField = 'svensk_text';
    }
    if (normalizeText(post.translitteration || '').includes(q)) {
      score += WEIGHTS.translitteration;
      if (!matchedField) matchedField = 'translitteration';
    }
  }

  return { score, matchedField };
}

export function searchDhikr(query: string, maxResults = 60): DhikrSearchResult[] {
  const q = normalizeText(query);
  if (!q || q.length < 2) return [];

  const results: DhikrSearchResult[] = [];
  const seen = new Set<string>();

  for (const entry of FLAT_SEARCH_INDEX) {
    const { score, matchedField } = scoreEntry(entry, q);
    if (score === 0) continue;

    const dhikr = DHIKR_BY_ID.get(entry.id);
    if (!dhikr) continue;

    const key = dhikr._wellbeing?.id || dhikr.url || dhikr.titel;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      dhikr,
      score: score + entry.priority_score / 1000,
      matchedField,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ── Mood-based filtering ──────────────────────────────────────────────────────

const MOOD_SUPPLEMENTARY_INTENTS: Record<string, string[]> = {
  stressad:  ['sabr', 'trost', 'tawakkul'],
  angerfull: ['sabr', 'trost'],
  nedstamd:  ['trost', 'hopp'],
  angslig:   ['skydd', 'trygghet'],
};

export function getDhikrForMood(moodId: string, maxResults = 40): DhikrSearchResult[] {
  const mood = WELLBEING_MOODS.find((m) => m.id === moodId);
  const moodIntents = new Set(mood?.intent_tags ?? []);
  const suppIntents = new Set(MOOD_SUPPLEMENTARY_INTENTS[moodId] ?? []);
  for (const tag of moodIntents) suppIntents.delete(tag);

  const results: DhikrSearchResult[] = [];
  const seen = new Set<string>();

  for (const entry of FLAT_SEARCH_INDEX) {
    const hasMoodTag     = entry.mood_tags.includes(moodId);
    const hasIntentMatch = moodIntents.size > 0 && entry.intent_tags.some((t) => moodIntents.has(t));
    const hasSuppMatch   = suppIntents.size > 0 && entry.intent_tags.some((t) => suppIntents.has(t));

    if (!hasMoodTag && !hasIntentMatch && !hasSuppMatch) continue;

    const dhikr = DHIKR_BY_ID.get(entry.id);
    if (!dhikr) continue;

    const key = dhikr._wellbeing?.id || dhikr.url || dhikr.titel;
    if (seen.has(key)) continue;
    seen.add(key);

    let score: number;
    let matchedField: string;
    if (hasMoodTag) {
      score = entry.priority_score * 2;
      matchedField = 'mood_tags';
    } else if (hasIntentMatch) {
      score = entry.priority_score;
      matchedField = 'intent_tags';
    } else {
      score = entry.priority_score * 0.6;
      matchedField = 'intent_tags_supplementary';
    }

    results.push({ dhikr, score, matchedField });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ── Problem-based filtering ───────────────────────────────────────────────────

export function getDhikrForProblem(problemTag: string, maxResults = 40): DhikrSearchResult[] {
  const results: DhikrSearchResult[] = [];
  const seen = new Set<string>();

  for (const entry of FLAT_SEARCH_INDEX) {
    if (!entry.problem_tags.includes(problemTag)) continue;
    const dhikr = DHIKR_BY_ID.get(entry.id);
    if (!dhikr) continue;
    const key = dhikr._wellbeing?.id || dhikr.url || dhikr.titel;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ dhikr, score: entry.priority_score, matchedField: 'problem_tags' });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ── Recommendation-first mood results ─────────────────────────────────────────

/**
 * Returns curated recommendations for a mood if `recommended_item_ids` is
 * populated on the mood definition, otherwise falls back to getDhikrForMood.
 */
export function getRecommendedDhikrForMood(moodId: string, maxResults = 12): DhikrSearchResult[] {
  const mood = WELLBEING_MOODS.find((item) => item.id === moodId);
  if (!mood || !mood.recommended_item_ids.length) {
    return getDhikrForMood(moodId, maxResults);
  }

  const results: DhikrSearchResult[] = [];
  for (const [index, id] of mood.recommended_item_ids.entries()) {
    const entry = FLAT_INDEX_BY_ID.get(id);
    const dhikr = DHIKR_BY_ID.get(id);
    if (!entry || !dhikr) continue;

    results.push({
      dhikr,
      score: entry.priority_score + (mood.recommended_item_ids.length - index) / 100,
      matchedField: 'recommended_item_ids',
    });
  }

  return results.slice(0, maxResults);
}

// ── Dev diagnostics ───────────────────────────────────────────────────────────

export function getMoodCoverageDiagnostics() {
  return WELLBEING_MOODS.map((mood) => {
    const direct = FLAT_SEARCH_INDEX.filter((entry) => entry.mood_tags.includes(mood.id)).length;
    const recommended = mood.recommended_item_ids.length;
    const fetched = getDhikrForMood(mood.id, 20).length;
    return {
      moodId: mood.id,
      label: mood.label,
      directMoodTagMatches: direct,
      curatedRecommendations: recommended,
      fetchedResults: fetched,
    };
  });
}
