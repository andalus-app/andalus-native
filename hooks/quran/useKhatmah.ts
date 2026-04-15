/**
 * useKhatmah.ts
 *
 * State management and persistence for the Khatmah (Quran completion) feature.
 * Stores plan, progress, and reminder settings in AsyncStorage.
 * Schedules/cancels daily local notifications for the reading reminder.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SURAH_INDEX, JUZ_INDEX, RUB_INDEX } from '../../data/surahIndex';

// Lazy-load expo-notifications — degrades gracefully if native module missing.
let N: typeof import('expo-notifications') | null = null;
try { N = require('expo-notifications'); } catch { N = null; }

const STORAGE_KEY = 'andalus_khatmah_v1';
const NOTIF_ID    = 'khatmah-daily-reminder';

// ── Module-level shared store ─────────────────────────────────────────────────
//
// All useKhatmah() instances share the same in-memory khatmah state.
// When any instance writes to AsyncStorage, it calls _notify() which pushes
// the new data to every mounted instance — so KhatmahScreen and
// KhatmahQuickComplete (and any future consumer) are always in sync.

type _Listener = (data: KhatmahData | null) => void;

const _store = {
  data:      null as KhatmahData | null,
  loaded:    false,
  listeners: new Set<_Listener>(),
};

function _notify(data: KhatmahData | null) {
  _store.data   = data;
  _store.loaded = true;
  _store.listeners.forEach((fn) => fn(data));
}

// ── Verse offset table (module-level, computed once) ─────────────────────────

const CUMULATIVE_VERSES: number[] = [];
let _accV = 0;
for (const s of SURAH_INDEX) {
  CUMULATIVE_VERSES.push(_accV);
  _accV += s.versesCount;
}
export const TOTAL_QURAN_VERSES = _accV; // 6236

export function verseToGlobal(surahId: number, ayah: number): number {
  return CUMULATIVE_VERSES[surahId - 1] + ayah - 1;
}

export function globalToVerse(idx: number): { surahId: number; ayah: number } {
  let lo = 0;
  let hi = SURAH_INDEX.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (CUMULATIVE_VERSES[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return { surahId: SURAH_INDEX[lo].id, ayah: idx - CUMULATIVE_VERSES[lo] + 1 };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type DayRange = {
  dayNumber:    number;
  startSurahId: number;
  startAyah:    number;
  endSurahId:   number;
  endAyah:      number;
  /** Mushaf page where reading starts (exact for juz-aligned plans, estimated otherwise). */
  startPage:    number;
  /** Mushaf page where reading ends (exact for juz-aligned plans, estimated otherwise). */
  endPage:      number;
  completed:    boolean;
};

export type KhatmahData = {
  planId:          string;
  totalDays:       number;
  /** 1-indexed. When currentDay > totalDays the khatmah is finished. */
  currentDay:      number;
  dayRanges:       DayRange[];
  startSurahId:    number;
  startAyah:       number;
  reminderEnabled: boolean;
  reminderHour:    number;
  reminderMinute:  number;
};

export type KhatmahPlan = {
  id:          string;
  days:        number;
  label:       string;
  dailyLabel:  string;
  recommended: boolean;
};

// ── Plan catalogue ────────────────────────────────────────────────────────────

export const KHATMAH_PLANS: KhatmahPlan[] = [
  { id: '240', days: 240, label: '240-dagars Khatmah', dailyLabel: '1 rub\' per dag',     recommended: false },
  { id: '120', days: 120, label: '120-dagars Khatmah', dailyLabel: '2 rub\' per dag',     recommended: false },
  { id: '80',  days: 80,  label: '80-dagars Khatmah',  dailyLabel: '3 rub\' per dag',     recommended: false },
  { id: '60',  days: 60,  label: '60-dagars Khatmah',  dailyLabel: '1 hizb per dag',      recommended: false },
  { id: '40',  days: 40,  label: '40-dagars Khatmah',  dailyLabel: '1½ hizb per dag',     recommended: false },
  { id: '30',  days: 30,  label: '30-dagars Khatmah',  dailyLabel: '1 juz per dag',       recommended: true  },
  { id: '29',  days: 29,  label: '29-dagars Khatmah',  dailyLabel: '~21 sidor per dag',   recommended: true  },
  { id: '20',  days: 20,  label: '20-dagars Khatmah',  dailyLabel: '3 hizb per dag',      recommended: false },
  { id: '15',  days: 15,  label: '15-dagars Khatmah',  dailyLabel: '2 juz per dag',       recommended: false },
  { id: '10',  days: 10,  label: '10-dagars Khatmah',  dailyLabel: '3 juz per dag',       recommended: false },
  { id: '7',   days: 7,   label: '7-dagars Khatmah',   dailyLabel: 'cirka 4 juz per dag', recommended: false },
  { id: '6',   days: 6,   label: '6-dagars Khatmah',   dailyLabel: '5 juz per dag',       recommended: false },
  { id: '5',   days: 5,   label: '5-dagars Khatmah',   dailyLabel: '6 juz per dag',       recommended: false },
  { id: '3',   days: 3,   label: '3-dagars Khatmah',   dailyLabel: '10 juz per dag',      recommended: false },
];

// ── Plan generation ───────────────────────────────────────────────────────────

/** First Mushaf page of a surah (exact from SURAH_INDEX). */
function surahFirstPage(surahId: number): number {
  return SURAH_INDEX.find((s) => s.id === surahId)?.firstPage ?? 1;
}

/**
 * Estimated last page of a surah.
 * Uses the next surah's firstPage - 1 as the upper bound. For surah 114, returns 604.
 */
function surahLastPage(surahId: number): number {
  const next = SURAH_INDEX.find((s) => s.id === surahId + 1);
  return next ? next.firstPage - 1 : 604;
}

/**
 * Generates day ranges using exact Juz boundaries from JUZ_INDEX.
 * Only valid when totalDays divides 30 evenly (30, 15, 10, 6, 5, 3)
 * and the khatmah starts from surah 1:1.
 */
export function generateJuzGroupedDayRanges(totalDays: number): DayRange[] {
  const juzPerDay = 30 / totalDays;
  const ranges: DayRange[] = [];

  for (let d = 0; d < totalDays; d++) {
    const firstJuzIdx = d * juzPerDay;          // 0-indexed in JUZ_INDEX array
    const lastJuzIdx  = firstJuzIdx + juzPerDay - 1;

    const startJuz = JUZ_INDEX[firstJuzIdx];

    const startSurahId = startJuz.surahId;
    const startAyah    = startJuz.verseNumber;
    const startPage    = startJuz.firstPage;

    // End verse = last verse before the next juz begins
    const nextJuzIdx = lastJuzIdx + 1;
    let endSurahId: number;
    let endAyah:    number;
    let endPage:    number;

    if (nextJuzIdx < JUZ_INDEX.length) {
      const nextJuz = JUZ_INDEX[nextJuzIdx];
      endPage = nextJuz.firstPage - 1;
      if (nextJuz.verseNumber === 1) {
        // The next juz begins at verse 1 of its surah → end is last verse of previous surah
        const prevSurah = SURAH_INDEX.find((s) => s.id === nextJuz.surahId - 1)!;
        endSurahId = prevSurah.id;
        endAyah    = prevSurah.versesCount;
      } else {
        endSurahId = nextJuz.surahId;
        endAyah    = nextJuz.verseNumber - 1;
      }
    } else {
      // Last juz ends at the final verse of the Quran
      endSurahId = 114;
      endAyah    = 6;
      endPage    = 604;
    }

    ranges.push({
      dayNumber: d + 1,
      startSurahId, startAyah, startPage,
      endSurahId,   endAyah,   endPage,
      completed: false,
    });
  }

  return ranges;
}

/**
 * Generates day ranges using exact Rub' el Hizb boundaries from RUB_INDEX.
 * Valid when 240 % totalDays === 0 and the khatmah starts from surah 1:1.
 * Each day covers (240 / totalDays) rubs.
 *
 * Plans: 240 (1 rub/day), 120 (2), 80 (3), 60 (4 = 1 hizb), 40 (6 = 1½ hizb), 20 (12 = 3 hizb).
 */
export function generateRubGroupedDayRanges(totalDays: number): DayRange[] {
  const rubsPerDay = 240 / totalDays;
  const ranges: DayRange[] = [];

  for (let d = 0; d < totalDays; d++) {
    const firstRubIdx = d * rubsPerDay;
    const lastRubIdx  = firstRubIdx + rubsPerDay - 1;

    const startRub    = RUB_INDEX[firstRubIdx];
    const startSurahId = startRub.surahId;
    const startAyah   = startRub.verseNumber;
    const startPage   = startRub.firstPage;

    const nextRubIdx = lastRubIdx + 1;
    let endSurahId: number;
    let endAyah:    number;
    let endPage:    number;

    if (nextRubIdx < RUB_INDEX.length) {
      const nextRub = RUB_INDEX[nextRubIdx];
      endPage = nextRub.firstPage - 1;
      if (nextRub.verseNumber === 1) {
        // Next rub starts at verse 1 of its surah → end is last verse of previous surah
        const prevSurah = SURAH_INDEX.find((s) => s.id === nextRub.surahId - 1)!;
        endSurahId = prevSurah.id;
        endAyah    = prevSurah.versesCount;
      } else {
        endSurahId = nextRub.surahId;
        endAyah    = nextRub.verseNumber - 1;
      }
    } else {
      // Last rub ends at the final verse of the Quran
      endSurahId = 114;
      endAyah    = 6;
      endPage    = 604;
    }

    ranges.push({
      dayNumber: d + 1,
      startSurahId, startAyah, startPage,
      endSurahId,   endAyah,   endPage,
      completed: false,
    });
  }

  return ranges;
}

// ── Page-based plan helpers ───────────────────────────────────────────────────

/**
 * Returns an estimate of the first verse on the given Mushaf page.
 *
 * Strategy:
 *  1. Exact Juz boundary (JUZ_INDEX.firstPage === page) → use juz start verse.
 *  2. Surah boundary (SURAH_INDEX.firstPage === page)   → use surah:1.
 *  3. Otherwise → linearly interpolate the verse offset within the active juz
 *     span (uniform distribution across the juz's page range).
 *
 * Accuracy: within ~3 verses of the true first verse on the page; corrected
 * at navigation time by fetchVersePage in useResolvedStartPage/EndPage.
 */
function firstVerseOnPage(page: number): { surahId: number; ayah: number } {
  if (page <= 1) return { surahId: 1, ayah: 1 };
  if (page >= 604) return { surahId: 114, ayah: 1 };

  // 1. Exact juz boundary
  const exactJuz = JUZ_INDEX.find((j) => j.firstPage === page);
  if (exactJuz) return { surahId: exactJuz.surahId, ayah: exactJuz.verseNumber };

  // 2. Surah boundary
  const exactSurah = SURAH_INDEX.find((s) => s.firstPage === page);
  if (exactSurah) return { surahId: exactSurah.id, ayah: 1 };

  // 3. Interpolate within the active juz
  const juzIdx = JUZ_INDEX.findIndex((j) => j.firstPage > page) - 1;
  const currJuz = JUZ_INDEX[Math.max(0, juzIdx)];
  const nextJuz = JUZ_INDEX[juzIdx + 1] ?? null;

  const juzStartPage = currJuz.firstPage;
  const juzEndPage   = nextJuz ? nextJuz.firstPage - 1 : 604;
  const juzPageSpan  = juzEndPage - juzStartPage + 1;

  const juzStartGlobal = verseToGlobal(currJuz.surahId, currJuz.verseNumber);

  let juzEndGlobal: number;
  if (nextJuz) {
    if (nextJuz.verseNumber === 1) {
      const prevSurah = SURAH_INDEX.find((s) => s.id === nextJuz.surahId - 1)!;
      juzEndGlobal = verseToGlobal(prevSurah.id, prevSurah.versesCount);
    } else {
      juzEndGlobal = verseToGlobal(nextJuz.surahId, nextJuz.verseNumber - 1);
    }
  } else {
    juzEndGlobal = verseToGlobal(114, 6);
  }

  const juzVerseSpan = juzEndGlobal - juzStartGlobal + 1;
  const pagesIntoJuz = page - juzStartPage;
  const verseOffset  = Math.round((pagesIntoJuz * juzVerseSpan) / juzPageSpan);
  const targetGlobal = Math.min(juzStartGlobal + verseOffset, juzEndGlobal);

  return globalToVerse(targetGlobal);
}

/** Returns an estimate of the last verse on the given Mushaf page. */
function lastVerseOnPage(page: number): { surahId: number; ayah: number } {
  if (page >= 604) return { surahId: 114, ayah: 6 };
  const next       = firstVerseOnPage(page + 1);
  const nextGlobal = verseToGlobal(next.surahId, next.ayah);
  if (nextGlobal === 0) return { surahId: 1, ayah: 1 };
  return globalToVerse(nextGlobal - 1);
}

/**
 * Divides the Mushaf's 604 pages evenly across totalDays and maps each
 * page boundary to the nearest verse using firstVerseOnPage / lastVerseOnPage.
 *
 * Distribution: base = ⌊604/totalDays⌋ pages, first (604 % totalDays) days
 * get one extra page so the total is always exactly 604.
 *
 * Used for the 29-day plan (≈ 20–21 pages/day) where juz boundaries don't align.
 */
export function generatePageBasedDayRanges(totalDays: number): DayRange[] {
  const TOTAL_PAGES = 604;
  const base        = Math.floor(TOTAL_PAGES / totalDays);
  const extra       = TOTAL_PAGES % totalDays;
  const ranges: DayRange[] = [];
  let startPage = 1;

  for (let d = 0; d < totalDays; d++) {
    const pagesThisDay = base + (d < extra ? 1 : 0);
    const endPage      = startPage + pagesThisDay - 1;

    const startVerse = firstVerseOnPage(startPage);
    const endVerse   = lastVerseOnPage(endPage);

    ranges.push({
      dayNumber:    d + 1,
      startSurahId: startVerse.surahId,
      startAyah:    startVerse.ayah,
      startPage,
      endSurahId:   endVerse.surahId,
      endAyah:      endVerse.ayah,
      endPage,
      completed:    false,
    });

    startPage = endPage + 1;
  }

  return ranges;
}

/**
 * Distributes all remaining verses from startSurahId:startAyah evenly across
 * totalDays days. The last few days may have one extra verse to cover the remainder.
 * Page numbers are estimated from SURAH_INDEX.firstPage.
 */
export function generateDayRanges(
  totalDays:    number,
  startSurahId: number,
  startAyah:    number,
): DayRange[] {
  const startIdx  = verseToGlobal(startSurahId, startAyah);
  const remaining = TOTAL_QURAN_VERSES - startIdx;
  const base      = Math.floor(remaining / totalDays);
  const extra     = remaining % totalDays;

  const ranges: DayRange[] = [];
  let cursor = startIdx;

  for (let d = 0; d < totalDays; d++) {
    if (cursor >= TOTAL_QURAN_VERSES) break;
    const count  = base + (d < extra ? 1 : 0);
    const endIdx = Math.min(cursor + count - 1, TOTAL_QURAN_VERSES - 1);
    const sv = globalToVerse(cursor);
    const ev = globalToVerse(endIdx);
    ranges.push({
      dayNumber:    d + 1,
      startSurahId: sv.surahId, startAyah: sv.ayah,
      startPage:    surahFirstPage(sv.surahId),
      endSurahId:   ev.surahId, endAyah:   ev.ayah,
      endPage:      surahLastPage(ev.surahId),
      completed: false,
    });
    cursor = endIdx + 1;
  }
  return ranges;
}

// ── Notification helpers ──────────────────────────────────────────────────────

async function scheduleKhatmahReminder(hour: number, minute: number): Promise<void> {
  if (!N) return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') await N.requestPermissionsAsync();
    await N.cancelScheduledNotificationAsync(NOTIF_ID).catch(() => {});
    await N.scheduleNotificationAsync({
      identifier: NOTIF_ID,
      content: {
        title: 'Khatmah-påminnelse',
        body: 'Dags att fortsätta din läsning i Koranen.',
        sound: true,
        data: { screen: 'quran_khatmah' },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trigger: { type: (N.SchedulableTriggerInputTypes as any).DAILY, hour, minute } as any,
    });
  } catch {}
}

async function cancelKhatmahReminder(): Promise<void> {
  if (!N) return;
  try { await N.cancelScheduledNotificationAsync(NOTIF_ID).catch(() => {}); } catch {}
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export type UseKhatmahResult = {
  khatmah:              KhatmahData | null;
  loading:              boolean;
  isCompleted:          boolean;
  createKhatmah:        (planId: string, totalDays: number, startSurahId: number, startAyah: number) => Promise<void>;
  markCurrentDayComplete: () => Promise<void>;
  repeatKhatmah:        () => Promise<void>;
  deleteKhatmah:        () => Promise<void>;
  setReminder:          (enabled: boolean, hour: number, minute: number) => Promise<void>;
};

export function useKhatmah(): UseKhatmahResult {
  const [khatmah, setKhatmah] = useState<KhatmahData | null>(
    // If another instance already loaded the store, use it immediately (no flash)
    _store.loaded ? _store.data : null,
  );
  const [loading, setLoading] = useState(!_store.loaded);
  const mountedRef            = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Subscribe: receive updates from any other useKhatmah() instance
    const listener: _Listener = (data) => {
      if (mountedRef.current) setKhatmah(data);
    };
    _store.listeners.add(listener);

    return () => {
      mountedRef.current = false;
      _store.listeners.delete(listener);
    };
  }, []);

  // Load from storage on mount (only when the store hasn't been populated yet)
  useEffect(() => {
    if (_store.loaded) return; // another instance already loaded — nothing to do

    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      let parsed: KhatmahData | null = null;
      if (raw) {
        try {
          const data = JSON.parse(raw) as KhatmahData;
          // Migrate: if day ranges are missing page info, regenerate them
          const needsMigration = data.dayRanges.length > 0 &&
            (data.dayRanges[0].startPage === undefined || data.dayRanges[0].endPage === undefined);
          if (needsMigration) {
            const isJuzAligned  =
              30 % data.totalDays === 0 && data.startSurahId === 1 && data.startAyah === 1;
            const isRubAligned  =
              !isJuzAligned && 240 % data.totalDays === 0 && data.startSurahId === 1 && data.startAyah === 1;
            const isPageAligned = data.totalDays === 29 && data.startSurahId === 1 && data.startAyah === 1;
            const dayRanges = isJuzAligned
              ? generateJuzGroupedDayRanges(data.totalDays)
              : isRubAligned
              ? generateRubGroupedDayRanges(data.totalDays)
              : isPageAligned
              ? generatePageBasedDayRanges(data.totalDays)
              : generateDayRanges(data.totalDays, data.startSurahId, data.startAyah);
            // Preserve completed flags from old ranges
            const merged = dayRanges.map((r) => {
              const old = data.dayRanges.find((o) => o.dayNumber === r.dayNumber);
              return old ? { ...r, completed: old.completed } : r;
            });
            parsed = { ...data, dayRanges: merged };
            // Persist migrated data
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)).catch(() => {});
          } else {
            parsed = data;
          }
        } catch {}
      }
      // Notify all mounted instances (including this one via the listener)
      _notify(parsed);
      if (mountedRef.current) setLoading(false);

      // One-time migration: re-schedule the daily reminder so it gains the
      // new data: { screen: 'quran_khatmah' } deep-link payload.
      // Uses a migration key so this only runs once per device, not every launch.
      if (parsed?.reminderEnabled) {
        AsyncStorage.getItem('andalus_khatmah_notif_v2').then((migrated) => {
          if (!migrated) {
            scheduleKhatmahReminder(parsed.reminderHour, parsed.reminderMinute)
              .then(() => AsyncStorage.setItem('andalus_khatmah_notif_v2', '1'))
              .catch(() => {});
          }
        }).catch(() => {});
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(async (data: KhatmahData | null) => {
    // Write to AsyncStorage and broadcast to all mounted instances
    if (data) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    else       await AsyncStorage.removeItem(STORAGE_KEY);
    _notify(data);
  }, []);

  const createKhatmah = useCallback(async (
    planId:       string,
    totalDays:    number,
    startSurahId: number,
    startAyah:    number,
  ) => {
    const isJuzAligned  = 30 % totalDays === 0 && startSurahId === 1 && startAyah === 1;
    const isRubAligned  = !isJuzAligned && 240 % totalDays === 0 && startSurahId === 1 && startAyah === 1;
    const isPageAligned = totalDays === 29 && startSurahId === 1 && startAyah === 1;
    const dayRanges = isJuzAligned
      ? generateJuzGroupedDayRanges(totalDays)
      : isRubAligned
      ? generateRubGroupedDayRanges(totalDays)
      : isPageAligned
      ? generatePageBasedDayRanges(totalDays)
      : generateDayRanges(totalDays, startSurahId, startAyah);
    const data: KhatmahData = {
      planId, totalDays,
      currentDay: 1,
      dayRanges,
      startSurahId, startAyah,
      reminderEnabled: false,
      reminderHour: 19,
      reminderMinute: 0,
    };
    if (mountedRef.current) setKhatmah(data);
    await persist(data);
  }, [persist]);

  const markCurrentDayComplete = useCallback(async () => {
    setKhatmah((prev) => {
      if (!prev) return prev;
      const updatedRanges = prev.dayRanges.map((r) =>
        r.dayNumber === prev.currentDay ? { ...r, completed: true } : r,
      );
      const updated: KhatmahData = {
        ...prev,
        dayRanges: updatedRanges,
        currentDay: prev.currentDay + 1,
      };
      persist(updated);
      return updated;
    });
  }, [persist]);

  const repeatKhatmah = useCallback(async () => {
    setKhatmah((prev) => {
      if (!prev) return prev;
      const isJuzAligned  =
        30 % prev.totalDays === 0 && prev.startSurahId === 1 && prev.startAyah === 1;
      const isRubAligned  =
        !isJuzAligned && 240 % prev.totalDays === 0 && prev.startSurahId === 1 && prev.startAyah === 1;
      const isPageAligned = prev.totalDays === 29 && prev.startSurahId === 1 && prev.startAyah === 1;
      const dayRanges = isJuzAligned
        ? generateJuzGroupedDayRanges(prev.totalDays)
        : isRubAligned
        ? generateRubGroupedDayRanges(prev.totalDays)
        : isPageAligned
        ? generatePageBasedDayRanges(prev.totalDays)
        : generateDayRanges(prev.totalDays, prev.startSurahId, prev.startAyah);
      const updated: KhatmahData = { ...prev, currentDay: 1, dayRanges };
      persist(updated);
      return updated;
    });
  }, [persist]);

  const deleteKhatmah = useCallback(async () => {
    await cancelKhatmahReminder();
    await AsyncStorage.removeItem(STORAGE_KEY);
    _notify(null); // broadcast to all instances (including this one)
  }, []);

  const setReminder = useCallback(async (
    enabled: boolean,
    hour:    number,
    minute:  number,
  ) => {
    setKhatmah((prev) => {
      if (!prev) return prev;
      const updated: KhatmahData = {
        ...prev,
        reminderEnabled: enabled,
        reminderHour: hour,
        reminderMinute: minute,
      };
      persist(updated);
      return updated;
    });
    if (enabled) await scheduleKhatmahReminder(hour, minute);
    else         await cancelKhatmahReminder();
  }, [persist]);

  const isCompleted = khatmah ? khatmah.currentDay > khatmah.totalDays : false;

  return {
    khatmah,
    loading,
    isCompleted,
    createKhatmah,
    markCurrentDayComplete,
    repeatKhatmah,
    deleteKhatmah,
    setReminder,
  };
}
