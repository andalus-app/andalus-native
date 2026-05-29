import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { getNotificationScheduleState } from '../modules/WidgetData';
import { getIfisTimesForDate } from './ifisApi';
import { loadPrayerNotificationModes } from '../storage/prayerNotificationPreferences';
import { modeUsesSystemSound } from './prayerNotificationModes';
import { adhanSoundFileForMode, type PrayerKey } from '../types/prayerNotificationTypes';

// Lazy-load expo-notifications so a missing native module (e.g. in Expo Go or
// before a native rebuild) never crashes the app — all functions degrade to no-ops.
//
// Silence the two expected Expo Go warnings that expo-notifications emits on
// require() when running outside a development build. These are cosmetic — the
// module loads and all scheduling APIs work correctly on physical devices.
const _origWarn = console.warn.bind(console);
console.warn = (...args: Parameters<typeof console.warn>) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (
    msg.includes('expo-notifications') &&
    (msg.includes('Expo Go') || msg.includes('not fully supported'))
  ) return;
  _origWarn(...args);
};
let N: typeof import('expo-notifications') | null = null;
try {
  N = require('expo-notifications');
  console.warn = _origWarn; // restore immediately after require completes
  N!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   false,
    }),
  });
} catch {
  N = null;
  console.warn = _origWarn; // restore even on failure
}

// ── Prayer names ─────────────────────────────────────────────────────────────
const PRAYERS: Record<string, string> = {
  Fajr:    'Fajr',
  Dhuhr:   'Dhuhr',
  Asr:     'Asr',
  Maghrib: 'Maghrib',
  Isha:    'Isha',
};

// Current format includes the local calendar date so each prayer×day combination
// is a unique identifier: hidayah-prayer-YYYY-MM-DD-asr
// This prevents a stale "tomorrow" slot from a previous schedule from silently
// re-firing because its HH:MM happens to match a future day's prayer time.
const PRAYER_ID_PREFIX        = 'hidayah-prayer-';
// Old fixed-slot format (andalus-prayer-today-*, andalus-prayer-tomorrow-*).
// Kept only for backwards-compat cancel — never used for new notifications.
const LEGACY_PRAYER_ID_PREFIX = 'andalus-prayer-';

// Exported so NativeNotificationScheduler.swift can do prefix-based cancel.
// The exact identifiers are no longer predictable without the local date, so
// native must filter getAllPendingNotificationRequests by this prefix instead
// of using a fixed ID list.
export const PRAYER_NOTIFICATION_PREFIX = PRAYER_ID_PREFIX;

// Legacy exact IDs — kept so native code that has not yet migrated to prefix-
// based cancel continues to remove old-format notifications on older builds.
export const PRAYER_NOTIFICATION_IDS: string[] = (() => {
  const slots   = ['today', 'tomorrow'];
  const prayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  return slots.flatMap(s => prayers.map(p => `${LEGACY_PRAYER_ID_PREFIX}${s}-${p}`));
})();

// ── Generation counter — concurrent-call safety ──────────────────────────────
// schedulePrayerNotifications increments this on every call. Any in-progress
// older call checks the counter after each await and aborts if a newer call
// has taken over. This prevents two concurrent calls (e.g. useEffect re-render
// + background location task) from interleaving cancel/schedule operations and
// leaving stale or duplicate notifications in the iOS scheduler.
let _prayerScheduleGen = 0;

function _localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Permission ───────────────────────────────────────────────────────────────
export async function requestNotificationPermission(): Promise<boolean> {
  if (!N) return false;
  try {
    const { status: current } = await N.getPermissionsAsync();
    if (current === 'granted') return true;
    const { status } = await N.requestPermissionsAsync();
    return status === 'granted';
  } catch { return false; }
}

function timeToMin(t: string | undefined): number {
  if (!t) return -1;
  const [h, m] = t.split(':').map(Number);
  return isNaN(h) || isNaN(m) ? -1 : h * 60 + m;
}

/**
 * Returns the human-friendly city label used only in notification bodies.
 * If the displayName is "{locality}, {municipality}", returns "{municipality}".
 * Otherwise returns the displayName unchanged.
 *
 * Examples:
 *   "Kista, Stockholm"    → "Stockholm"
 *   "Spånga, Stockholm"   → "Stockholm"
 *   "Drottningholm, Ekerö"→ "Ekerö"
 *   "Järfälla"            → "Järfälla"
 *   "Mölndal"             → "Mölndal"
 *
 * IMPORTANT: never use this for prayer time calculation, cache keys,
 * locationKey, schedule trigger times, widget data, or app UI.
 */
export function getNotificationDisplayName(displayName: string): string {
  const trimmed  = displayName.trim();
  const commaIdx = trimmed.indexOf(',');
  return commaIdx === -1 ? trimmed : trimmed.slice(commaIdx + 1).trim();
}

// Look-ahead window: 8 days so a day-7 Isha at 23:59 still fits, but no
// further. iOS allows max 64 pending notifications per app; with 7 days × 5
// prayers = 35 slots reserved for prayer this leaves room for Allah's Names
// (14), pre-prayer (≤10), dhikr/Friday/Kahf/Zakat (~7) under the cap.
export const PRAYER_LOOKAHEAD_DAYS = 7;
const MAX_LOOKAHEAD_MS = (PRAYER_LOOKAHEAD_DAYS + 1) * 24 * 3_600_000;

/**
 * Stable fingerprint of a multi-day prayer schedule — used to skip a
 * cancel+reschedule cycle when nothing has changed since the last call.
 * Order-independent (keys are sorted), and tolerant of missing prayers
 * (absent values stringify as empty).
 */
export function computeWeekTimesHash(
  dailyTimes: Record<string, Record<string, string>>,
): string {
  const dates = Object.keys(dailyTimes).sort();
  const parts: string[] = [];
  for (const d of dates) {
    const t = dailyTimes[d];
    parts.push(`${d}:${t.Fajr ?? ''}|${t.Dhuhr ?? ''}|${t.Asr ?? ''}|${t.Maghrib ?? ''}|${t.Isha ?? ''}`);
  }
  return parts.join(';');
}

function scheduleStateUnchanged(
  dailyTimes: Record<string, Record<string, string>>,
  cityName:   string,
  existing:   Awaited<ReturnType<typeof getNotificationScheduleState>>,
  context?:   { method?: number; school?: number },
): boolean {
  if (!existing?.todayT) return false;

  // Date freshness check — mirrors native rescheduleNeeded's s.date != resolved.todayDate.
  // If the stored state belongs to a previous calendar day, always reschedule: the
  // tomorrow-* slot base date rolled over and old notifications target the wrong day.
  const n = new Date();
  const todayLocalDate = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  if (existing.date !== todayLocalDate) {
    console.log(`[PrayerNotif] schedule state date changed: ${existing.date} → ${todayLocalDate}, forcing reschedule`);
    return false;
  }

  // Notification body label changed — reschedule so body text stays accurate.
  // Compare the derived notification labels, not raw displayNames, so that moves
  // within the same municipality (e.g. Kista → Spånga, both → "Stockholm") do
  // not trigger an unnecessary reschedule when prayer times are also unchanged.
  const currentNotifLabel  = getNotificationDisplayName(cityName);
  const existingNotifLabel = existing.notificationDisplayName
    ?? getNotificationDisplayName(existing.displayName ?? '');
  if (currentNotifLabel !== existingNotifLabel) return false;

  // Calculation method or school changed
  if (context?.method !== undefined && context.method !== existing.method) return false;
  if (context?.school !== undefined && context.school !== existing.school) return false;

  // Multi-day comparison via hash. When the stored state already carries a
  // weekTimesHash (written by a previous JS call), a single equality check
  // covers all 7 days. Mismatch → reschedule.
  // When the stored state is missing weekTimesHash (written by native or by an
  // older JS version), fall back to today/tomorrow per-minute comparison so we
  // still avoid unnecessary work for the days the native scheduler covers.
  if (existing.weekTimesHash) {
    return existing.weekTimesHash === computeWeekTimesHash(dailyTimes);
  }

  const prayers   = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const tomLocal  = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  const tomLocStr = `${tomLocal.getFullYear()}-${String(tomLocal.getMonth() + 1).padStart(2, '0')}-${String(tomLocal.getDate()).padStart(2, '0')}`;
  const todayT    = dailyTimes[todayLocalDate];
  const tomT      = dailyTimes[tomLocStr];
  if (!todayT) return false;
  if (!prayers.every(p => Math.abs(timeToMin(todayT[p]) - timeToMin(existing.todayT![p])) < 1)) return false;
  if (tomT && existing.tomT) {
    if (!prayers.every(p => Math.abs(timeToMin(tomT[p]) - timeToMin(existing.tomT![p])) < 1)) return false;
  }
  return true;
}

// ── Schedule up to PRAYER_LOOKAHEAD_DAYS ahead ──────────────────────────────
/**
 * dailyTimes: ISO-date keyed dict of prayer timings. Day 0 (today) must always
 * be present; days 1..6 are scheduled only when present, so a caller with only
 * today+tomorrow available still works (degrades to the old 2-day behavior).
 *
 * Identifier per notification: hidayah-prayer-YYYY-MM-DD-{prayer}.
 * Cancels all hidayah-prayer-* before rescheduling so old 2-day-format
 * notifications from a previous build are cleaned up in the same pass.
 */
export async function schedulePrayerNotifications(
  dailyTimes: Record<string, Record<string, string>>,
  cityName:   string,
  context?:   { method?: number; school?: number },
): Promise<void> {
  if (!N) return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;

    // Skip rescheduling when the existing schedule already reflects these exact
    // times — avoids a redundant cancel+reschedule cycle.
    // Guard: also verify that at least one prayer notification is still pending
    // in the iOS scheduler. If the user toggled notifications off/on in Settings
    // (which clears all pending notifications), scheduleStateUnchanged would
    // otherwise return true and silently skip rescheduling, leaving zero active
    // prayer notifications until the next state-changing event.
    if (Platform.OS === 'ios') {
      const [existing, pending] = await Promise.all([
        getNotificationScheduleState().catch(() => null),
        N.getAllScheduledNotificationsAsync().catch(() => []),
      ]);
      const hasPrayerPending = (pending as Array<{ identifier: string }>)
        .some(n => n.identifier.startsWith(PRAYER_ID_PREFIX));
      if (existing && hasPrayerPending && scheduleStateUnchanged(dailyTimes, cityName, existing, context)) return;
    }

    // Claim a generation so any older concurrent call aborts at its next await.
    const gen = ++_prayerScheduleGen;

    // Clear ALL old prayer notifications first (both old format and passed ones)
    await cancelPrayerNotifications();
    if (_prayerScheduleGen !== gen) return; // newer call took over

    // Clean any passed notifications from the previous schedule to keep queue bounded
    await cancelPassedPrayerNotifications();
    if (_prayerScheduleGen !== gen) return; // newer call took over

    // Per-prayer notification modes (silent / vibration / standard / adhan_*).
    // Each prayer can carry its own sound + payload so the receive handler in
    // app/_layout.tsx knows whether to trigger local adhan playback. Falls back
    // to the all-standard default if storage is empty or corrupt.
    const perPrayerModes = await loadPrayerNotificationModes();
    if (_prayerScheduleGen !== gen) return;

    const now = new Date();

    // Dedup guard: at most one notification per prayer × calendar date.
    const scheduled = new Set<string>();
    let totalQueued = 0;

    // Sort dates chronologically so iOS sees them in fire-time order — purely
    // cosmetic for debugging but makes pending-request logs readable.
    const dates = Object.keys(dailyTimes).sort();

    outer: for (const dateStr of dates) {
      if (_prayerScheduleGen !== gen) return; // newer call took over
      const dayTimes = dailyTimes[dateStr];
      if (!dayTimes) continue;

      const [yy, mo, dd] = dateStr.split('-').map(Number);
      if (!yy || !mo || !dd) continue;

      for (const key of Object.keys(PRAYERS)) {
        if (_prayerScheduleGen !== gen) return;

        const timeStr = dayTimes[key];
        if (!timeStr) continue;

        const [hh, mm] = timeStr.split(':').map(Number);
        if (isNaN(hh) || isNaN(mm)) continue;

        // Construct fire from the target date's year/month/day + parsed HH:MM.
        const fire = new Date(yy, mo - 1, dd, hh, mm, 0, 0);

        const prayerKey  = key.toLowerCase();
        const dedupKey   = `${dateStr}-${prayerKey}`;
        const identifier = `${PRAYER_ID_PREFIX}${dateStr}-${prayerKey}`;

        if (__DEV__) {
          const label = fire <= now ? 'SKIP-past' :
            (fire.getTime() - now.getTime() > MAX_LOOKAHEAD_MS) ? 'SKIP-far' :
            (_localIsoDate(fire) !== dateStr) ? 'SKIP-date' :
            scheduled.has(dedupKey) ? 'SKIP-dup' : 'SCHEDULE';
          console.log(
            `[PrayerNotif] ${label.padEnd(9)} | ${key.padEnd(7)} | target=${dateStr}` +
            ` | fire=${fire.toISOString().slice(0, 19)}Z` +
            ` | id=${identifier}`,
          );
        }

        if (fire <= now) continue;
        if (fire.getTime() - now.getTime() > MAX_LOOKAHEAD_MS) continue;
        // DST guard: verify fire lands on the intended local date.
        if (_localIsoDate(fire) !== dateStr) continue;
        if (scheduled.has(dedupKey)) continue;
        scheduled.add(dedupKey);

        const perPrayer = perPrayerModes[key as PrayerKey];
        const mode      = perPrayer?.mode    ?? 'standard';
        const reciter   = perPrayer?.reciter ?? null;
        // Sound resolution — all four modes are delivered entirely by iOS so
        // the chosen behaviour applies even when the app is killed:
        //   • standard    → iOS default notification sound + system vibration.
        //   • silent      → no sound, no vibration (iOS doesn't vibrate for a
        //     truly silent notification).
        //   • vibration   → bundled 1 s `silent.caf` so iOS "plays" an
        //     inaudible file and triggers its standard vibration. Without a
        //     sound iOS would not vibrate at all.
        //   • adhan_short → bundled `<reciter>_short.caf` in ios/Hidayah/Sounds/.
        // CAF filenames must match a project.pbxproj resource entry.
        const adhanFile: string | null = adhanSoundFileForMode(mode, reciter);
        const sound: string | boolean =
          adhanFile          ? adhanFile :
          mode === 'vibration' ? 'silent.caf' :
          modeUsesSystemSound(mode);

        await N!.scheduleNotificationAsync({
          identifier,
          content: {
            title: `Det är dags för ${PRAYERS[key]}`,
            body:  `i ${getNotificationDisplayName(cityName)}`,
            sound,
            data:  {
              screen:    'prayer',
              prayerKey: key,
              mode,
              reciter,
            },
          },
          trigger: {
            type: N!.SchedulableTriggerInputTypes.DATE,
            date: fire,
          },
        });
        totalQueued += 1;

        // Hard cap: reserve room for other notification systems (dhikr, friday dua, etc).
        // iOS allows ~64 pending notifications — we use at most 40 for safety.
        if (totalQueued >= 35) break outer;
      }
    }
    if (__DEV__) console.log(`[PrayerNotif] Queued ${totalQueued} prayer notifications across ${dates.length} day(s)`);
  } catch {}
}

// ── Cancel all prayer notifications ──────────────────────────────────────────
// Cancels:
//   • New date-based format:  hidayah-prayer-YYYY-MM-DD-*
//   • Legacy fixed-slot:      andalus-prayer-today/tomorrow-*
//   • Pre-git legacy:         any notification whose title/body contains the
//                             known Swedish prayer phrases
// Explicitly excludes all other notification subsystems.
export async function cancelPrayerNotifications(): Promise<void> {
  if (!N) return;
  try {
    const all = await N.getAllScheduledNotificationsAsync();
    // Prefixes that belong to other notification systems — never cancel these.
    const SAFE_PREFIXES = [
      'andalus-dhikr-', 'andalus-friday-dua-', 'andalus-allah-names-',
      'andalus-live-',  'andalus-announcement-', 'andalus-kahf-',
      'andalus-zakat-', 'hidayah-pre-prayer-',
    ];
    const ours = all.filter(n => {
      // New date-based format (hidayah-prayer-YYYY-MM-DD-*)
      if (n.identifier.startsWith(PRAYER_ID_PREFIX)) return true;
      // Legacy fixed-slot format (andalus-prayer-today/tomorrow-*)
      if (n.identifier.startsWith(LEGACY_PRAYER_ID_PREFIX)) return true;
      // Never touch other known notification subsystems
      if (SAFE_PREFIXES.some(p => n.identifier.startsWith(p))) return false;
      // Pre-git legacy: prayer notifications identified by Swedish content phrases.
      const title = n.content.title ?? '';
      const body  = n.content.body  ?? '';
      return title.includes('Det är dags för') || body.includes('träder in');
    });
    // Cancel individually rather than Promise.all so a single failure does not
    // abort the remaining cancels. Each cancel is fire-and-forget with its own
    // error boundary so an iOS API hiccup on one identifier never leaves others
    // uncancelled.
    for (const n of ours) {
      await N!.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  } catch {}
}

// ── Cancel old passed prayer notifications ────────────────────────────────────
// Removes any hidayah-prayer-* notifications that fired in the past.
// Called before scheduling new ones to keep the pending queue fresh and bounded.
// Does NOT remove future notifications — only clears stale ones.
async function cancelPassedPrayerNotifications(): Promise<void> {
  if (!N) return;
  try {
    const all = await N.getAllScheduledNotificationsAsync();
    const now = Date.now();
    const ours = all.filter(n => {
      if (!n.identifier.startsWith(PRAYER_ID_PREFIX)) return false;
      // Parse trigger date — expo-notifications stores as Date object or timestamp
      if (!n.trigger || typeof n.trigger !== 'object') return false;
      const trigger = n.trigger as { type?: string; date?: Date | number };
      if (!trigger.date) return false;
      const fireTime = trigger.date instanceof Date
        ? trigger.date.getTime()
        : typeof trigger.date === 'number'
          ? trigger.date
          : 0;
      return fireTime < now; // Notification already passed
    });
    if (__DEV__ && ours.length > 0) {
      console.log(`[PrayerNotif] Cleaning ${ours.length} passed prayer notifications`);
    }
    for (const n of ours) {
      await N!.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  } catch {}
}

// ── Dhikr reminder — 1 hour before Maghrib ───────────────────────────────────

const DHIKR_PREFIX = 'andalus-dhikr-';

// Fixed epoch for deterministic day-based rotation (do not change).
const DHIKR_EPOCH_MS = new Date('2025-01-01T00:00:00Z').getTime();
const DHIKR_MESSAGES: string[] = require('../data/dhikrMessages.json');

/** Returns the 0-based message index for a given day offset from today.
 *  Rotates through all 30 messages in order, repeating every 30 days.
 *  Deterministic — same result on every device for the same calendar day. */
function dhikrMessageIndex(dayOffset = 0): number {
  const daysSinceEpoch = Math.floor((Date.now() - DHIKR_EPOCH_MS) / 86_400_000) + dayOffset;
  return ((daysSinceEpoch % DHIKR_MESSAGES.length) + DHIKR_MESSAGES.length) % DHIKR_MESSAGES.length;
}

/** Schedules dhikr reminders 1 hour before Maghrib for today and tomorrow.
 *  Uses DATE trigger (same as prayer notifications) so the time adapts to the
 *  actual Maghrib time for the user's location and calculation method.
 *  Message body rotates through 30 texts — one per calendar day. */
export async function scheduleDhikrReminder(
  todayMaghrib:    string,
  tomorrowMaghrib: string | null,
): Promise<void> {
  if (!N) return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;

    await cancelDhikrReminder();

    const now    = new Date();
    const today  = new Date();
    const tomRow = new Date();
    tomRow.setDate(tomRow.getDate() + 1);

    const queue = async (timeStr: string, base: Date, slot: string, dayOffset: number) => {
      const [hh, mm] = timeStr.split(':').map(Number);
      if (isNaN(hh) || isNaN(mm)) return;
      // Subtract 60 minutes from Maghrib
      const totalMin = hh * 60 + mm - 60;
      if (totalMin < 0) return; // Maghrib before 01:00 — edge case
      const fireHH = Math.floor(totalMin / 60);
      const fireMM = totalMin % 60;
      const fire = new Date(base);
      fire.setHours(fireHH, fireMM, 0, 0);
      if (fire <= now) return;
      const body = DHIKR_MESSAGES[dhikrMessageIndex(dayOffset)];
      await N!.scheduleNotificationAsync({
        identifier: `${DHIKR_PREFIX}${slot}`,
        content: {
          title: 'Tid för dhikr',
          body,
          sound: true,
          data: { screen: 'dhikr' },
        },
        trigger: {
          type: N!.SchedulableTriggerInputTypes.DATE,
          date: fire,
        },
      });
    };

    await queue(todayMaghrib, today, 'today', 0);
    if (tomorrowMaghrib) await queue(tomorrowMaghrib, tomRow, 'tomorrow', 1);
  } catch {}
}

export async function cancelDhikrReminder(): Promise<void> {
  if (!N) return;
  try {
    await Promise.all([
      N.cancelScheduledNotificationAsync(`${DHIKR_PREFIX}today`).catch(() => {}),
      N.cancelScheduledNotificationAsync(`${DHIKR_PREFIX}tomorrow`).catch(() => {}),
    ]);
  } catch {}
}

// ── Friday Last Hour (Jumu'ah) dua reminder ──────────────────────────────────
// Fires 30 minutes before Maghrib on Fridays only.
// Reminds the user of the blessed last hour of Jumu'ah when duas are accepted.
// Uses DATE triggers (same as prayer + dhikr) so AppContext reschedules on each
// prayer-times load — no separate startup sync needed.

const FRIDAY_DUA_PREFIX = 'andalus-friday-dua-';

const FRIDAY_DUA_MESSAGES: { title: string; body: string }[] = [
  {
    title: 'En stund då Allah svarar 🤲',
    body:  "Profeten ﷺ sade: På fredag finns en stund då varje dua besvaras. Sök den nu – särskilt efter 'Asr.",
  },
  {
    title: 'Missa inte denna timme',
    body:  "Det finns en stund på fredag då ingen dua avslås. Lärda säger: den är i dagens sista timme. Gör din dua nu.",
  },
  {
    title: 'Sista timmen av fredag',
    body:  "Följ Sunnah – sök den välsignade stunden efter 'Asr. Be Allah om det goda, Han ger.",
  },
  {
    title: 'En gåva varje fredag',
    body:  'Varje vecka finns en stund då dua accepteras. Sitt kvar, minns Allah och be från hjärtat i denna sista timme.',
  },
];

/** Schedules a notification 30 minutes before Maghrib for today and/or tomorrow
 *  if that day is a Friday (getDay() === 5). Cancels any existing Friday dua
 *  notifications before rescheduling to avoid duplicates. */
export async function scheduleFridayDuaReminder(
  todayMaghrib:    string,
  tomorrowMaghrib: string | null,
): Promise<void> {
  if (!N) return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;

    await cancelFridayDuaReminder();

    const now      = new Date();
    const today    = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const scheduleFor = async (timeStr: string, base: Date) => {
      const [hh, mm] = timeStr.split(':').map(Number);
      if (isNaN(hh) || isNaN(mm)) return;
      const totalMin = hh * 60 + mm - 30; // 30 min before Maghrib
      if (totalMin < 0) return;
      const fire = new Date(base);
      fire.setHours(Math.floor(totalMin / 60), totalMin % 60, 0, 0);
      if (fire <= now) return; // already past — skip

      const msg     = FRIDAY_DUA_MESSAGES[Math.floor(Math.random() * FRIDAY_DUA_MESSAGES.length)];
      const dateKey = base.toISOString().slice(0, 10); // YYYY-MM-DD — unique per Friday
      await N!.scheduleNotificationAsync({
        identifier: `${FRIDAY_DUA_PREFIX}${dateKey}`,
        content: {
          title: msg.title,
          body:  msg.body,
          sound: true,
          data:  { screen: 'dhikr' },
        },
        trigger: {
          type: N!.SchedulableTriggerInputTypes.DATE,
          date: fire,
        },
      });
    };

    if (today.getDay() === 5)    await scheduleFor(todayMaghrib, today);
    if (tomorrow.getDay() === 5 && tomorrowMaghrib) await scheduleFor(tomorrowMaghrib, tomorrow);
  } catch {}
}

export async function cancelFridayDuaReminder(): Promise<void> {
  if (!N) return;
  try {
    const all  = await N.getAllScheduledNotificationsAsync();
    const ours = all.filter(n => n.identifier.startsWith(FRIDAY_DUA_PREFIX));
    await Promise.all(ours.map(n => N!.cancelScheduledNotificationAsync(n.identifier)));
  } catch {}
}

// ── YouTube live stream notification ─────────────────────────────────────────
// Called at most once per unique videoId (deduplication is enforced by useYoutubeLive).
// NOTE: This fires an immediate local notification — it only works when the app is
// in the foreground or recently backgrounded. For notifications when the app is
// killed, the Supabase Edge Function must push via the Expo Push API.
const LIVE_PREFIX = 'andalus-live-';

export async function sendLiveNotification(videoId: string, title: string): Promise<void> {
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      identifier: LIVE_PREFIX + videoId,
      content: {
        title: 'Direktsändning pågår nu',
        body:  title,
        sound: true,
        data:  { screen: 'youtube_live', videoId },
      },
      trigger: {
        type:    N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        repeats: false,
      },
    });
  } catch {}
}

// AsyncStorage key for live-stream notification preference.
// Exported so settings.tsx can read/write it and useYoutubeLive can respect it.
export const LIVE_NOTIF_ENABLED_KEY = 'liveNotificationEnabled';

// ── Admin push token ─────────────────────────────────────────────────────────
// Returns the Expo push token string, or null if unavailable.
// The caller (BookingNotifContext) is responsible for saving it to Supabase.
export async function getExpoPushToken(): Promise<string | null> {
  if (!N) return null;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[PushToken] permission not granted:', status);
      return null;
    }
    // projectId is required in Expo SDK 50+ for getExpoPushTokenAsync
    let projectId: string | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Constants = require('expo-constants');
      const cfg = Constants.default ?? Constants;
      projectId = cfg.expoConfig?.extra?.eas?.projectId
        ?? cfg.easConfig?.projectId
        ?? undefined;
    } catch (e) {
      console.warn('[PushToken] could not read projectId:', e);
    }
    if (!projectId) {
      console.warn('[PushToken] no projectId found — token request will likely fail');
    }
    const tokenData = await N.getExpoPushTokenAsync({ projectId: projectId! });
    console.log('[PushToken] token:', tokenData?.data);
    return tokenData?.data ?? null;
  } catch (e) {
    // Network errors are expected at startup (device just woke, no connectivity yet).
    // All other unexpected errors are logged for diagnostics.
    if (!isTransientPushError(e)) {
      console.warn('[PushToken] getExpoPushToken error:', e);
    }
    return null;
  }
}

// ── Register for push notifications ──────────────────────────────────────────
// Checks device, requests permission, creates Android channel, and returns the
// Expo push token. Throws on any failure so the caller can surface the error.
export async function registerForPushNotificationsAsync(): Promise<string> {
  if (!N) throw new Error('expo-notifications not available');

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require('expo-device');
    if (!Device.isDevice) {
      throw new Error('Push notifications require a physical device');
    }
  } catch (e) {
    // expo-device not linked yet (requires native rebuild) — skip device check
    if ((e as Error).message === 'Push notifications require a physical device') throw e;
  }

  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('default', {
      name: 'default',
      importance: N.AndroidImportance.MAX,
    });
  }

  const { status: existingStatus } = await N.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await N.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    throw new Error('Permission not granted for push notifications');
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Constants = require('expo-constants');
  const cfg = Constants.default ?? Constants;
  const projectId: string | undefined =
    cfg.expoConfig?.extra?.eas?.projectId ?? cfg.easConfig?.projectId;

  if (!projectId) {
    throw new Error('Missing EAS projectId');
  }

  const token = (await N.getExpoPushTokenAsync({ projectId })).data;
  return token;
}

// ── Save push token to Supabase ───────────────────────────────────────────────
// Upserts the device's Expo push token into the push_tokens table.
// Called after permission is granted (onboarding) and on every app start
// to handle token rotation. Safe to call multiple times — upsert on token.
const PUSH_TOKEN_STORAGE_KEY = 'andalus_push_token_saved';

// Retry delays for transient Expo server errors (503, upstream timeout).
// Non-blocking: scheduled via setTimeout so app startup is never delayed.
const PUSH_TOKEN_RETRY_DELAYS_MS = [30_000, 120_000, 300_000]; // 30 s, 2 min, 5 min

function isTransientPushError(e: unknown): boolean {
  const msg = String(e).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('no healthy upstream') ||
    msg.includes('connection timeout') ||
    msg.includes('upstream connect') ||
    msg.includes('reset before headers') ||
    msg.includes('network request failed') ||
    msg.includes('typeerror: network')
  );
}

export async function savePushToken(attempt = 1): Promise<void> {
  try {
    const token = await registerForPushNotificationsAsync();

    const liveNotifPref = await AsyncStorage.getItem(LIVE_NOTIF_ENABLED_KEY);
    const liveNotif = liveNotifPref === 'true';

    // Cache key encodes both token and live_notif so a preference change forces
    // a re-upsert even when the push token itself hasn't rotated.
    const cacheValue = `${token}|live=${liveNotif}`;
    const saved = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    if (saved === cacheValue) {
      console.log('[savePushToken] token + live_notif unchanged — skipping upsert');
      return;
    }

    // user_id is the primary key — use registered user ID if available,
    // otherwise fall back to device ID (generated once and persisted).
    // This ensures anonymous users (who haven't booked anything) also get push.
    let userId = await AsyncStorage.getItem('islamnu_user_id')
      ?? await AsyncStorage.getItem('islamnu_device_id');
    if (!userId) {
      // Generate a stable device UUID for this installation
      userId = `device_${Math.random().toString(36).slice(2)}_${Date.now()}`;
      await AsyncStorage.setItem('islamnu_device_id', userId);
    }

    // Remove any stale row for this token under a different user_id (e.g. device
    // was previously registered anonymously, user has now logged in with a real ID).
    await supabase.from('push_tokens').delete().eq('token', token).neq('user_id', userId);

    // Read announcement preference so new/rotated tokens preserve the user's choice.
    // Without this, fresh rows default to null which the edge function treats as "allowed".
    let announcementNotif = true;
    try {
      const settingsPref = await AsyncStorage.getItem('andalus_settings');
      if (settingsPref) announcementNotif = JSON.parse(settingsPref)?.announcementNotifications ?? true;
    } catch {}

    console.log('[savePushToken] upserting: live_notif=%s userId=%s', liveNotif, userId);
    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { user_id: userId, token, live_notif: liveNotif, announcement_notif: announcementNotif, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );

    if (error) {
      console.warn('[savePushToken] Supabase error:', error.message);
      return;
    }

    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, cacheValue);
    console.log('[savePushToken] token saved: live_notif=%s token=%s', liveNotif, token);
  } catch (e) {
    if (isTransientPushError(e) && attempt <= PUSH_TOKEN_RETRY_DELAYS_MS.length) {
      // Expo server is temporarily unavailable — retry after backoff delay.
      // Non-blocking: does not stall the caller.
      const delay = PUSH_TOKEN_RETRY_DELAYS_MS[attempt - 1];
      console.warn(`[savePushToken] transient error (attempt ${attempt}), retrying in ${delay / 1000}s`);
      setTimeout(() => { savePushToken(attempt + 1); }, delay);
      return;
    }
    // Silence known non-fatal conditions that are expected in certain environments:
    // - "physical device" → running in simulator or Expo Go
    // - "Permission not granted" → user declined notification permission
    // - "Missing EAS projectId" → dev build without EAS config
    // - "not fully supported" → Expo Go SDK 53+ limitation message
    // - "Keychain access failed" → iOS keychain locked (device locked, simulator cold boot)
    // - "getRegistrationInfoAsync" → same keychain failure surfaced from native layer
    const msg = (e as Error)?.message ?? String(e);
    const isSilent =
      msg.includes('physical device') ||
      msg.includes('Permission not granted') ||
      msg.includes('Missing EAS projectId') ||
      msg.includes('not fully supported') ||
      msg.includes('Keychain access failed') ||
      msg.includes('getRegistrationInfoAsync') ||
      msg.includes('User interaction is not allowed');
    if (!isSilent) console.warn('[savePushToken]', e);
  }
}

// ── Zakat reminder notifications ─────────────────────────────────────────────
// Two notifications per year:
//   1. Advance: N days before the Hijri date.
//   2. Exact:   On the Hijri date itself.
// Both carry data.screen = 'zakatResult' for deep-link navigation.

const ZAKAT_ADVANCE_ID = 'andalus-zakat-advance';
const ZAKAT_EXACT_ID   = 'andalus-zakat-exact';

export async function scheduleZakatAdvanceNotification(date: Date): Promise<void> {
  if (!N) return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;
    await N.scheduleNotificationAsync({
      identifier: ZAKAT_ADVANCE_ID,
      content: {
        title: 'Zakat-påminnelse',
        body:  'Din årliga zakat närmar sig',
        sound: true,
        data:  { type: 'zakatReminder', screen: 'zakatResult' },
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date,
      },
    });
  } catch {}
}

export async function scheduleZakatExactNotification(date: Date): Promise<void> {
  if (!N) return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;
    await N.scheduleNotificationAsync({
      identifier: ZAKAT_EXACT_ID,
      content: {
        title: 'Zakat idag',
        body:  'Det är dags för din årliga zakat',
        sound: true,
        data:  { type: 'zakatReminder', screen: 'zakatResult' },
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date,
      },
    });
  } catch {}
}

export async function cancelZakatNotifications(): Promise<void> {
  if (!N) return;
  try {
    await Promise.all([
      N.cancelScheduledNotificationAsync(ZAKAT_ADVANCE_ID).catch(() => {}),
      N.cancelScheduledNotificationAsync(ZAKAT_EXACT_ID).catch(() => {}),
    ]);
  } catch {}
}

// ── Allah's 99 Names daily notification ──────────────────────────────────────
// Fires every day at 10:00 local time with the next name in sequential rotation.
// Schedules the next 30 days in advance so notifications fire even if the app
// isn't opened daily. Re-synced on app startup and when the toggle changes.

const ALLAH_NAMES_PREFIX        = 'andalus-allah-names-';
const ALLAH_NAMES_ENABLED_KEY   = 'allahNamesNotificationEnabled';
// Bump this when fire time or schedule logic changes — forces a re-schedule for all users.
// v5: reduced look-ahead window from 30 → 14 days to free notification slots for
// the extended 7-day prayer schedule (iOS 64 pending limit per app).
// v6: fire time moved from 09:00 → 10:00.
const ALLAH_NAMES_SCHEDULE_VERSION     = '6';
const ALLAH_NAMES_SCHEDULE_VERSION_KEY = 'allahNamesScheduleVersion';
const ALLAH_NAMES_DAYS_AHEAD           = 14;

// Fixed epoch — do not change. Makes the rotation deterministic across devices.
const ALLAH_NAMES_EPOCH_MS = new Date('2025-01-01T00:00:00Z').getTime();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ALLAH_NAMES_DATA: { nr: number; arabic: string; transliteration: string; forklaring: string }[] =
  require('../app/asmaul_husna.json');

/** Returns the 0-based index into ALLAH_NAMES_DATA for a given local Date.
 *  Uses noon of the given local date to avoid UTC/local-midnight mismatches:
 *  in UTC+2 (Sweden), between 00:00–02:00 local the UTC day is still the
 *  previous day, which would assign the wrong name to the new local day. */
function allahNamesIndexForDate(localDate: Date): number {
  const noon = new Date(localDate.getFullYear(), localDate.getMonth(), localDate.getDate(), 12, 0, 0, 0);
  const daysSinceEpoch = Math.floor((noon.getTime() - ALLAH_NAMES_EPOCH_MS) / 86_400_000);
  return ((daysSinceEpoch % ALLAH_NAMES_DATA.length) + ALLAH_NAMES_DATA.length) %
    ALLAH_NAMES_DATA.length;
}

const ALLAH_NAMES_HOUR = 10; // Daily notification time — 10:00

/** Schedules daily 10:00 notifications for the next ALLAH_NAMES_DAYS_AHEAD days.
 *  Each notification carries the sequential name for that calendar day.
 *  Window kept short so the iOS 64-pending-notification budget leaves room for
 *  the 7-day prayer schedule (35 slots) and other reminders. */
export async function scheduleAllahNamesNotifications(): Promise<void> {
  if (!N) return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;

    await cancelAllahNamesNotifications();

    const now = new Date();

    for (let dayOffset = 0; dayOffset < ALLAH_NAMES_DAYS_AHEAD; dayOffset++) {
      const fire = new Date(now);
      fire.setDate(fire.getDate() + dayOffset);
      fire.setHours(ALLAH_NAMES_HOUR, 0, 0, 0);
      if (fire <= now) continue; // already past fire time today — skip

      const idx  = allahNamesIndexForDate(fire);
      const name = ALLAH_NAMES_DATA[idx];
      const dateKey = fire.toISOString().slice(0, 10); // YYYY-MM-DD

      await N.scheduleNotificationAsync({
        identifier: `${ALLAH_NAMES_PREFIX}${dateKey}`,
        content: {
          title: `${name.transliteration} - ${name.arabic}`,
          body:  name.forklaring,
          sound: true,
          data:  { screen: 'asmaul', nameNr: name.nr },
        },
        trigger: {
          type: N.SchedulableTriggerInputTypes.DATE,
          date: fire,
        },
      });
    }
    console.log(`[AllahNames] Scheduled ${ALLAH_NAMES_DAYS_AHEAD}-day notifications at 10:00`);
  } catch (e) {
    console.warn('[AllahNames] scheduleAllahNamesNotifications error:', e);
  }
}

export async function cancelAllahNamesNotifications(): Promise<void> {
  if (!N) return;
  try {
    const all  = await N.getAllScheduledNotificationsAsync();
    const ours = all.filter(n => n.identifier.startsWith(ALLAH_NAMES_PREFIX));
    await Promise.all(ours.map(n => N!.cancelScheduledNotificationAsync(n.identifier)));
  } catch {}
}

export async function enableAllahNamesReminder(): Promise<void> {
  await AsyncStorage.setItem(ALLAH_NAMES_ENABLED_KEY, 'true');
  await scheduleAllahNamesNotifications();
}

export async function disableAllahNamesReminder(): Promise<void> {
  await AsyncStorage.setItem(ALLAH_NAMES_ENABLED_KEY, 'false');
  await cancelAllahNamesNotifications();
}

/** Called once at app startup. Re-schedules if enabled but scheduler is stale
 *  (e.g. after OS purge, reinstall, 30-day window rolled forward, or schedule
 *  version bumped to force a time/logic change for all users). */
export async function syncAllahNamesReminderOnStartup(): Promise<void> {
  try {
    const onboarded = await AsyncStorage.getItem('islamnu_onboarding_completed');
    if (!onboarded) return; // new user — wait until after onboarding

    const enabled = await AsyncStorage.getItem(ALLAH_NAMES_ENABLED_KEY);
    if (enabled === 'false') return; // explicitly disabled
    // null (never set) = default on

    if (!N) return;

    // Force re-schedule if the schedule version has changed (e.g. fire time updated).
    const savedVersion = await AsyncStorage.getItem(ALLAH_NAMES_SCHEDULE_VERSION_KEY);
    if (savedVersion !== ALLAH_NAMES_SCHEDULE_VERSION) {
      await scheduleAllahNamesNotifications();
      await AsyncStorage.setItem(ALLAH_NAMES_SCHEDULE_VERSION_KEY, ALLAH_NAMES_SCHEDULE_VERSION);
      return;
    }

    const existing = await N.getAllScheduledNotificationsAsync();
    const ours = existing.filter(n => n.identifier.startsWith(ALLAH_NAMES_PREFIX));

    // Check if today's notification is missing and fire time hasn't passed yet.
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const todayFireTime = new Date(now);
    todayFireTime.setHours(ALLAH_NAMES_HOUR, 0, 0, 0);
    const todayMissing =
      now < todayFireTime &&
      !ours.some(n => n.identifier === `${ALLAH_NAMES_PREFIX}${todayKey}`);

    // Re-schedule if fewer than 7 days remain OR today's notification is missing.
    if (ours.length < 7 || todayMissing) {
      await scheduleAllahNamesNotifications();
    }
  } catch (e) {
    console.warn('[AllahNames] syncAllahNamesReminderOnStartup error:', e);
  }
}

// ── Announcement push notification ───────────────────────────────────────────
// Fires an immediate local push notification for a banner announcement.
// Deduplication (one notification per unique id+updated_at) is enforced by
// the caller (HomeScreen announcement fetch logic).
const ANNOUNCEMENT_PREFIX = 'andalus-announcement-';

export async function sendAnnouncementNotification(id: string, title: string, body: string): Promise<void> {
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      identifier: ANNOUNCEMENT_PREFIX + id,
      content: { title, body: body || '', sound: true },
      trigger: {
        type:    N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        repeats: false,
      },
    });
  } catch {}
}

// ── Pre-prayer reminders (2-day rolling schedule) ────────────────────────────
// Schedules a reminder X minutes before each of the 5 daily prayers for the
// next 2 days. Self-contained: reads location and settings from AsyncStorage.
// Window reduced from 5 → 2 days so the iOS 64-pending-notification budget
// fits the 7-day prayer schedule + 14-day Allah's Names + other reminders.

export type PrayerReminderOffset = 'off' | 15 | 30 | 45 | 60;
export const PRE_PRAYER_REMINDER_STORAGE_KEY = 'hidayah_prayer_reminder_offset';
const PRE_PRAYER_REMINDER_PREFIX = 'hidayah-pre-prayer-';
const PRE_PRAYER_KEYS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;

/** Fetches the 5 prayer times for a single date from Aladhan. */
async function fetchDayTimings(
  lat: number, lng: number, date: Date, method: number, school: number,
): Promise<Record<string, string> | null> {
  try {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const url =
      `https://api.aladhan.com/v1/timings/${d}-${m}-${y}` +
      `?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const t = json?.data?.timings;
    if (!t) return null;
    const strip = (s: string) => (s ? s.replace(/\s*\(.*\)/, '').trim() : '');
    return {
      Fajr: strip(t.Fajr), Dhuhr: strip(t.Dhuhr),
      Asr:  strip(t.Asr),  Maghrib: strip(t.Maghrib), Isha: strip(t.Isha),
    };
  } catch { return null; }
}

export async function cancelPrePrayerReminders(): Promise<void> {
  if (!N) return;
  try {
    const all  = await N.getAllScheduledNotificationsAsync();
    const ours = all.filter(n => n.identifier.startsWith(PRE_PRAYER_REMINDER_PREFIX));
    await Promise.all(ours.map(n => N!.cancelScheduledNotificationAsync(n.identifier)));
  } catch {}
}

/** Reads the saved offset, cancels old pre-prayer reminders, then schedules
 *  reminders for the next 5 days. Safe to call frequently — always cancels first.
 *  Does nothing if offset is 'off' or permission is not granted. */
export async function refreshPrePrayerReminderNotifications(): Promise<void> {
  if (!N) return;
  try {
    const raw      = await AsyncStorage.getItem(PRE_PRAYER_REMINDER_STORAGE_KEY);
    const offsetN  = raw ? parseInt(raw, 10) : NaN;
    const VALID    = [15, 30, 45, 60] as const;
    const offset: PrayerReminderOffset = (VALID as readonly number[]).includes(offsetN)
      ? (offsetN as 15 | 30 | 45 | 60)
      : 'off';

    await cancelPrePrayerReminders();
    if (offset === 'off') return;

    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;

    const [locationRaw, settingsRaw] = await Promise.all([
      AsyncStorage.getItem('andalus_location'),
      AsyncStorage.getItem('andalus_settings'),
    ]);
    if (!locationRaw) return;

    const loc      = JSON.parse(locationRaw) as { lat: number; lng: number };
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    const method: number = settings.calculationMethod ?? 3;
    const school: number = settings.school ?? 0;
    const prayerSource: string = settings.prayerSource ?? 'aladhan';
    const ifisCity: string     = settings.ifisCity ?? 'stockholm';

    const now           = new Date();
    const offsetMinutes = offset as number;

    let daySets: { date: Date; times: Record<string, string> | null }[];

    const PRE_PRAYER_DAYS_AHEAD = 2;
    if (prayerSource === 'ifis') {
      daySets = await Promise.all(
        Array.from({ length: PRE_PRAYER_DAYS_AHEAD }, async (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
          const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          try {
            const times = await getIfisTimesForDate(ifisCity, dateKey);
            return { date: d, times };
          } catch {
            console.warn(`[PrePrayerReminder] IFIS fetch failed for ${dateKey} — skipping day`);
            return { date: d, times: null };
          }
        }),
      );
    } else {
      daySets = await Promise.all(
        Array.from({ length: PRE_PRAYER_DAYS_AHEAD }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
          return fetchDayTimings(loc.lat, loc.lng, d, method, school).then(times => ({ date: d, times }));
        }),
      );
    }

    for (const { date, times } of daySets) {
      if (!times) continue;
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      for (const key of PRE_PRAYER_KEYS) {
        const timeStr = times[key];
        if (!timeStr) continue;
        const [hh, mm] = timeStr.split(':').map(Number);
        if (isNaN(hh) || isNaN(mm)) continue;
        const totalMin = hh * 60 + mm - offsetMinutes;
        if (totalMin < 0) continue;
        const fire = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(totalMin / 60), totalMin % 60, 0, 0);
        if (fire <= now) continue;
        await N!.scheduleNotificationAsync({
          identifier: `${PRE_PRAYER_REMINDER_PREFIX}${dateKey}-${key.toLowerCase()}`,
          content: {
            title: `${key} närmar sig`,
            body:  `${offsetMinutes} min kvar`,
            sound: true,
            data: {
              type:          'pre-prayer-reminder',
              prayerKey:     key.toLowerCase(),
              prayerName:    key,
              offsetMinutes,
            },
          },
          trigger: {
            type: N!.SchedulableTriggerInputTypes.DATE,
            date: fire,
          },
        });
      }
    }
    console.log(`[PrePrayerReminder] Scheduled ${PRE_PRAYER_DAYS_AHEAD}-day reminders (${offsetMinutes} min)`);
  } catch (e) {
    console.warn('[PrePrayerReminder] refreshPrePrayerReminderNotifications error:', e);
  }
}

// ── Friday Al-Kahf reminder ───────────────────────────────────────────────────

const KAHF_ID           = 'andalus-kahf-friday';
const KAHF_ENABLED_KEY  = 'kahfReminderEnabled';
const KAHF_SCHEDULED_KEY = 'kahfReminderScheduled';

// Schedules a weekly Friday 14:00 notification.
// Always checks the real scheduler — never double-schedules.
export async function scheduleFridayKahfReminder(): Promise<void> {
  if (!N) { console.log('[Kahf] expo-notifications not available'); return; }
  try {
    const existing = await N.getAllScheduledNotificationsAsync();
    if (existing.some(n => n.identifier === KAHF_ID)) {
      console.log('[Kahf] Already in scheduler — skipping');
      await AsyncStorage.setItem(KAHF_SCHEDULED_KEY, 'true');
      return;
    }

    // Never auto-request here — onboarding/settings is responsible for that.
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;

    await N.scheduleNotificationAsync({
      identifier: KAHF_ID,
      content: {
        body:  'Glöm inte att läsa Surah Al-Kahf idag. Må Allah lysa upp din vecka.',
        sound: true,
        data:  { screen: 'quran', page: '293' }, // Surah 18 börjar på sida 293
      },
      trigger: {
        type:    N.SchedulableTriggerInputTypes.CALENDAR,
        weekday: 6,   // iOS calendar: 1=Sunday … 6=Friday … 7=Saturday
        hour:    14,
        minute:  0,
        repeats: true,
      } as any,
    });

    await AsyncStorage.setItem(KAHF_SCHEDULED_KEY, 'true');
    console.log('[Kahf] Scheduled — every Friday at 14:00');
  } catch (e) {
    console.warn('[Kahf] scheduleFridayKahfReminder error:', e);
  }
}

// Cancels the Friday Al-Kahf notification and clears the scheduled flag.
export async function cancelFridayKahfReminder(): Promise<void> {
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(KAHF_ID);
    await AsyncStorage.setItem(KAHF_SCHEDULED_KEY, 'false');
    console.log('[Kahf] Cancelled');
  } catch (e) {
    console.warn('[Kahf] cancelFridayKahfReminder error:', e);
  }
}

// Saves enabled=true and schedules the notification.
export async function enableKahfReminder(): Promise<void> {
  console.log('[Kahf] Enabling');
  await AsyncStorage.setItem(KAHF_ENABLED_KEY, 'true');
  await scheduleFridayKahfReminder();
}

// Saves enabled=false and cancels the notification.
export async function disableKahfReminder(): Promise<void> {
  console.log('[Kahf] Disabling');
  await AsyncStorage.setItem(KAHF_ENABLED_KEY, 'false');
  await cancelFridayKahfReminder();
}

// Called once at app startup: re-schedules if enabled but not in the scheduler
// (e.g. after reinstall or OS notification purge).
// Skipped for new users who haven't completed onboarding — permission hasn't
// been granted yet and we must not trigger an iOS dialog before the welcome screen.
export async function syncKahfReminderOnStartup(): Promise<void> {
  try {
    const onboarded = await AsyncStorage.getItem('islamnu_onboarding_completed');
    if (!onboarded) return; // new user — wait until after onboarding

    const enabled = await AsyncStorage.getItem(KAHF_ENABLED_KEY);
    console.log('[Kahf] Startup sync — enabled:', enabled);
    if (enabled === 'false') return; // null (never set) = default on
    if (!N) { console.log('[Kahf] expo-notifications not available'); return; }
    const existing = await N.getAllScheduledNotificationsAsync();
    const scheduled = existing.find(n => n.identifier === KAHF_ID);
    console.log('[Kahf] Startup sync — found in scheduler:', !!scheduled);

    // Re-schedule if missing OR if the stored notification lacks the deep-link data payload
    // (users who had the old version without data need an automatic upgrade).
    const hasDeepLink = !!(scheduled?.content?.data as Record<string, unknown> | undefined)?.screen;
    if (!scheduled || !hasDeepLink) {
      console.log('[Kahf] Not scheduled or missing deep-link — rescheduling');
      await scheduleFridayKahfReminder();
    }
  } catch (e) {
    console.warn('[Kahf] syncKahfReminderOnStartup error:', e);
  }
}

