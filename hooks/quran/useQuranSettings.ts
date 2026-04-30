import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_RECITER_ID } from '../../services/quranAudioService';
import { DEFAULT_TRANSLATION_ID, LOCAL_BERNSTROM_ID } from '../../services/quranTranslationService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReadingMode = 'page' | 'verse';

export type QuranSettings = {
  reciterId: number;
  translationId: number | null;      // null = translation off
  fontScale: number;                 // Arabic font scale, verse-by-verse only, 0.8–2.0
  translationFontScale: number;      // Translation font scale, verse-by-verse only, 0.8–2.0
  autoScrollToAudio: boolean;
  readingMode: ReadingMode;          // 'page' = Mushaf, 'verse' = verse-by-verse
};

const DEFAULT_SETTINGS: QuranSettings = {
  reciterId: DEFAULT_RECITER_ID,
  translationId: DEFAULT_TRANSLATION_ID,
  fontScale: 1.0,
  translationFontScale: 1.0,
  autoScrollToAudio: true,
  readingMode: 'page',
};

// Do not change this key — it may be in use on devices.
const STORAGE_KEY = 'andalus_quran_settings';

// ── Hook ──────────────────────────────────────────────────────────────────────

// overrideReadingMode: when provided, forces readingMode for this session only.
// The override is applied in-memory after AsyncStorage load but is NOT persisted,
// so the user's stored preference is untouched for future normal launches.
export function useQuranSettings(overrideReadingMode?: ReadingMode) {
  const [settings, setSettings] = useState<QuranSettings>(
    overrideReadingMode
      ? { ...DEFAULT_SETTINGS, readingMode: overrideReadingMode }
      : DEFAULT_SETTINGS,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!mountedRef.current || !raw) return;
        try {
          const parsed = JSON.parse(raw) as Partial<QuranSettings>;
          // Migration: reset stale translationId values to the new local default.
          //   203 — was the wrong API ID for Bernström (never worked).
          //   48  — was the correct online API ID; replaced by the bundled offline
          //         translation (LOCAL_BERNSTROM_ID = -1).
          // Also drop translationId from pre-readingMode saves so the new default applies.
          let needsWrite = false;
          if (
            parsed.readingMode === undefined ||
            parsed.translationId === 203 ||
            parsed.translationId === 48
          ) {
            delete parsed.translationId;
            needsWrite = true;
          }
          const merged = { ...DEFAULT_SETTINGS, ...parsed };
          // Apply session override after merge — do NOT write back so the user's
          // stored readingMode preference is preserved for future normal launches.
          if (overrideReadingMode) {
            merged.readingMode = overrideReadingMode;
          }
          // Write back if migration ran so future launches skip re-migration.
          if (needsWrite) {
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged)).catch(() => undefined);
          }
          if (mountedRef.current) setSettings(merged);
        } catch {
          // Corrupt storage — use defaults
        }
      })
      .catch(() => undefined);

    return () => { mountedRef.current = false; };
  }, []);

  const updateSettings = useCallback((partial: Partial<QuranSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  // Session-only reading mode change — updates in-memory state but does NOT
  // persist to AsyncStorage. Used for one-shot verse-mode switches (deep-link
  // from Asmaul Husna, in-Quran search results) so the user's stored default
  // is preserved for the next Quran session.
  //
  // Why: previously these flows called updateSettings({ readingMode: 'verse' })
  // which persisted 'verse' to AsyncStorage. The next time the user opened the
  // Quran tab manually, settings loaded with readingMode='verse', and tapping
  // a multi-surah page (e.g. 604: Al-Ikhlas / Al-Falaq / An-Nas) rendered three
  // heavy SurahHeaderCards (each with the 60-clip 178-group knut SVG) plus all
  // verse cards synchronously, blocking the JS thread for ~10s.
  const setReadingModeSession = useCallback((mode: ReadingMode) => {
    setSettings((prev) => (prev.readingMode === mode ? prev : { ...prev, readingMode: mode }));
  }, []);

  return { settings, updateSettings, setReadingModeSession };
}
