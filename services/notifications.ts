import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

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

const ID_PREFIX = 'andalus-prayer-';

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

// ── Schedule today + tomorrow ────────────────────────────────────────────────
export async function schedulePrayerNotifications(
  todayTimes:    Record<string, string>,
  tomorrowTimes: Record<string, string> | null,
  cityName:      string,
): Promise<void> {
  if (!N) return;
  try {
    // Ensure permission is granted — this is a no-op if already granted.
    // Critical: without this, scheduleNotificationAsync fails silently if
    // the user never explicitly toggled the setting in Settings.
    // Never auto-request here — onboarding/settings is responsible for that.
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;

    await cancelPrayerNotifications();

    const now    = new Date();
    const today  = new Date();
    const tomRow = new Date();
    tomRow.setDate(tomRow.getDate() + 1);

    const queue = async (key: string, timeStr: string, base: Date, slot: string) => {
      const [hh, mm] = timeStr.split(':').map(Number);
      if (isNaN(hh) || isNaN(mm)) return;
      const fire = new Date(base);
      fire.setHours(hh, mm, 0, 0);
      if (fire <= now) return;
      const name = PRAYERS[key];
      await N!.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${slot}-${key.toLowerCase()}`,
        content: {
          title: `Det är dags för ${name}`,
          body:  `i ${cityName}`,
          sound: true,
        },
        trigger: {
          type: N!.SchedulableTriggerInputTypes.DATE,
          date: fire,
        },
      });
    };

    for (const key of Object.keys(PRAYERS)) {
      if (todayTimes[key])      await queue(key, todayTimes[key],    today,  'today');
      if (tomorrowTimes?.[key]) await queue(key, tomorrowTimes[key], tomRow, 'tomorrow');
    }
  } catch {}
}

// ── Cancel all our notifications ─────────────────────────────────────────────
export async function cancelPrayerNotifications(): Promise<void> {
  if (!N) return;
  try {
    const all  = await N.getAllScheduledNotificationsAsync();
    const ours = all.filter(n => n.identifier.startsWith(ID_PREFIX));
    await Promise.all(ours.map(n => N!.cancelScheduledNotificationAsync(n.identifier)));
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

    // Check if this exact token is already saved to avoid unnecessary upserts
    const saved = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    if (saved === token) return;

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

    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { user_id: userId, token, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );

    if (error) {
      console.warn('[savePushToken] Supabase error:', error.message);
      return;
    }

    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    console.log('[savePushToken] token saved:', token);
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
// Fires every day at 07:00 local time with the next name in sequential rotation.
// Schedules the next 30 days in advance so notifications fire even if the app
// isn't opened daily. Re-synced on app startup and when the toggle changes.

const ALLAH_NAMES_PREFIX        = 'andalus-allah-names-';
const ALLAH_NAMES_ENABLED_KEY   = 'allahNamesNotificationEnabled';
// Bump this when fire time or schedule logic changes — forces a re-schedule for all users.
const ALLAH_NAMES_SCHEDULE_VERSION     = '2';
const ALLAH_NAMES_SCHEDULE_VERSION_KEY = 'allahNamesScheduleVersion';

// Fixed epoch — do not change. Makes the rotation deterministic across devices.
const ALLAH_NAMES_EPOCH_MS = new Date('2025-01-01T00:00:00Z').getTime();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ALLAH_NAMES_DATA: { nr: number; arabic: string; transliteration: string; forklaring: string }[] =
  require('../app/asmaul_husna.json');

/** Returns the 0-based index into ALLAH_NAMES_DATA for a given day offset from today. */
function allahNamesIndex(dayOffset = 0): number {
  const daysSinceEpoch =
    Math.floor((Date.now() - ALLAH_NAMES_EPOCH_MS) / 86_400_000) + dayOffset;
  return ((daysSinceEpoch % ALLAH_NAMES_DATA.length) + ALLAH_NAMES_DATA.length) %
    ALLAH_NAMES_DATA.length;
}

const ALLAH_NAMES_HOUR = 7; // Daily notification time — 07:00

/** Schedules daily 07:00 notifications for the next 30 days.
 *  Each notification carries the sequential name for that calendar day. */
export async function scheduleAllahNamesNotifications(): Promise<void> {
  if (!N) return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;

    await cancelAllahNamesNotifications();

    const now = new Date();

    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const fire = new Date(now);
      fire.setDate(fire.getDate() + dayOffset);
      fire.setHours(ALLAH_NAMES_HOUR, 0, 0, 0);
      if (fire <= now) continue; // already past fire time today — skip

      const idx  = allahNamesIndex(dayOffset);
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
    console.log('[AllahNames] Scheduled 30-day notifications at 07:00');
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

// ── Friday Al-Kahf reminder ───────────────────────────────────────────────────

const KAHF_ID           = 'andalus-kahf-friday';
const KAHF_ENABLED_KEY  = 'kahfReminderEnabled';
const KAHF_SCHEDULED_KEY = 'kahfReminderScheduled';

// Schedules a weekly Friday 13:00 notification.
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
        hour:    13,
        minute:  0,
        repeats: true,
      } as any,
    });

    await AsyncStorage.setItem(KAHF_SCHEDULED_KEY, 'true');
    console.log('[Kahf] Scheduled — every Friday at 13:00');
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

