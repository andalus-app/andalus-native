/**
 * services/dailyWidgetContent.ts
 *
 * Builds today's daily widget payload (Allah name + Quran verse) for the
 * App Group cache read by HidayahAllahNameWidget and HidayahDailyVerseWidget.
 *
 * Uses the same deterministic algorithms as:
 *   - notifications.ts  (Allah name rotation, epoch 2025-01-01 UTC)
 *   - dailyReminder.ts  (Quran verse rotation, epoch 2024-01-01 UTC)
 *
 * So the widget always shows the same content as the rest of the app.
 * Call getDailyWidgetPayload() on every app open and pass the result to
 * updateDailyContent() from modules/WidgetData.
 */

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
  };
  hadith: {
    hadith_nr: number;
    arabic:    string;
    swedish:   string;
    source:    string;
  };
}

export function getDailyWidgetPayload(): DailyWidgetPayload {
  const idx    = todayAllahNameIndex();
  const name   = ALLAH_NAMES_DATA[idx];
  const verse  = getDailyQuranVerse(new Date());
  const hadith = getDailyHadith(new Date());

  return {
    date:      new Date().toISOString().slice(0, 10),
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
    },
    hadith: {
      hadith_nr: hadith.hadithNr,
      arabic:    hadith.arabiska,
      swedish:   hadith.svenska,
      source:    hadith.kalla,
    },
  };
}
