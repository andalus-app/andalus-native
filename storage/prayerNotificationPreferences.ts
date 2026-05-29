/**
 * AsyncStorage-backed persistence for the per-prayer notification modes.
 *
 * Layout (one JSON blob under a single key):
 *
 *   {
 *     "Fajr":    { "mode": "standard", "reciter": null },
 *     "Dhuhr":   { "mode": "vibration", "reciter": null },
 *     "Asr":     { "mode": "silent",    "reciter": null },
 *     "Maghrib": { "mode": "standard",  "reciter": null },
 *     "Isha":    { "mode": "adhan_short", "reciter": "medina" }
 *   }
 *
 * Missing keys are filled with the all-standard default. Unknown / corrupt
 * values fall back to the default so a bad write can never block the app.
 *
 * Legacy `adhan_full` is migrated on read to `adhan_short` so users who picked
 * full-adhan before it was retired keep an adhan-mode notification instead of
 * silently reverting to `standard`.
 *
 * A lightweight in-process subscriber list lets the scheduler re-run when
 * the user toggles a mode without having to thread props through React state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_ADHAN_RECITER,
  isAdhanMode,
  PRAYER_KEYS,
  PRAYER_NOTIFICATION_MODES,
  ADHAN_RECITERS,
  type AdhanReciter,
  type PerPrayerNotificationConfig,
  type PrayerKey,
  type PrayerNotificationMode,
  type PrayerNotificationModes,
} from '../types/prayerNotificationTypes';

export const PRAYER_NOTIFICATION_MODES_STORAGE_KEY = 'hidayah_prayer_notification_modes_v1';

const DEFAULT_PER_PRAYER: PerPrayerNotificationConfig = { mode: 'standard', reciter: null };

export const DEFAULT_PRAYER_NOTIFICATION_MODES: PrayerNotificationModes = {
  Fajr:    { ...DEFAULT_PER_PRAYER },
  Dhuhr:   { ...DEFAULT_PER_PRAYER },
  Asr:     { ...DEFAULT_PER_PRAYER },
  Maghrib: { ...DEFAULT_PER_PRAYER },
  Isha:    { ...DEFAULT_PER_PRAYER },
};

let cached: PrayerNotificationModes | null = null;
const listeners = new Set<(modes: PrayerNotificationModes) => void>();

function sanitizeMode(raw: unknown): PrayerNotificationMode {
  // Legacy migration: adhan_full was retired (iOS cannot play >30 s clips from
  // a notification reliably). Treat any persisted adhan_full as adhan_short so
  // the user still gets an adhan-mode notification.
  if (raw === 'adhan_full') return 'adhan_short';
  return (PRAYER_NOTIFICATION_MODES as readonly string[]).includes(raw as string)
    ? raw as PrayerNotificationMode
    : 'standard';
}

function sanitizeReciter(raw: unknown, mode: PrayerNotificationMode): AdhanReciter | null {
  if (!isAdhanMode(mode)) return null;
  if (typeof raw === 'string' && (ADHAN_RECITERS as readonly string[]).includes(raw)) {
    return raw as AdhanReciter;
  }
  return DEFAULT_ADHAN_RECITER;
}

function sanitizeConfig(raw: unknown): PerPrayerNotificationConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PER_PRAYER };
  const r = raw as { mode?: unknown; reciter?: unknown };
  const mode    = sanitizeMode(r.mode);
  const reciter = sanitizeReciter(r.reciter, mode);
  return { mode, reciter };
}

function sanitizeModes(raw: unknown): PrayerNotificationModes {
  const base: PrayerNotificationModes = { ...DEFAULT_PRAYER_NOTIFICATION_MODES };
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Record<PrayerKey, unknown>>;
  for (const key of PRAYER_KEYS) {
    base[key] = sanitizeConfig(r[key]);
  }
  return base;
}

/** Returns the currently cached config without touching disk. Used by the
 *  notification scheduler on the hot path where an extra `await` would slow
 *  the schedule call. Falls back to all-standard until `loadPrayerNotificationModes`
 *  has resolved at least once. */
export function getCachedPrayerNotificationModes(): PrayerNotificationModes {
  return cached ?? { ...DEFAULT_PRAYER_NOTIFICATION_MODES };
}

/** Reads modes from AsyncStorage and caches them in-process. Safe to call
 *  repeatedly — every call refreshes the cache so settings changes made in
 *  another tab/process are visible on the next read. */
export async function loadPrayerNotificationModes(): Promise<PrayerNotificationModes> {
  try {
    const raw = await AsyncStorage.getItem(PRAYER_NOTIFICATION_MODES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cached = sanitizeModes(parsed);
  } catch {
    cached = { ...DEFAULT_PRAYER_NOTIFICATION_MODES };
  }
  return cached;
}

/** Writes the full modes object to disk, updates the in-process cache and
 *  notifies subscribers. */
export async function savePrayerNotificationModes(modes: PrayerNotificationModes): Promise<void> {
  const sanitized = sanitizeModes(modes);
  cached = sanitized;
  try {
    await AsyncStorage.setItem(PRAYER_NOTIFICATION_MODES_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {}
  listeners.forEach(fn => {
    try { fn(sanitized); } catch {}
  });
}

/** Updates a single prayer's mode (and optionally its reciter). When the new
 *  mode is an adhan mode and no reciter is provided, the existing reciter
 *  (or the default) is preserved. */
export async function updatePrayerNotificationMode(
  prayer: PrayerKey,
  mode: PrayerNotificationMode,
  reciter?: AdhanReciter | null,
): Promise<PrayerNotificationModes> {
  const current  = cached ?? await loadPrayerNotificationModes();
  const existing = current[prayer];
  const nextReciter: AdhanReciter | null = isAdhanMode(mode)
    ? (reciter ?? existing.reciter ?? DEFAULT_ADHAN_RECITER)
    : null;
  const next: PrayerNotificationModes = {
    ...current,
    [prayer]: { mode, reciter: nextReciter },
  };
  await savePrayerNotificationModes(next);
  return next;
}

/** Updates only the reciter for an adhan-mode prayer. No-op when the current
 *  mode is not an adhan mode (silent / vibration / standard ignore reciter). */
export async function updatePrayerNotificationReciter(
  prayer: PrayerKey,
  reciter: AdhanReciter,
): Promise<PrayerNotificationModes> {
  const current  = cached ?? await loadPrayerNotificationModes();
  const existing = current[prayer];
  if (!isAdhanMode(existing.mode)) return current;
  const next: PrayerNotificationModes = {
    ...current,
    [prayer]: { mode: existing.mode, reciter },
  };
  await savePrayerNotificationModes(next);
  return next;
}

/** Subscribe to mode changes — returns an unsubscribe function. */
export function subscribePrayerNotificationModes(
  fn: (modes: PrayerNotificationModes) => void,
): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
