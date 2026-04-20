/**
 * Zakat Reminder Service
 *
 * Single source of truth for the annual Hijri-based Zakat reminder.
 * All state lives in AsyncStorage. No server calls — purely local.
 *
 * Key:  andalus_zakat_reminder_v1
 * Type: ZakatReminderSettings
 *
 * Public API:
 *   loadZakatReminderSettings()         → read current settings (or null)
 *   saveZakatReminderSettings(s)        → persist settings
 *   setupZakatReminderFromToday(days)   → first-time setup using today's Hijri
 *   enableZakatReminder(settings)       → set enabled=true + sync
 *   disableZakatReminder()              → set enabled=false + cancel notifications
 *   syncZakatReminders()                → recalculate + reschedule notifications
 *   syncZakatRemindersOnStartup()       → safe startup wrapper
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getTodayHijri,
  nextGregorianForHijri,
  HIJRI_MONTH_NAMES,
} from './hijriCalendarService';
import {
  scheduleZakatAdvanceNotification,
  scheduleZakatExactNotification,
  cancelZakatNotifications,
} from './notifications';

// ── Storage key ───────────────────────────────────────────────────────────────

export const ZAKAT_REMINDER_KEY = 'andalus_zakat_reminder_v1';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZakatReminderSettings = {
  /** Master on/off flag — single source of truth. */
  enabled: boolean;

  /** Hijri day of the annual reminder (1–29/30). */
  hijriDay: number;
  /** Hijri month of the annual reminder (1–12). */
  hijriMonth: number;
  /** Display name for the month (English transliteration). */
  hijriMonthName: string;

  /** How many days before the exact day to send the advance notification. */
  advanceDays: number;

  /** Time of day for both notifications (local time). */
  reminderTimeHour: number;   // 10
  reminderTimeMinute: number; // 0

  /** Hijri date source — always 'aladhan'. */
  source: 'aladhan';

  /**
   * Gregorian year that was used when last scheduling.
   * Used to detect when a re-schedule is needed after a year rolls over.
   */
  lastScheduledForGregorianYear?: number;

  createdAt: string; // ISO
  updatedAt: string; // ISO
};

// ── Advance-day options ───────────────────────────────────────────────────────

export const ADVANCE_OPTIONS: { days: number; label: string }[] = [
  { days: 1,  label: '1 dag innan'    },
  { days: 2,  label: '2 dagar innan'  },
  { days: 3,  label: '3 dagar innan'  },
  { days: 4,  label: '4 dagar innan'  },
  { days: 5,  label: '5 dagar innan'  },
  { days: 6,  label: '6 dagar innan'  },
  { days: 7,  label: '7 dagar innan'  },
  { days: 14, label: '2 veckor innan' },
  { days: 21, label: '3 veckor innan' },
  { days: 30, label: '1 månad innan'  },
];

// ── Read / write ──────────────────────────────────────────────────────────────

export async function loadZakatReminderSettings(): Promise<ZakatReminderSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(ZAKAT_REMINDER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ZakatReminderSettings;
  } catch { return null; }
}

export async function saveZakatReminderSettings(
  s: ZakatReminderSettings,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      ZAKAT_REMINDER_KEY,
      JSON.stringify({ ...s, updatedAt: new Date().toISOString() }),
    );
  } catch {}
}

// ── First-time setup ──────────────────────────────────────────────────────────

/**
 * Create a new reminder anchored to today's Hijri date.
 * Fetches the Hijri date from AlAdhan — throws if the network is unavailable.
 * Does NOT schedule notifications (call syncZakatReminders after).
 */
export async function setupZakatReminderFromToday(
  advanceDays: number,
): Promise<ZakatReminderSettings> {
  const hijri = await getTodayHijri();
  const now = new Date().toISOString();

  const settings: ZakatReminderSettings = {
    enabled: true,
    hijriDay:       hijri.day,
    hijriMonth:     hijri.month,
    hijriMonthName: HIJRI_MONTH_NAMES[hijri.month] ?? hijri.monthName,
    advanceDays,
    reminderTimeHour:   10,
    reminderTimeMinute: 0,
    source: 'aladhan',
    createdAt: now,
    updatedAt: now,
  };

  await saveZakatReminderSettings(settings);
  return settings;
}

// ── Enable / disable ──────────────────────────────────────────────────────────

/** Set enabled=true on existing settings and sync. */
export async function enableZakatReminder(
  settings: ZakatReminderSettings,
): Promise<void> {
  const updated: ZakatReminderSettings = { ...settings, enabled: true };
  await saveZakatReminderSettings(updated);
  await syncZakatReminders();
}

/** Set enabled=false and cancel all scheduled zakat notifications. */
export async function disableZakatReminder(): Promise<void> {
  const settings = await loadZakatReminderSettings();
  if (settings) {
    await saveZakatReminderSettings({ ...settings, enabled: false });
  }
  await cancelZakatNotifications();
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/**
 * Calculate the next Hijri occurrence and (re-)schedule notifications.
 *
 * Always cancels existing zakat notifications first to avoid duplicates.
 * Safe to call multiple times.
 *
 * Notification schedule:
 *   1. Advance: reminderTimeHour:reminderTimeMinute, `advanceDays` before the exact day.
 *   2. Exact:   reminderTimeHour:reminderTimeMinute on the Hijri day itself.
 *
 * Silently does nothing if:
 *   - settings are missing / disabled
 *   - dates are in the past (both notifications in the past = nothing scheduled)
 *   - network is unavailable (AlAdhan API call fails)
 */
export async function syncZakatReminders(): Promise<void> {
  try {
    // Always cancel first — no duplicates
    await cancelZakatNotifications();

    const settings = await loadZakatReminderSettings();
    if (!settings?.enabled) return;
    if (!settings.hijriDay || !settings.hijriMonth) return;

    // Get current Hijri date to find next occurrence
    const currentHijri = await getTodayHijri();

    // Convert to Gregorian midnight
    const exactMidnight = await nextGregorianForHijri(
      settings.hijriDay,
      settings.hijriMonth,
      currentHijri,
    );

    const now = new Date();

    // Exact-day notification
    const exactFire = new Date(exactMidnight);
    exactFire.setHours(settings.reminderTimeHour, settings.reminderTimeMinute, 0, 0);
    if (exactFire > now) {
      await scheduleZakatExactNotification(exactFire);
    }

    // Advance notification
    const advanceFire = new Date(exactMidnight);
    advanceFire.setDate(advanceFire.getDate() - settings.advanceDays);
    advanceFire.setHours(settings.reminderTimeHour, settings.reminderTimeMinute, 0, 0);
    if (advanceFire > now) {
      await scheduleZakatAdvanceNotification(advanceFire);
    }

    // Record the Gregorian year so we can detect year-roll in future syncs
    await saveZakatReminderSettings({
      ...settings,
      lastScheduledForGregorianYear: exactFire.getFullYear(),
    });
  } catch (e) {
    console.warn('[ZakatReminder] syncZakatReminders error:', e);
  }
}

/** Update the time of day for both notifications and reschedule. */
export async function updateZakatReminderTime(
  hour: number,
  minute: number,
): Promise<void> {
  const settings = await loadZakatReminderSettings();
  if (!settings) return;
  await saveZakatReminderSettings({
    ...settings,
    reminderTimeHour:   hour,
    reminderTimeMinute: minute,
  });
  if (settings.enabled) await syncZakatReminders();
}

/**
 * Safe startup wrapper. Skips gracefully if:
 *   - reminder is disabled
 *   - onboarding not yet completed (permissions not requested)
 */
export async function syncZakatRemindersOnStartup(): Promise<void> {
  try {
    const onboarded = await AsyncStorage.getItem('islamnu_onboarding_completed');
    if (!onboarded) return; // wait until after onboarding

    const settings = await loadZakatReminderSettings();
    if (!settings?.enabled) return;

    await syncZakatReminders();
  } catch (e) {
    console.warn('[ZakatReminder] startup sync error:', e);
  }
}
