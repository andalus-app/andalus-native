/**
 * useZakatReminder
 *
 * React hook wrapping ZakatReminderService.
 * Provides reactive state + actions for enabling, disabling, and updating
 * the annual Hijri-based Zakat reminder.
 *
 * State lives in AsyncStorage (single source of truth).
 * This hook does NOT own the state — it reflects what's in storage.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ZakatReminderSettings,
  loadZakatReminderSettings,
  saveZakatReminderSettings,
  setupZakatReminderFromToday,
  enableZakatReminder,
  disableZakatReminder,
  syncZakatReminders,
  updateZakatReminderTime,
} from '../services/zakatReminderService';

export type UseZakatReminderReturn = {
  /** Current persisted settings, or null if never configured. */
  settings: ZakatReminderSettings | null;
  /** True while an async operation (enable/disable/setup) is in progress. */
  loading: boolean;
  /**
   * Error string from the last failed enable() call.
   * Cleared on next successful enable().
   */
  setupError: string | null;

  /** Reload settings from AsyncStorage (use in useFocusEffect). */
  reload: () => Promise<void>;
  /**
   * Enable the reminder.
   * - If settings with a hijriDay already exist → re-enables them.
   * - Otherwise → fetches today's Hijri date from AlAdhan and creates new settings.
   * Returns true on success, false if the network call failed.
   */
  enable: (advanceDays?: number) => Promise<boolean>;
  /** Disable the reminder and cancel all scheduled notifications. */
  disable: () => Promise<void>;
  /** Update the advance-days offset and reschedule. */
  updateAdvanceDays: (days: number) => Promise<void>;
  /** Update the Hijri day + month and reschedule. */
  updateHijriDate: (day: number, month: number, monthName: string, meta?: { inputMode?: 'hijri' | 'gregorian'; originalGregorianMonth?: number; originalGregorianDay?: number }) => Promise<void>;
  /** Update the time of day for both notifications and reschedule. */
  updateReminderTime: (hour: number, minute: number) => Promise<void>;
};

export function useZakatReminder(): UseZakatReminderReturn {
  const [settings, setSettings]     = useState<ZakatReminderSettings | null>(null);
  const [loading,  setLoading]      = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Guard against setting state after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reload = useCallback(async () => {
    const s = await loadZakatReminderSettings();
    if (!mountedRef.current) return;
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const enable = useCallback(async (advanceDays = 7): Promise<boolean> => {
    if (!mountedRef.current) return false;
    setLoading(true);
    setSetupError(null);
    try {
      const existing = await loadZakatReminderSettings();

      if (existing?.hijriDay && existing?.hijriMonth) {
        // Re-enable existing configuration
        await enableZakatReminder({ ...existing, enabled: true });
        if (mountedRef.current) setSettings({ ...existing, enabled: true });
      } else {
        // First-time setup — fetch today's Hijri from AlAdhan
        const newSettings = await setupZakatReminderFromToday(advanceDays);
        if (mountedRef.current) setSettings(newSettings);
        // syncZakatReminders is called by enableZakatReminder, but since
        // setupZakatReminderFromToday doesn't call it, we call sync here.
        await syncZakatReminders();
      }

      if (mountedRef.current) setLoading(false);
      return true;
    } catch (e) {
      console.warn('[useZakatReminder] enable error:', e);
      if (mountedRef.current) {
        setSetupError('Kunde inte hämta Hijri-datum. Kontrollera internetanslutningen.');
        setLoading(false);
      }
      return false;
    }
  }, []);

  const disable = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      await disableZakatReminder();
      if (mountedRef.current) {
        setSettings(prev => prev ? { ...prev, enabled: false } : null);
      }
    } catch (e) {
      console.warn('[useZakatReminder] disable error:', e);
    }
    if (mountedRef.current) setLoading(false);
  }, []);

  const updateAdvanceDays = useCallback(async (days: number) => {
    // Optimistically update state, then persist + reschedule
    setSettings(prev => {
      if (!prev) return prev;
      return { ...prev, advanceDays: days };
    });
    const current = await loadZakatReminderSettings();
    if (!current) return;
    const updated = { ...current, advanceDays: days };
    await saveZakatReminderSettings(updated);
    await syncZakatReminders();
  }, []);

  const updateHijriDate = useCallback(async (
    day: number,
    month: number,
    monthName: string,
    meta?: { inputMode?: 'hijri' | 'gregorian'; originalGregorianMonth?: number; originalGregorianDay?: number },
  ) => {
    setSettings(prev => {
      if (!prev) return prev;
      return { ...prev, hijriDay: day, hijriMonth: month, hijriMonthName: monthName };
    });
    const current = await loadZakatReminderSettings();
    if (!current) return;
    const updated = {
      ...current,
      hijriDay: day,
      hijriMonth: month,
      hijriMonthName: monthName,
      ...(meta?.inputMode !== undefined && { inputMode: meta.inputMode }),
      ...(meta?.originalGregorianMonth !== undefined && { originalGregorianMonth: meta.originalGregorianMonth }),
      ...(meta?.originalGregorianDay !== undefined && { originalGregorianDay: meta.originalGregorianDay }),
    };
    await saveZakatReminderSettings(updated);
    await syncZakatReminders();
  }, []);

  const updateReminderTime = useCallback(async (hour: number, minute: number) => {
    setSettings(prev => {
      if (!prev) return prev;
      return { ...prev, reminderTimeHour: hour, reminderTimeMinute: minute };
    });
    await updateZakatReminderTime(hour, minute);
  }, []);

  return { settings, loading, setupError, reload, enable, disable, updateAdvanceDays, updateHijriDate, updateReminderTime };
}
