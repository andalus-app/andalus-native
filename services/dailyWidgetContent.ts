/**
 * services/dailyWidgetContent.ts
 *
 * Builds today's daily widget payload (Allah name + Quran verse + Hadith) for
 * the App Group cache read by HidayahAllahNameWidget, HidayahDailyVerseWidget,
 * HidayahDailyVerseArabicWidget, and HidayahDailyHadithWidget.
 *
 * Uses the same deterministic algorithms as:
 *   - notifications.ts  (Allah name rotation, epoch 2025-01-01 UTC)
 *   - dailyReminder.ts  (Quran verse rotation, epoch 2024-01-01 UTC)
 *
 * So the widget always shows the same content as the rest of the app.
 * Call getDailyWidgetPayload() on every app open and pass the result to
 * updateDailyContent() from modules/WidgetData.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDailyQuranVerse, getDailyHadith } from './dailyReminder';

// Fixed epoch — must match notifications.ts (do not change)
const ALLAH_EPOCH_MS = new Date('2025-01-01T00:00:00Z').getTime();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ALLAH_NAMES_DATA: {
  nr: number;
  arabic: string;
  transliteration: string;
  swedish: string;
  forklaring: string;
}[] = require('../app/asmaul_husna.json');

function todayAllahNameIndex(): number {
  const daysSinceEpoch = Math.floor((Date.now() - ALLAH_EPOCH_MS) / 86_400_000);
  return ((daysSinceEpoch % ALLAH_NAMES_DATA.length) + ALLAH_NAMES_DATA.length) % ALLAH_NAMES_DATA.length;
}

// ── Arabic verse fetch ──────────────────────────────────────────────────────────

const VERSE_ARABIC_CACHE_PREFIX = 'andalus_daily_verse_arabic_v1_';
const QURAN_API_BASE = 'https://api.quran.com/api/v4';

/**
 * Fetches Uthmani Arabic text for the given verse refs, joining with newlines.
 * Uses a per-date AsyncStorage cache — only one network round-trip per day per ref.
 * Returns empty string on any failure (widget will degrade gracefully).
 */
async function fetchDailyVerseArabic(refs: string[], dateStr: string): Promise<string> {
  const key = `${VERSE_ARABIC_CACHE_PREFIX}${dateStr}`;

  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached !== null) return cached;
  } catch {
    // Cache unreadable — continue to fetch
  }

  try {
    const texts: string[] = [];
    for (const ref of refs) {
      const url = `${QURAN_API_BASE}/verses/by_key/${encodeURIComponent(ref)}?fields=text_uthmani`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!resp.ok) throw new Error(`Arabic verse API ${resp.status}`);
      const json = await resp.json() as { verse?: { text_uthmani?: string } };
      const text = json.verse?.text_uthmani ?? '';
      if (text) texts.push(text);
    }
    const combined = texts.join('\n');
    AsyncStorage.setItem(key, combined).catch(() => undefined);
    return combined;
  } catch {
    return '';
  }
}

// ── Public types & payload builder ─────────────────────────────────────────────

export interface DailyWidgetPayload {
  date:      string;    // "yyyy-MM-dd"
  updatedAt: number;    // Unix seconds
  allahName: {
    nameNr:          number;
    arabic:          string;
    transliteration: string;
    swedish:         string;
    explanation:     string;
  };
  quranVerse: {
    swedish:     string;
    surahName:   string;
    surahNumber: number;
    ayahNumber:  number;
    reference:   string;
    arabic?:     string;
  };
  hadith: {
    hadith_nr: number;
    arabic:    string;
    swedish:   string;
    source:    string;
  };
}

/**
 * Builds and writes a 30-day verse lookup cache to App Group.
 * Called fire-and-forget on every app open alongside getDailyWidgetPayload().
 * Uses the existing per-date AsyncStorage Arabic cache so only new dates
 * require a network round-trip to quran.com.
 */
export async function updateVerse30DayCache(): Promise<void> {
  const { setVerse30DayCache } = await import('../modules/WidgetData');
  const today   = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const verses: Record<string, {
    swedish: string; arabic: string; surahName: string;
    surahNumber: number; ayahNumber: number; reference: string;
  }> = {};

  for (let i = 0; i < 30; i++) {
    const d  = new Date(today);
    d.setDate(d.getDate() + i);
    const ds    = d.toISOString().slice(0, 10);
    const verse = getDailyQuranVerse(d);
    const arabic = await fetchDailyVerseArabic(verse.refs, ds);
    verses[ds] = {
      swedish:     verse.swedish,
      arabic,
      surahName:   verse.surahName,
      surahNumber: verse.surahNumber,
      ayahNumber:  verse.ayahNumber,
      reference:   verse.displayRef,
    };
  }

  await setVerse30DayCache({ version: 1, writtenAt: dateStr, verses });
}

export async function getDailyWidgetPayload(): Promise<DailyWidgetPayload> {
  const idx    = todayAllahNameIndex();
  const name   = ALLAH_NAMES_DATA[idx];
  const verse  = getDailyQuranVerse(new Date());
  const hadith = getDailyHadith(new Date());
  const dateStr = new Date().toISOString().slice(0, 10);

  const arabic = await fetchDailyVerseArabic(verse.refs, dateStr);

  return {
    date:      dateStr,
    updatedAt: Date.now() / 1000,
    allahName: {
      nameNr:          name.nr,
      arabic:          name.arabic,
      transliteration: name.transliteration,
      swedish:         name.swedish,
      explanation:     name.forklaring,
    },
    quranVerse: {
      swedish:     verse.swedish,
      surahName:   verse.surahName,
      surahNumber: verse.surahNumber,
      ayahNumber:  verse.ayahNumber,
      reference:   verse.displayRef,
      arabic:      arabic || undefined,
    },
    hadith: {
      hadith_nr: hadith.hadithNr,
      arabic:    hadith.arabiska,
      swedish:   hadith.svenska,
      source:    hadith.kalla,
    },
  };
}
