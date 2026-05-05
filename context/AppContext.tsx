import React, { createContext, useContext, useReducer, useEffect, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { fetchPrayerTimes, fetchTomorrowPrayerTimes, calcMidnight, reverseGeocode } from '../services/prayerApi';
import { startBackgroundLocationUpdates, stopBackgroundLocationUpdates } from '../services/backgroundLocation';
import { buildYearlyCache, getPrayerTimesWithFallback } from '../services/monthlyCache';
import { schedulePrayerNotifications, cancelPrayerNotifications, scheduleDhikrReminder, cancelDhikrReminder, scheduleFridayDuaReminder, cancelFridayDuaReminder, refreshPrePrayerReminderNotifications } from '../services/notifications';
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

type LocationType = { latitude: number; longitude: number; city: string; suburb?: string; country: string } | null;
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

// ── Cache helpers ──
function isCacheToday(dateStr: string): boolean {
  return dateStr === getTodayStr() || dateStr === new Date().toDateString();
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
  // Reads STORAGE_KEY and CACHE_KEY in parallel so prayer times can be hydrated
  // immediately — avoids the two-roundtrip delay that caused "Laddar…" on home screen.
  useEffect(() => {
    (async () => {
      try {
        const [raw, cacheRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(CACHE_KEY),
        ]);

        let savedLocation: LocationType = null;
        let savedSettings: Partial<Settings> | null = null;

        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.location) {
            dispatch({ type: 'SET_LOCATION', payload: saved.location });
            savedLocation = saved.location;
          }
          if (saved.settings) {
            dispatch({ type: 'SET_SETTINGS', payload: saved.settings });
            savedSettings = saved.settings;
          }
        }

        // Hydrate prayer times immediately from cache — handles both AppContext and
        // prayer-tab cache formats (they share the same key but differ in structure).
        if (savedLocation && cacheRaw) {
          try {
            const cached = JSON.parse(cacheRaw);
            if (isCacheToday(cached.date)) {
              // AppContext format: todayT field
              // Prayer tab format: timings field
              const todayT = cached.todayT ?? cached.timings ?? null;
              const tomT   = cached.tomT   ?? cached.tomorrowTimings ?? null;
              const hijri  = cached.hijri  ?? null;
              if (todayT) {
                dispatch({ type: 'SET_PRAYER_TIMES',   payload: todayT });
                if (tomT)  dispatch({ type: 'SET_TOMORROW_TIMES', payload: tomT });
                if (hijri) dispatch({ type: 'SET_HIJRI',          payload: hijri });
              }
            }
          } catch {}
        }

        // Refresh GPS silently in background so home screen and prayer tab both
        // show up-to-date location without the user having to visit the prayer tab.
        // Cached data is already displayed above — this only updates if location changed.
        const autoLocation = savedSettings?.autoLocation ?? DEFAULT_SETTINGS.autoLocation;
        if (autoLocation) {
          refreshLocation().catch(() => {});
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

  // ── Bygg stadsbaserad bönetidscache direkt när plats/metod/skola ändras ──
  // Cachen är stabil per stad — GPS-rörelse inom samma stad triggar aldrig ombyggnad.
  useEffect(() => {
    if (!state.location?.city) return;
    const { latitude: lat, longitude: lng, city } = state.location;
    const { calculationMethod: method, school } = state.settings;
    buildYearlyCache(city, lat, lng, method, school).catch(() => {});
  }, [state.location, state.settings.calculationMethod, state.settings.school]); // eslint-disable-line

  async function loadPrayers(loc: LocationType, method: number, school: number) {
    if (!loc) return;
    const key = loc.latitude.toFixed(4)+','+loc.longitude.toFixed(4)+','+method+','+school;
    if (lastFetchRef.current === key) return;
    lastFetchRef.current = key;

    // Fallback-kedja: dagscache → stadsbaserad årsvis cache → offline-fel
    const localData = await getPrayerTimesWithFallback(loc.city, loc.latitude, loc.longitude, method, school);

    if (localData) {
      dispatch({ type: 'SET_PRAYER_TIMES',   payload: localData.todayT });
      dispatch({ type: 'SET_TOMORROW_TIMES', payload: localData.tomT });
      if (localData.hijri) dispatch({ type: 'SET_HIJRI', payload: localData.hijri });
      dispatch({ type: 'SET_ERROR',          payload: null });
    }

    dispatch({ type: 'SET_LOADING', payload: !localData });
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

    } catch {
      lastFetchRef.current = null; // tillåt retry
      if (!localData) dispatch({ type: 'SET_ERROR', payload: 'offline' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }

  // ── Bakgrundsplatstask: start/stop baserat på autoLocation ──
  useEffect(() => {
    if (state.settings.autoLocation) {
      startBackgroundLocationUpdates().catch(() => {});
    } else {
      stopBackgroundLocationUpdates().catch(() => {});
    }
  }, [state.settings.autoLocation]); // eslint-disable-line

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
        suburb:    geo.subLocality,
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
    // Pre-prayer reminders: refresh rolling 5-day schedule whenever prayer times reload
    refreshPrePrayerReminderNotifications().catch(() => {});
  }, [state.prayerTimes, state.tomorrowTimes, state.settings.notifications, state.settings.dhikrReminder, state.settings.fridayDuaReminder, state.location?.city]); // eslint-disable-line

  const value = useMemo(() => ({ ...state, dispatch, refreshPrayers, refreshLocation }), [state]); // eslint-disable-line

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
