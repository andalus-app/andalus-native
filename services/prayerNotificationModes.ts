/**
 * prayerNotificationModes.ts
 *
 * Display metadata (Swedish labels, toast strings, themeable icon XML) plus
 * the cycle-next helper used by the settings UI.
 *
 * The icon XML uses the `__C__` token convention also used by `constants/masjidIcon.ts`
 * and `app/settings.tsx` so it can be tinted to the active accent colour without
 * re-encoding the SVG at render time.
 */

import {
  ADHAN_RECITERS,
  isAdhanMode,
  PRAYER_NOTIFICATION_MODE_CYCLE,
  type AdhanReciter,
  type PrayerKey,
  type PrayerNotificationMode,
} from '../types/prayerNotificationTypes';

// ── Swedish labels ───────────────────────────────────────────────────────────

export const PRAYER_DISPLAY_NAMES: Record<PrayerKey, string> = {
  Fajr:    'Fajr',
  Dhuhr:   'Dhuhr',
  Asr:     'Asr',
  Maghrib: 'Maghrib',
  Isha:    'Isha',
};

export const PRAYER_NOTIFICATION_MODE_LABELS: Record<PrayerNotificationMode, string> = {
  silent:      'Tyst',
  vibration:   'Vibration',
  standard:    'Standard',
  adhan_short: 'Adhan',
};

export const PRAYER_NOTIFICATION_MODE_SUBTITLES: Record<PrayerNotificationMode, string> = {
  silent:      'Endast notifikation',
  vibration:   'Notifikation + vibration',
  standard:    'Standard notifikation',
  adhan_short: 'Adhan',
};

/** Floating-toast strings shown when the user cycles a prayer's mode. */
export const PRAYER_NOTIFICATION_MODE_TOAST: Record<PrayerNotificationMode, string> = {
  silent:      'Endast notifikation',
  vibration:   'Notifikation + vibration',
  standard:    'Standard notifikation',
  adhan_short: 'Adhan vald',
};

export const ADHAN_RECITER_LABELS: Record<AdhanReciter, string> = {
  medina:   'Medina',
  mecca:    'Mecka',
  egyptian: 'Egyptisk',
  turkish:  'Turkisk',
};

export function getAdhanReciterList(): readonly AdhanReciter[] {
  return ADHAN_RECITERS;
}

// ── Cycle helper ─────────────────────────────────────────────────────────────

/** Returns the next mode in cycle order. Wraps around at the end. */
export function getNextPrayerNotificationMode(current: PrayerNotificationMode): PrayerNotificationMode {
  const idx = PRAYER_NOTIFICATION_MODE_CYCLE.indexOf(current);
  if (idx === -1) return PRAYER_NOTIFICATION_MODE_CYCLE[0];
  return PRAYER_NOTIFICATION_MODE_CYCLE[(idx + 1) % PRAYER_NOTIFICATION_MODE_CYCLE.length];
}

// ── Themeable mode icons ─────────────────────────────────────────────────────
// All four icons are inlined SVG strings with `__C__` tokens that get replaced
// with the active accent colour at render time. Source files live in
// `assets/icons/` (silent_icon.svg, vibrate_icon.svg, notification_icon.svg,
// adhan_icon.svg) — if you edit a source SVG, re-paste the path data here.
//
// silent/notification/vibrate share an 800×800 viewBox so they balance on the
// row. The adhan icon has its own native viewBox (512×512) — react-native-svg
// scales it to fit the requested size.

// notification_icon.svg — bell silhouette (standard mode)
const ICON_BELL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><path fill="none" stroke="__C__" stroke-width="50" stroke-linecap="round" stroke-linejoin="round" d="M668.25,549.11c-40.12-49.11-68.45-74.11-68.45-209.5,0-123.98-63.31-168.16-115.42-189.61-6.92-2.84-13.44-9.38-15.55-16.48-9.14-31.11-34.77-58.52-68.83-58.52s-59.7,27.42-68.75,58.55c-2.11,7.19-8.63,13.61-15.55,16.45-52.17,21.48-115.42,65.5-115.42,189.61-.08,135.39-28.41,160.39-68.53,209.5-16.62,20.34-2.06,50.89,27.02,50.89h482.62c28.92,0,43.39-30.64,26.86-50.89Z"/><path fill="none" stroke="__C__" stroke-width="50" stroke-linecap="round" stroke-linejoin="round" d="M500,600v25c0,55.23-44.77,100-100,100s-100-44.77-100-100v-25"/></svg>`;

// silent_icon.svg — bell with diagonal slash (silent mode)
const ICON_BELL_SILENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><path fill="none" stroke="__C__" stroke-width="50" stroke-linecap="round" stroke-linejoin="round" d="M200.8,319.67c-.39,6.41-.58,13.05-.58,19.94,0,135.39-28.34,160.39-68.45,209.5-16.62,20.34-2.08,50.89,27.02,50.89h341.22"/><path fill="none" stroke="__C__" stroke-width="50" stroke-linecap="round" stroke-linejoin="round" d="M647.66,523.91c-28.88-36.64-47.84-73.52-47.84-184.38,0-123.91-63.31-168.08-115.44-189.53-6.92-2.84-13.44-9.38-15.55-16.48-9.12-31.11-34.73-58.52-68.83-58.52s-59.69,27.42-68.75,58.55c-2.11,7.19-8.63,13.61-15.62,16.45-9.67,3.94-19.07,8.53-28.12,13.73"/><path fill="none" stroke="__C__" stroke-width="50" stroke-linecap="round" stroke-linejoin="round" d="M500,600v25c0,55.23-44.77,100-100,100s-100-44.77-100-100v-25"/><line x1="700" y1="700" x2="100" y2="100" fill="none" stroke="__C__" stroke-width="50" stroke-miterlimit="15.62" stroke-linecap="round"/></svg>`;

// vibrate_icon.svg — phone with vibration waves (vibration mode)
const ICON_VIBRATE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><path fill="__C__" d="M500,112.5h-200c-34.5.04-62.46,28-62.5,62.5v450c.04,34.5,28,62.46,62.5,62.5h200c34.5-.04,62.46-28,62.5-62.5V175c-.04-34.5-28-62.46-62.5-62.5ZM537.5,625c-.02,20.7-16.8,37.48-37.5,37.5h-200c-20.7-.02-37.48-16.8-37.5-37.5V175c.02-20.7,16.8-37.48,37.5-37.5h200c20.7.02,37.48,16.8,37.5,37.5v450ZM662.51,275v250c0,6.9-5.6,12.5-12.5,12.5s-12.5-5.6-12.5-12.5v-250c0-6.9,5.6-12.5,12.5-12.5s12.5,5.6,12.5,12.5ZM762.51,325v150c0,6.9-5.6,12.5-12.5,12.5s-12.5-5.6-12.5-12.5v-150c0-6.9,5.6-12.5,12.5-12.5s12.5,5.6,12.5,12.5ZM162.5,275v250c0,6.9-5.6,12.5-12.5,12.5s-12.5-5.6-12.5-12.5v-250c0-6.9,5.6-12.5,12.5-12.5s12.5,5.6,12.5,12.5ZM62.5,325v150c0,6.9-5.6,12.5-12.5,12.5s-12.5-5.6-12.5-12.5v-150c0-6.9,5.6-12.5,12.5-12.5s12.5,5.6,12.5,12.5Z"/></svg>`;

// adhan_icon.svg — microphone with sound-waves glyph (adhan_short mode).
// Replaces the earlier multi-layered minaret illustration (SVG Repo, MIT).
// Source: `assets/icons/adhan_icon.svg`. A single filled path drawn with
// nonzero fill-rule — the outer/inner microphone subpaths cancel to form a
// hollow outline, and the base U-shape provides the stand. `__C__` is swapped
// for the active accent at render time so it tints with `T.text`
// (white on dark mode, near-black on light mode).
const ICON_ADHAN_SHORT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="__C__" d="M 10 0 L 9.515625 0.029296875 L 9.0410156 0.11914062 L 8.5820312 0.25976562 L 8.140625 0.45898438 L 7.7265625 0.70898438 L 7.3457031 1.0058594 L 7.0039062 1.3476562 L 6.7070312 1.7285156 L 6.4589844 2.140625 L 6.2578125 2.5820312 L 6.1171875 3.0429688 L 6.0273438 3.5175781 L 5.9980469 4.0019531 L 5.9980469 11 L 6.0273438 11.482422 L 6.1171875 11.955078 L 6.2578125 12.417969 L 6.4589844 12.859375 L 6.7070312 13.271484 L 7.0039062 13.652344 L 7.3457031 13.994141 L 7.7265625 14.291016 L 8.140625 14.541016 L 8.5820312 14.740234 L 9.0410156 14.882812 L 9.515625 14.96875 L 10 15 L 10.480469 14.96875 L 10.957031 14.882812 L 11.417969 14.740234 L 11.857422 14.541016 L 12.273438 14.291016 L 12.650391 13.994141 L 12.992188 13.652344 L 13.292969 13.271484 L 13.541016 12.859375 L 13.738281 12.417969 L 13.882812 11.955078 L 13.970703 11.482422 L 13.998047 11 L 13.998047 4.0019531 L 13.970703 3.5175781 L 13.882812 3.0429688 L 13.738281 2.5820312 L 13.541016 2.140625 L 13.292969 1.7285156 L 12.992188 1.3476562 L 12.650391 1.0058594 L 12.273438 0.70898438 L 11.857422 0.45898438 L 11.417969 0.25976562 L 10.957031 0.11914062 L 10.480469 0.029296875 L 10 0 z M 9.7949219 1.0097656 L 10.205078 1.0097656 L 10.609375 1.0644531 L 11.003906 1.1738281 L 11.378906 1.3378906 L 11.728516 1.5507812 L 12.046875 1.8066406 L 12.326172 2.1074219 L 12.5625 2.4414062 L 12.75 2.8066406 L 12.886719 3.1914062 L 12.970703 3.5917969 L 13 4.0019531 L 13 11 L 12.970703 11.410156 L 12.886719 11.808594 L 12.75 12.195312 L 12.5625 12.556641 L 12.326172 12.894531 L 12.046875 13.193359 L 11.728516 13.451172 L 11.378906 13.664062 L 11.003906 13.826172 L 10.609375 13.9375 L 10.205078 13.992188 L 9.7949219 13.992188 L 9.3886719 13.9375 L 8.9941406 13.826172 L 8.6171875 13.664062 L 8.2675781 13.451172 L 7.9511719 13.193359 L 7.671875 12.894531 L 7.4355469 12.556641 L 7.2460938 12.195312 L 7.109375 11.808594 L 7.0292969 11.410156 L 7 11 L 7 4.0019531 L 7.0292969 3.5917969 L 7.109375 3.1914062 L 7.2460938 2.8066406 L 7.4355469 2.4414062 L 7.671875 2.1074219 L 7.9511719 1.8066406 L 8.2675781 1.5507812 L 8.6171875 1.3378906 L 8.9941406 1.1738281 L 9.3886719 1.0644531 L 9.7949219 1.0097656 z M 3.9980469 11 L 4.0253906 11.556641 L 4.1015625 12.107422 L 4.2304688 12.652344 L 4.4082031 13.179688 L 4.6347656 13.689453 L 4.9082031 14.175781 L 5.2265625 14.632812 L 5.5839844 15.060547 L 5.9804688 15.455078 L 6.4101562 15.806641 L 6.8730469 16.119141 L 7.3613281 16.388672 L 7.8710938 16.611328 L 8.4023438 16.78125 L 8.9472656 16.90625 L 9.4980469 16.978516 L 9.4980469 19 L 5.9980469 19 L 5.9980469 20 L 13.998047 20 L 13.998047 19 L 10.5 19 L 10.5 16.978516 L 11.050781 16.90625 L 11.595703 16.78125 L 12.125 16.611328 L 12.638672 16.388672 L 13.126953 16.119141 L 13.589844 15.806641 L 14.019531 15.455078 L 14.414062 15.060547 L 14.773438 14.632812 L 15.089844 14.175781 L 15.363281 13.689453 L 15.587891 13.179688 L 15.767578 12.652344 L 15.896484 12.107422 L 15.974609 11.556641 L 15.998047 11 L 15 11 L 14.970703 11.521484 L 14.888672 12.039062 L 14.755859 12.544922 L 14.566406 13.033203 L 14.330078 13.5 L 14.042969 13.939453 L 13.714844 14.34375 L 13.34375 14.714844 L 12.9375 15.044922 L 12.498047 15.328125 L 12.033203 15.568359 L 11.544922 15.753906 L 11.037109 15.890625 L 10.523438 15.972656 L 10 15.998047 L 9.4765625 15.972656 L 8.9589844 15.890625 L 8.4550781 15.753906 L 7.9667969 15.568359 L 7.4980469 15.328125 L 7.0605469 15.044922 L 6.6523438 14.714844 L 6.28125 14.34375 L 5.953125 13.939453 L 5.6699219 13.5 L 5.4316406 13.033203 L 5.2441406 12.544922 L 5.1074219 12.039062 L 5.0253906 11.521484 L 5 11 L 3.9980469 11 z"/></svg>`;

const ICON_TEMPLATES: Record<PrayerNotificationMode, string> = {
  silent:      ICON_BELL_SILENT,
  vibration:   ICON_VIBRATE,
  standard:    ICON_BELL,
  adhan_short: ICON_ADHAN_SHORT,
};

/** Returns the SVG markup for a mode with the colour applied. */
export function prayerNotificationModeIconXml(mode: PrayerNotificationMode, color: string): string {
  return ICON_TEMPLATES[mode].replace(/__C__/g, color);
}

// ── Scheduler helpers ────────────────────────────────────────────────────────

/** True when the mode should make the iOS notification play the default
 *  system sound. Only `standard` triggers the system sound — `vibration` /
 *  `silent` are scheduled silently, and `adhan_short` schedules a custom
 *  bundled sound (see `adhanSoundFileForMode`) so iOS can play the adhan
 *  even when the app is killed. */
export function modeUsesSystemSound(mode: PrayerNotificationMode): boolean {
  return mode === 'standard';
}
