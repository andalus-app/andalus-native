import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

// Lazy-load expo-notifications so a missing native module (e.g. in Expo Go or
// before a native rebuild) never crashes the app — all functions degrade to no-ops.
let N: typeof import('expo-notifications') | null = null;
try {
  N = require('expo-notifications');
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

// ── Banner (Google Sheets) notifications ─────────────────────────────────────
const BANNER_PREFIX = 'andalus-msg-';

export async function deliverBannerNotification(id: string, title: string): Promise<void> {
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      identifier: BANNER_PREFIX + id,
      content: { title, body: '', sound: true },
      trigger: {
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        repeats: false,
      },
    });
  } catch {}
}

// ── YouTube live stream notification ─────────────────────────────────────────
// Called at most once per unique videoId (deduplication is enforced by useYoutubeLive)
const LIVE_PREFIX = 'andalus-live-';

export async function sendLiveNotification(videoId: string, title: string): Promise<void> {
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      identifier: LIVE_PREFIX + videoId,
      content: {
        title: 'Direktsändning pågår',
        body:  title,
        sound: true,
        data:  { screen: 'youtube_live' },
      },
      trigger: {
        type:    N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        repeats: false,
      },
    });
  } catch {}
}

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
    console.warn('[PushToken] getExpoPushToken error:', e);
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
    msg.includes('reset before headers')
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
    // Non-fatal permanent errors: simulator, permission denied, missing projectId.
    console.warn('[savePushToken]', e);
  }
}

export async function dismissBannerNotification(id: string): Promise<void> {
  if (!N) return;
  try { await N.dismissNotificationAsync(BANNER_PREFIX + id); } catch {}
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

export async function getDeliveredBannerIds(): Promise<string[]> {
  if (!N) return [];
  try {
    const all = await N.getDeliveredNotificationsAsync();
    return all
      .filter(n => n.request.identifier.startsWith(BANNER_PREFIX))
      .map(n => n.request.identifier.slice(BANNER_PREFIX.length));
  } catch { return []; }
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

