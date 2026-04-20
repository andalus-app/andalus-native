import React, { createContext, useContext, useReducer, useEffect, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { fetchPrayerTimes, fetchTomorrowPrayerTimes, calcMidnight, reverseGeocode } from '../services/prayerApi';
import { buildYearlyCache } from '../services/monthlyCache';
import { schedulePrayerNotifications, cancelPrayerNotifications, scheduleDhikrReminder, cancelDhikrReminder, scheduleFridayDuaReminder, cancelFridayDuaReminder } from '../services/notifications';
import { updateWidgetData } from '../modules/WidgetData';

// ── Samma CALC_METHODS som PWA (method=3 = Muslim World League) ──
export const CALC_METHODS = {
  3:  'Muslim World League',
  2:  'Islamiska Sällskapet Nordamerika (ISNA)',
  5:  'Egyptiska Myndigheten',
  4:  'Umm Al-Qura, Mecka',
  1:  'Karachi – Islamiska Vetenskaper',
  7:  'Teheran – Geofysikinstitutet',
  8:  'Gulfregionen',
  9:  'Kuwait',
  10: 'Qatar',
  11: 'Singapore',
  12: 'Islamiska Förbundet Frankrike',
  13: 'Diyanet, Turkiet',
  14: 'Muslimer i Ryssland',
  15: 'Moonsighting Committee (Nordamerika)',
};

const STORAGE_KEY = 'andalus_app_state';
const CACHE_KEY   = 'andalus_prayer_cache';

function getTodayStr() {
  const n = new Date();
  return String(n.getDate()).padStart(2,'0')+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+n.getFullYear();
}

type LocationType = { latitude: number; longitude: number; city: string; country: string } | null;
type Settings = { calculationMethod: number; school: number; notifications: boolean; announcementNotifications: boolean; autoLocation: boolean; dhikrReminder: boolean; fridayDuaReminder: boolean };
type Timings  = Record<string, string> | null;

type State = {
  prayerTimes:   Timings;
  tomorrowTimes: Timings;
  hijriDate:     any;
  location:      LocationType;
  settings:      Settings;
  isLoading:     boolean;
  error:         string | null;
};

const DEFAULT_SETTINGS: Settings = {
  calculationMethod:        3,
  school:                   0,
  notifications:            true,
  announcementNotifications: true,
  autoLocation:             true,
  dhikrReminder:            false,
  fridayDuaReminder:        true,
};

const initialState: State = {
  prayerTimes:   null,
  tomorrowTimes: null,
  hijriDate:     null,
  location:      null,
  settings:      DEFAULT_SETTINGS,
  isLoading:     false,
  error:         null,
};

type Action =
  | { type: 'SET_PRAYER_TIMES';   payload: Timings }
  | { type: 'SET_TOMORROW_TIMES'; payload: Timings }
  | { type: 'SET_HIJRI';          payload: any }
  | { type: 'SET_LOCATION';       payload: LocationType }
  | { type: 'SET_SETTINGS';       payload: Partial<Settings> }
  | { type: 'SET_LOADING';        payload: boolean }
  | { type: 'SET_ERROR';          payload: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_PRAYER_TIMES':   return { ...state, prayerTimes:   action.payload };
    case 'SET_TOMORROW_TIMES': return { ...state, tomorrowTimes: action.payload };
    case 'SET_HIJRI':          return { ...state, hijriDate:     action.payload };
    case 'SET_LOCATION':       return { ...state, location:      action.payload };
    case 'SET_SETTINGS':       return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'SET_LOADING':        return { ...state, isLoading:     action.payload };
    case 'SET_ERROR':          return { ...state, error:         action.payload };
    default: return state;
  }
}

type ContextType = State & {
  dispatch: React.Dispatch<Action>;
  refreshPrayers: () => Promise<void>;
  refreshLocation: () => Promise<void>;
};

const AppContext = createContext<ContextType | null>(null);

// ── Cache helpers (samma logik som PWA) ──
async function getCached(loc: LocationType, method: number, school: number) {
  if (!loc) return null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const key = loc.latitude.toFixed(4)+','+loc.longitude.toFixed(4)+','+method+','+school;
    if (cached.key !== key) return null;
    if (cached.date !== getTodayStr()) return null;
    return cached;
  } catch { return null; }
}

async function setCached(loc: LocationType, method: number, school: number, todayT: any, tomT: any, hijri: any) {
  if (!loc) return;
  try {
    const key = loc.latitude.toFixed(4)+','+loc.longitude.toFixed(4)+','+method+','+school;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ key, date: getTodayStr(), todayT, tomT, hijri }));
  } catch {}
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const lastFetchRef = useRef<string | null>(null);

  // ── Ladda sparad state vid start ──
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.location) dispatch({ type: 'SET_LOCATION', payload: saved.location });
          if (saved.settings) dispatch({ type: 'SET_SETTINGS', payload: saved.settings });
        }
      } catch {}
    })();
  }, []);

  // ── Spara location + settings till AsyncStorage (samma som PWA:s localStorage) ──
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      location: state.location,
      settings: state.settings,
    })).catch(() => {});
  }, [state.location, state.settings]);

  // ── Hämta bönetider automatiskt när location/method/school ändras ──
  // EXAKT samma useEffect-mönster som PWA:n: [location, calculationMethod, school]
  useEffect(() => {
    if (!state.location) return;
    lastFetchRef.current = null; // tvinga ny hämtning vid ändring
    loadPrayers(state.location, state.settings.calculationMethod, state.settings.school);
  }, [state.location, state.settings.calculationMethod, state.settings.school]); // eslint-disable-line

  async function loadPrayers(loc: LocationType, method: number, school: number) {
    if (!loc) return;
    const key = loc.latitude.toFixed(4)+','+loc.longitude.toFixed(4)+','+method+','+school;
    if (lastFetchRef.current === key) return;
    lastFetchRef.current = key;

    // Visa cache direkt (ingen laddningsflash) — samma som PWA
    const cached = await getCached(loc, method, school);
    if (cached) {
      dispatch({ type: 'SET_PRAYER_TIMES',   payload: cached.todayT });
      dispatch({ type: 'SET_TOMORROW_TIMES', payload: cached.tomT });
      dispatch({ type: 'SET_HIJRI',          payload: cached.hijri });
      dispatch({ type: 'SET_ERROR',          payload: null });
    }

    dispatch({ type: 'SET_LOADING', payload: !cached }); // spinner bara vid första laddning utan cache
    dispatch({ type: 'SET_ERROR',   payload: null });

    try {
      const todayStr = getTodayStr();
      const [todayRes, tomTimings] = await Promise.all([
        fetchPrayerTimes(loc.latitude, loc.longitude, todayStr, method, school),
        fetchTomorrowPrayerTimes(loc.latitude, loc.longitude, method, school),
      ]);

      // Beräkna halva natten
      const todayT = { ...todayRes.timings, Midnight: calcMidnight(todayRes.timings.Maghrib, tomTimings.Fajr) || '' };
      const tomT   = { ...tomTimings, Midnight: '' };

      dispatch({ type: 'SET_PRAYER_TIMES',   payload: todayT });
      dispatch({ type: 'SET_TOMORROW_TIMES', payload: tomT });
      dispatch({ type: 'SET_HIJRI',          payload: todayRes.hijri });
      dispatch({ type: 'SET_ERROR',          payload: null });
      await setCached(loc, method, school, todayT, tomT, todayRes.hijri);

      // Write data to App Group shared container for iOS widgets.
      // Only on iOS — no-op on other platforms.
      if (Platform.OS === 'ios') {
        const h = todayRes.hijri;
        const dateFormatter = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short' });
        const todayIso = new Date().toISOString().slice(0, 10); // "yyyy-MM-dd"
        updateWidgetData({
          city: loc.city,
          latitude: loc.latitude,
          longitude: loc.longitude,
          prayers: [
            { name: 'Fajr',       time: todayT.Fajr    ?? '' },
            { name: 'Soluppgång', time: todayT.Sunrise  ?? '' },
            { name: 'Dhuhr',      time: todayT.Dhuhr   ?? '' },
            { name: 'Asr',        time: todayT.Asr     ?? '' },
            { name: 'Maghrib',    time: todayT.Maghrib ?? '' },
            { name: 'Isha',       time: todayT.Isha    ?? '' },
          ],
          hijri: {
            day:         parseInt(h?.day  ?? '0', 10),
            monthNumber: parseInt(h?.month?.number ?? '0', 10),
            monthNameEn: h?.month?.en ?? '',
            year:        parseInt(h?.year ?? '0', 10),
          },
          date:      todayIso,
          timestamp: Date.now() / 1000,
        }).catch(() => {
          // Non-fatal — widget will continue showing previous data
        });
      }

      // Pre-cache all 12 months in the background (fire-and-forget)
      buildYearlyCache(
        new Date().getFullYear(),
        loc.latitude, loc.longitude,
        method, school,
      ).catch(() => {});
    } catch {
      lastFetchRef.current = null; // tillåt retry
      if (!cached) dispatch({ type: 'SET_ERROR', payload: 'offline' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }

  // ── Hämta GPS + uppdatera plats ──
  // Begär foreground, sedan background (för widget). Kallar loadPrayers automatiskt
  // via SET_LOCATION-effekten ovan.
  async function refreshLocation() {
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') return;

      // Försök be om bakgrundsbehörighet (krävs för att widgeten ska uppdateras).
      // iOS visar ett separat systemdialog — ignorera fel om det nekas.
      try {
        const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
        if (bgStatus !== 'granted') {
          await Location.requestBackgroundPermissionsAsync();
        }
      } catch {}

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const geo = await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      dispatch({ type: 'SET_LOCATION', payload: {
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
        city:      geo.city,
        country:   geo.country,
      }});
    } catch {}
  }

  // ── Tvinga ny hämtning (ignorerar cache) ──
  async function refreshPrayers() {
    lastFetchRef.current = null;
    if (state.location) {
      await loadPrayers(state.location, state.settings.calculationMethod, state.settings.school);
    }
  }

  // ── Schedule / cancel prayer notifications whenever relevant state changes ──
  useEffect(() => {
    if (!state.prayerTimes || !state.location) return;
    if (!state.settings.notifications) {
      cancelPrayerNotifications().catch(() => {});
    } else {
      schedulePrayerNotifications(
        state.prayerTimes,
        state.tomorrowTimes,
        state.location.city,
      ).catch(() => {});
    }
    // Dhikr reminder: 1 hour before Maghrib — independent of the main prayer toggle
    if (!state.settings.dhikrReminder) {
      cancelDhikrReminder().catch(() => {});
    } else if (state.prayerTimes.Maghrib) {
      scheduleDhikrReminder(
        state.prayerTimes.Maghrib,
        state.tomorrowTimes?.Maghrib ?? null,
      ).catch(() => {});
    }
    // Friday Last Hour (Jumu'ah) dua reminder: 30 min before Maghrib on Fridays only
    if (!state.settings.fridayDuaReminder) {
      cancelFridayDuaReminder().catch(() => {});
    } else if (state.prayerTimes.Maghrib) {
      scheduleFridayDuaReminder(
        state.prayerTimes.Maghrib,
        state.tomorrowTimes?.Maghrib ?? null,
      ).catch(() => {});
    }
  }, [state.prayerTimes, state.tomorrowTimes, state.settings.notifications, state.settings.dhikrReminder, state.settings.fridayDuaReminder, state.location?.city]); // eslint-disable-line

  const value = useMemo(() => ({ ...state, dispatch, refreshPrayers, refreshLocation }), [state]); // eslint-disable-line

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
