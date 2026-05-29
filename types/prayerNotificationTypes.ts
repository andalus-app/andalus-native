/**
 * Per-prayer notification mode configuration.
 *
 * Each of the five daily prayers has its own independent mode and (optionally)
 * a reciter for the adhan mode. Defaults are all `standard` with `reciter = null`
 * — `silent`, `vibration` and `adhan_short` are never default; the user must
 * opt in to them per prayer.
 *
 * Owned by:
 *   storage/prayerNotificationPreferences.ts  (persistence)
 *   services/prayerNotificationModes.ts        (metadata + cycle order)
 *   services/adhanAudioService.ts              (local mp3 playback — settings preview only)
 *   services/notifications.ts                  (scheduler integration)
 *
 * iOS adhan note:
 * Adhan is delivered as a **bundled iOS notification sound** (CAF in
 * `ios/Hidayah/Sounds/`) so it plays even when the app is killed or the device
 * is locked. iOS caps notification sounds at 30 seconds, which is why the old
 * `adhan_full` mode (~2–3 minute clip) has been removed — there is no reliable
 * way to play a multi-minute clip from a notification on iOS without Critical
 * Alerts entitlement.
 */

export type PrayerKey = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';

export const PRAYER_KEYS: readonly PrayerKey[] = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

export type PrayerNotificationMode =
  | 'silent'
  | 'vibration'
  | 'standard'
  | 'adhan_short';

export const PRAYER_NOTIFICATION_MODES: readonly PrayerNotificationMode[] = [
  'silent',
  'vibration',
  'standard',
  'adhan_short',
];

/** Cycle order when the user taps the mode icon on a prayer row.
 *  Starts at `standard` (the default), goes quieter → quieter → louder. */
export const PRAYER_NOTIFICATION_MODE_CYCLE: readonly PrayerNotificationMode[] = [
  'standard',
  'vibration',
  'silent',
  'adhan_short',
];

export type AdhanReciter = 'medina' | 'mecca' | 'egyptian' | 'turkish';

export const ADHAN_RECITERS: readonly AdhanReciter[] = ['medina', 'mecca', 'egyptian', 'turkish'];

export const DEFAULT_ADHAN_RECITER: AdhanReciter = 'medina';

export type PerPrayerNotificationConfig = {
  mode: PrayerNotificationMode;
  /** Only meaningful for adhan_short. `null` for the other modes. */
  reciter: AdhanReciter | null;
};

export type PrayerNotificationModes = Record<PrayerKey, PerPrayerNotificationConfig>;

/** True when the mode needs an adhan audio file to be played. */
export function isAdhanMode(mode: PrayerNotificationMode): boolean {
  return mode === 'adhan_short';
}

/** Returns the bundled iOS notification sound filename for a (mode, reciter)
 *  pair, or `null` when the mode does not use a custom adhan sound.
 *
 *  Filenames match the CAF resources bundled in `ios/Hidayah/Sounds/` — keep
 *  in sync with the project.pbxproj resource entries. */
export function adhanSoundFileForMode(
  mode: PrayerNotificationMode,
  reciter: AdhanReciter | null,
): string | null {
  if (mode !== 'adhan_short') return null;
  const r = reciter ?? DEFAULT_ADHAN_RECITER;
  return `${r}_short.caf`;
}
