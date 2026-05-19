import React, { createContext, useContext, useReducer, useEffect, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Platform, AppState } from 'react-native';
import { fetchPrayerTimes, fetchTomorrowPrayerTimes, calcMidnight, reverseGeocode } from '../services/prayerApi';
import { startBackgroundLocationUpdates, stopBackgroundLocationUpdates } from '../services/backgroundLocation';
import { warmupNativeCache } from '../services/nativeCacheWarmup';
import { buildYearlyCache, getPrayerTimesWithFallback } from '../services/monthlyCache';
import {
  getIfisTodayAndTomorrow, warmIfisCache, matchIfisCity, fetchIfisCities,
  getIfisCityDisplayNames, getIfisCityDisplayName, normalizeIfisCity,
} from '../services/ifisApi';
import { schedulePrayerNotifications, cancelPrayerNotifications, scheduleDhikrReminder, cancelDhikrReminder, scheduleFridayDuaReminder, cancelFridayDuaReminder, refreshPrePrayerReminderNotifications, getNotificationDisplayName } from '../services/notifications';
import {
  updateWidgetData,
  updateDailyContent,
  setAutoLocation,
  getBackgroundLocationUpdate,
  clearNeedsPrayerRefresh,
  setNativeSettings,
  updateLocationIndexEntry,
  upsertCityPrayerCache,
  setNotificationScheduleState,
  getNotificationScheduleState,
  setEffectivePrayerSchedule,
  getVisitedPrayerLocations,
  getNativeBgDebugEvents,
  clearPrayerCachesForMigration,
  type NotificationScheduleState,
  type EffectivePrayerSchedule,
} from '../modules/WidgetData';
import { getDailyWidgetPayload } from '../services/dailyWidgetContent';
import { refreshVisitedPlaceMultiDayCache } from '../services/visitedPlacesRefresh';
import { getEffectivePrayerCity } from '../services/monthlyCache';
import { getPrayerMonthFromSupabaseFallback } from '../services/supabasePrayerFallback';

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

function makeLocationKey(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getTodayStr() {
  const n = new Date();
  return String(n.getDate()).padStart(2,'0')+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+n.getFullYear();
}

function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type LocationType = { latitude: number; longitude: number; city: string; suburb?: string; country: string } | null;
type Settings = { calculationMethod: number; school: number; notifications: boolean; announcementNotifications: boolean; autoLocation: boolean; dhikrReminder: boolean; fridayDuaReminder: boolean; prayerSource: 'aladhan' | 'ifis'; ifisCity: string };
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
  calculationMethod:         3,
  school:                    0,
  notifications:             true,
  announcementNotifications: true,
  autoLocation:              true,
  dhikrReminder:             false,
  fridayDuaReminder:         true,
  prayerSource:              'aladhan',
  ifisCity:                  'stockholm',
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

// ── Prayer cache date-key migration (Fix 1 — UTC → local date strings) ──────────
// Version flag stored in AsyncStorage (JS-side, survives app updates).
// Version 2 = all App Group prayer-cache keys use local-timezone date strings.
const PRAYER_CACHE_DATE_KEY_VERSION = 'prayerCacheDateKeyVersion';
const CURRENT_PRAYER_CACHE_VERSION  = 2;

/**
 * Checks whether existing App Group prayer caches were written with the old
 * UTC-shifted date logic. If so, clears all four affected keys so native never
 * reads stale tomorrow-as-today data. Returns true when migration was performed
 * (caller must set migrationPendingRef so the version is committed after the
 * first successful loadPrayers() write).
 *
 * Idempotent: safe to call on every startup — exits immediately when v2 is set.
 * Only runs on iOS (App Group caches do not exist on Android).
 */
async function runPrayerCacheMigrationIfNeeded(): Promise<boolean> {
  try {
    const stored  = await AsyncStorage.getItem(PRAYER_CACHE_DATE_KEY_VERSION);
    const version = stored ? parseInt(stored, 10) : 0;
    if (version >= CURRENT_PRAYER_CACHE_VERSION) {
      console.log(`[CacheMigration] v${CURRENT_PRAYER_CACHE_VERSION} already applied — skip`);
      return false;
    }
    console.log(`[CacheMigration] migration needed (stored version=${version}) — clearing UTC-shifted prayer caches`);
    await clearPrayerCachesForMigration().catch(() => {});
    console.log(`[CacheMigration] cancelling old pending prayer notifications`);
    await cancelPrayerNotifications().catch(() => {});
    console.log(`[CacheMigration] old pending prayer notifications cancelled`);
    console.log(`[CacheMigration] awaiting fresh reschedule`);
    return true;
  } catch {
    return false;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const lastFetchRef       = useRef<string | null>(null);
  // Set when native background location detected a move while app was closed.
  // Cleared only after a successful loadPrayers() call — never cleared on error.
  const pendingBgClearRef  = useRef(false);
  // Set when the prayer-cache date-key migration cleared stale App Group data.
  // Cleared + version committed after the first successful loadPrayers() write.
  const migrationPendingRef = useRef(false);
  // Refs for the AppState foreground-refresh listener — must not read state inside
  // a long-lived callback (stale closure). These refs are kept in sync below.
  const appStateRef        = useRef(AppState.currentState);
  const autoLocationRef    = useRef(DEFAULT_SETTINGS.autoLocation);

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

        // Check if native significant-location monitor detected a new position while
        // the app was closed. Mark pendingBgClearRef so clearNeedsPrayerRefresh() is
        // called only after loadPrayers() succeeds. If the refresh fails (network down,
        // GPS timeout, API error), the flag stays set and will be retried on next open.
        if (Platform.OS === 'ios') {
          getBackgroundLocationUpdate()
            .then(bgUpdate => { if (bgUpdate) pendingBgClearRef.current = true; })
            .catch(() => {});

          // Dump native background debug events on every app open.
          // These are written by LocationBackgroundManager into App Group and survive
          // process termination — they prove whether native location/region events fired
          // during the last closed-app session. Visible in device logs (Console.app)
          // and accessible from TestFlight builds without Xcode attached.
          getNativeBgDebugEvents().then(events => {
            if (!events.length) {
              console.log('[NativeBgDebug] no events recorded yet (app may not have been backgrounded)');
              return;
            }
            console.log(`[NativeBgDebug] last ${events.length} native background events:`);
            (events as Array<Record<string, unknown>>).forEach(e => {
              const ts = e.ts ? new Date((e.ts as number) * 1000).toISOString() : '?';
              const lat = e.lat != null ? `lat=${(e.lat as number).toFixed(4)}` : '';
              const lng = e.lng != null ? `lng=${(e.lng as number).toFixed(4)}` : '';
              const auth = e.authStatus != null ? ` authStatus=${e.authStatus}` : '';
              const city = e.displayName ? ` city="${e.displayName}"` : '';
              console.log(
                `[NativeBgDebug]   ${ts} [${e.event}]${auth}${city} ${lat}${lng} — ${e.message}`,
              );
            });
          }).catch(() => {});

          if (__DEV__) {
            getVisitedPrayerLocations().then(entries => {
              if (!entries) { console.log('[VisitedCache] empty / not written yet'); return; }
              console.log(`[VisitedCache] ${entries.length} entries on app open:`);
              (entries as Array<Record<string, unknown>>).forEach((e, i) => {
                const dailyKeys = e.dailyTimesByDate
                  ? Object.keys(e.dailyTimesByDate as Record<string, unknown>).sort().join(', ')
                  : 'none';
                console.log(
                  `[VisitedCache]   [${i}] locationKey=${e.locationKey}` +
                  ` displayName=${e.displayName}` +
                  ` lat=${e.lat} lng=${e.lng}` +
                  ` method=${e.method} school=${e.school}` +
                  ` date=${e.date} tomorrowDate=${e.tomorrowDate}` +
                  ` todayTimesCount=${Object.keys((e.todayTimes as Record<string, unknown>) ?? {}).length}` +
                  ` dailyTimesByDate=[${dailyKeys}]` +
                  ` source=${e.source}` +
                  ` lastUsedAt=${new Date(((e.lastUsedAt as number) ?? 0) * 1000).toISOString()}`,
                );
              });
            }).catch(() => {});
          }

          // One-time prayer cache migration (Fix 1).
          // Awaited so App Group caches are empty before refreshLocation triggers
          // loadPrayers and writes fresh local-date data. AsyncStorage reads are
          // fast (< 10 ms) — this never delays visible startup.
          const needsMigration = await runPrayerCacheMigrationIfNeeded();
          if (needsMigration) migrationPendingRef.current = true;
        }

        // Refresh GPS silently in background so home screen and prayer tab both
        // show up-to-date location without the user having to visit the prayer tab.
        // Cached data is already displayed above — this only updates if location changed.
        const autoLocation = savedSettings?.autoLocation ?? DEFAULT_SETTINGS.autoLocation;
        const alreadyOnboarded = await AsyncStorage.getItem('islamnu_onboarding_completed');
        if (autoLocation && alreadyOnboarded) {
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

  // Keep autoLocationRef in sync so the AppState listener can read it without
  // a stale closure (CLAUDE.md: never rely on state inside long-lived callbacks).
  useEffect(() => {
    autoLocationRef.current = state.settings.autoLocation;
  }, [state.settings.autoLocation]); // eslint-disable-line

  // ── Foreground refresh — global lifecycle, not tied to any tab ──
  // The Prayer Times tab has its own AppState listener, but it is NOT mounted
  // until the user navigates to it (app starts at /(tabs)/home via redirect).
  // This listener ensures the home screen location/prayer data updates whenever
  // the app returns to the foreground, regardless of which tab is active.
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        if (autoLocationRef.current) {
          AsyncStorage.getItem('islamnu_onboarding_completed')
            .then(onboarded => { if (onboarded) refreshLocation().catch(() => {}); })
            .catch(() => {});
        }
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []); // eslint-disable-line

  // ── Hämta bönetider automatiskt när location/method/school/prayerSource/ifisCity ändras ──
  useEffect(() => {
    if (!state.location) return;
    lastFetchRef.current = null;
    loadPrayers(
      state.location,
      state.settings.calculationMethod,
      state.settings.school,
      state.settings.prayerSource ?? 'aladhan',
      state.settings.ifisCity ?? 'stockholm',
    );
  }, [state.location, state.settings.calculationMethod, state.settings.school, state.settings.prayerSource, state.settings.ifisCity]); // eslint-disable-line

  // ── Bygg/värm cache + spegla stadsindex till App Group ──
  useEffect(() => {
    if (!state.location?.city) return;
    const { latitude: lat, longitude: lng, city } = state.location;
    const { calculationMethod: method, school } = state.settings;
    const prayerSource = state.settings.prayerSource ?? 'aladhan';
    const ifisCity     = state.settings.ifisCity ?? 'stockholm';

    if (prayerSource === 'ifis') {
      warmIfisCache(ifisCity).catch(() => {});
    } else {
      buildYearlyCache(city, lat, lng, method, school).catch(() => {});
    }
    // Always update native location index — used as AlAdhan fallback by native scheduler
    if (Platform.OS === 'ios') {
      const effectiveCity = getEffectivePrayerCity(city);
      const cityKey = `${effectiveCity.toLowerCase()}_${method}_${school}`;
      updateLocationIndexEntry({ cityKey, displayName: effectiveCity, lat, lng, method, school })
        .catch(() => {});
    }
  }, [state.location, state.settings.calculationMethod, state.settings.school, state.settings.prayerSource, state.settings.ifisCity]); // eslint-disable-line

  async function loadPrayers(
    loc: LocationType,
    method: number,
    school: number,
    prayerSource: 'aladhan' | 'ifis' = 'aladhan',
    ifisCity: string = 'stockholm',
  ) {
    if (!loc) return;

    const isIfis = prayerSource === 'ifis';

    // Auto-match IFIS city from geocoded location when IFIS is active
    let effectiveIfisCity = ifisCity;
    if (isIfis) {
      // Populate full city list from API before matching — fetchIfisCities updates
      // the in-memory map; without this call only 3 base cities (stockholm/goteborg/malmo)
      // are available, so any other city falls through to the Stockholm default.
      try { await fetchIfisCities(); } catch {}
      const geocodedCity   = getEffectivePrayerCity(loc.city);
      const normalizedGeo  = normalizeIfisCity(geocodedCity);
      const knownCities    = Object.keys(getIfisCityDisplayNames());
      const matched        = knownCities.find(c => c === normalizedGeo)
                          || matchIfisCity(geocodedCity, knownCities, { latitude: loc.latitude, longitude: loc.longitude });
      if (matched && matched !== ifisCity) {
        effectiveIfisCity = matched;
        dispatch({ type: 'SET_SETTINGS', payload: { ifisCity: matched } });
      }
    }

    const key = isIfis
      ? `ifis:${effectiveIfisCity}`
      : `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)},${method},${school}`;

    if (lastFetchRef.current === key) return;
    lastFetchRef.current = key;

    // Local cache read — fast path before any network call
    let localData: { todayT: Record<string, string>; tomT: Record<string, string> | null; hijri: any } | null = null;
    if (isIfis) {
      try {
        const r = await getIfisTodayAndTomorrow(effectiveIfisCity);
        localData = { todayT: r.todayT, tomT: r.tomT, hijri: null };
      } catch {}
    } else {
      const fallback = await getPrayerTimesWithFallback(loc.city, loc.latitude, loc.longitude, method, school);
      if (fallback) localData = fallback;
    }

    if (localData) {
      dispatch({ type: 'SET_PRAYER_TIMES',   payload: localData.todayT });
      dispatch({ type: 'SET_TOMORROW_TIMES', payload: localData.tomT });
      if (localData.hijri) dispatch({ type: 'SET_HIJRI', payload: localData.hijri });
      dispatch({ type: 'SET_ERROR',          payload: null });
    }

    dispatch({ type: 'SET_LOADING', payload: !localData });
    dispatch({ type: 'SET_ERROR',   payload: null });

    try {
      let todayT: Record<string, string>;
      let tomT: Record<string, string>;
      let fetchedHijri: any = null;

      if (isIfis) {
        const r = await getIfisTodayAndTomorrow(effectiveIfisCity);
        todayT = r.todayT;
        tomT   = r.tomT ?? {};
        // Warm both years in background — does not block UI
        warmIfisCache(effectiveIfisCity).catch(() => {});
        // Fetch Hijri from AlAdhan separately — IFIS has no Hijri data.
        // This keeps the Hijri date current daily regardless of prayer source.
        try {
          const hijriRes = await fetchPrayerTimes(loc.latitude, loc.longitude, getTodayStr(), 3, 0);
          fetchedHijri = hijriRes.hijri;
        } catch {
          // Network failure — state.hijriDate used as fallback in widget write
        }
      } else {
        const todayStr = getTodayStr();
        const [todayRes, tomTimings] = await Promise.all([
          fetchPrayerTimes(loc.latitude, loc.longitude, todayStr, method, school),
          fetchTomorrowPrayerTimes(loc.latitude, loc.longitude, method, school),
        ]);
        todayT      = { ...todayRes.timings, Midnight: calcMidnight(todayRes.timings.Maghrib, tomTimings.Fajr) || '' };
        tomT        = { ...tomTimings, Midnight: '' };
        fetchedHijri = todayRes.hijri;
      }

      dispatch({ type: 'SET_PRAYER_TIMES',   payload: todayT });
      dispatch({ type: 'SET_TOMORROW_TIMES', payload: tomT });
      if (fetchedHijri) dispatch({ type: 'SET_HIJRI', payload: fetchedHijri });
      dispatch({ type: 'SET_ERROR',          payload: null });

      // Persist to daily cache for startup hydration — IFIS uses a special key
      if (isIfis) {
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
          key:   `ifis:${effectiveIfisCity}`,
          date:  getTodayStr(),
          todayT, tomT, hijri: fetchedHijri,
        })).catch(() => {});
      } else {
        await setCached(loc, method, school, todayT, tomT, fetchedHijri);
      }

      // Write data to App Group shared container for iOS widgets.
      if (Platform.OS === 'ios') {
        const h = fetchedHijri;
        const todayIso = localIsoDate();

        // Display name: IFIS shows city name, AlAdhan shows suburb+city
        const fullDisplayName = isIfis
          ? getIfisCityDisplayName(effectiveIfisCity)
          : ((loc.suburb && loc.suburb !== loc.city) ? `${loc.suburb}, ${loc.city}` : loc.city);

        updateWidgetData({
          city:      fullDisplayName,
          latitude:  loc.latitude,
          longitude: loc.longitude,
          prayers: [
            { name: 'Fajr',       time: todayT.Fajr    ?? '' },
            { name: 'Soluppgång', time: todayT.Sunrise  ?? '' },
            { name: 'Dhuhr',      time: todayT.Dhuhr   ?? '' },
            { name: 'Asr',        time: todayT.Asr     ?? '' },
            { name: 'Maghrib',    time: todayT.Maghrib ?? '' },
            { name: 'Isha',       time: todayT.Isha    ?? '' },
          ],
          hijri: (() => {
            const src = h ?? state.hijriDate;
            if (!src) return { day: 0, monthNumber: 0, monthNameEn: '', year: 0 };
            return {
              day:         parseInt(src.day           ?? '0', 10),
              monthNumber: parseInt(src.month?.number ?? '0', 10),
              monthNameEn: src.month?.en              ?? '',
              year:        parseInt(src.year          ?? '0', 10),
            };
          })(),
          date:      todayIso,
          timestamp: Date.now() / 1000,
        }).catch(() => {});

        updateDailyContent(getDailyWidgetPayload()).catch(() => {});

        const effectiveCity = isIfis
          ? getIfisCityDisplayName(effectiveIfisCity)
          : getEffectivePrayerCity(loc.city);
        // IFIS uses its own cityKey prefix so native cache lookup is independent
        const cityKey      = isIfis
          ? `ifis_${effectiveIfisCity}`
          : `${effectiveCity.toLowerCase()}_${method}_${school}`;
        const todayDate    = new Date();
        const tomorrowDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + 1);

        upsertCityPrayerCache({
          cityKey,
          displayName:  effectiveCity,
          lat:          loc.latitude,
          lng:          loc.longitude,
          date:         localIsoDate(todayDate),
          tomorrowDate: localIsoDate(tomorrowDate),
          method:       isIfis ? 3 : method,
          school:       isIfis ? 0 : school,
          todayT,
          tomT: tomT ?? null,
          updatedAt: Date.now() / 1000,
        }).catch(() => {});

        setEffectivePrayerSchedule({
          displayName:             fullDisplayName,
          notificationDisplayName: getNotificationDisplayName(fullDisplayName),
          locationKey:             cityKey,
          lat:                     loc.latitude,
          lng:                     loc.longitude,
          date:                    localIsoDate(todayDate),
          tomorrowDate:            localIsoDate(tomorrowDate),
          todayTimes:              todayT,
          tomorrowTimes:           tomT ?? null,
          method:                  isIfis ? 3 : method,
          school:                  isIfis ? 0 : school,
          updatedAt:               Date.now() / 1000,
          source:                  'js_precise_location',
        } as EffectivePrayerSchedule).catch(() => {});

        if (!isIfis) {
          refreshVisitedPlaceMultiDayCache(
            {
              locationKey:             makeLocationKey(fullDisplayName),
              displayName:             fullDisplayName,
              notificationDisplayName: getNotificationDisplayName(fullDisplayName),
              lat:                     loc.latitude,
              lng:                     loc.longitude,
              method,
              school,
              source:                  'js_precise_location',
            },
            todayT,
            tomT ?? null,
          ).catch(() => {});

          warmupNativeCache(method, school).catch((err) => {
            if (__DEV__) console.warn('[NativeCacheWarmup] failed', err);
          });
        }

        AsyncStorage.getItem('hidayah_prayer_reminder_offset').then(raw => {
          const offset = raw ? parseInt(raw, 10) : 0;
          const scheduleState: NotificationScheduleState = {
            version:                  1,
            owner:                    'js',
            source:                   'app_open',
            cityKey,
            displayName:              effectiveCity,
            notificationDisplayName:  getNotificationDisplayName(effectiveCity),
            lat:                      loc.latitude,
            lng:                      loc.longitude,
            date:                     localIsoDate(todayDate),
            method:                   isIfis ? 3 : method,
            school:                   isIfis ? 0 : school,
            todayT,
            tomT:                     tomT ?? undefined,
            dhikrEnabled:             state.settings.dhikrReminder,
            prePrayerOffset:          isNaN(offset) ? 0 : offset,
            updatedAt:                Date.now() / 1000,
          };
          return setNotificationScheduleState(scheduleState);
        }).catch(() => {});

        if (pendingBgClearRef.current) {
          pendingBgClearRef.current = false;
          clearNeedsPrayerRefresh().catch(() => {});
        }

        if (migrationPendingRef.current) {
          migrationPendingRef.current = false;
          AsyncStorage.setItem(PRAYER_CACHE_DATE_KEY_VERSION, String(CURRENT_PRAYER_CACHE_VERSION))
            .then(() => console.log(`[CacheMigration] v${CURRENT_PRAYER_CACHE_VERSION} committed — fresh local-date cache and notifications written`))
            .catch(() => {});
        }
      }

    } catch {
      lastFetchRef.current = null;
      if (!localData) {
        if (isIfis) {
          dispatch({ type: 'SET_ERROR', payload: 'offline' });
        } else {
          // Daily cache, yearly cache, and AlAdhan all failed — last-resort Supabase SCB fallback
          let fallbackSucceeded = false;
          try {
            console.log('[PrayerFallback] Supabase fallback attempted');
            const fallback = await getPrayerMonthFromSupabaseFallback({
              latitude:  loc.latitude,
              longitude: loc.longitude,
              date:      new Date(),
            });
            if (fallback) {
              console.log(`[PrayerFallback] Supabase fallback succeeded: ${fallback.locationName} (${fallback.matchType})`);
              dispatch({ type: 'SET_PRAYER_TIMES',   payload: fallback.todayT });
              dispatch({ type: 'SET_TOMORROW_TIMES', payload: fallback.tomT });
              if (fallback.hijri) dispatch({ type: 'SET_HIJRI', payload: fallback.hijri });
              dispatch({ type: 'SET_ERROR',          payload: null });
              await setCached(loc, method, school, fallback.todayT, fallback.tomT, fallback.hijri);
              if (Platform.OS === 'ios') {
                const h = fallback.hijri;
                const fullDisplayName = (loc.suburb && loc.suburb !== loc.city)
                  ? `${loc.suburb}, ${loc.city}`
                  : loc.city;
                updateWidgetData({
                  city:      fullDisplayName,
                  latitude:  loc.latitude,
                  longitude: loc.longitude,
                  prayers: [
                    { name: 'Fajr',       time: fallback.todayT.Fajr    ?? '' },
                    { name: 'Soluppgång', time: fallback.todayT.Sunrise  ?? '' },
                    { name: 'Dhuhr',      time: fallback.todayT.Dhuhr   ?? '' },
                    { name: 'Asr',        time: fallback.todayT.Asr     ?? '' },
                    { name: 'Maghrib',    time: fallback.todayT.Maghrib ?? '' },
                    { name: 'Isha',       time: fallback.todayT.Isha    ?? '' },
                  ],
                  hijri: {
                    day:         h ? parseInt(h.day,          10) : 0,
                    monthNumber: h ? parseInt(h.month.number, 10) : 0,
                    monthNameEn: h?.month.en ?? '',
                    year:        h ? parseInt(h.year,         10) : 0,
                  },
                  date:      localIsoDate(),
                  timestamp: Date.now() / 1000,
                }).catch(() => {});
              }
              fallbackSucceeded = true;
            }
          } catch (fbErr) {
            console.warn('[PrayerFallback] Supabase fallback failed:', fbErr instanceof Error ? fbErr.message : 'unknown');
          }
          if (!fallbackSucceeded) {
            dispatch({ type: 'SET_ERROR', payload: 'offline' });
          }
        }
      }
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }

  // ── Bakgrundsplatstask: start/stop + mirror settings to App Group ──
  // App Group copies let the native layer (LocationBackgroundManager +
  // NativeNotificationScheduler) read settings without the JS runtime.
  useEffect(() => {
    if (Platform.OS === 'ios') {
      setAutoLocation(state.settings.autoLocation).catch(() => {});
      // Also read the pre-prayer reminder offset (stored separately from main settings)
      AsyncStorage.getItem('hidayah_prayer_reminder_offset').then(raw => {
        const offset = raw ? parseInt(raw, 10) : 0;
        return setNativeSettings({
          notifications:           state.settings.notifications,
          calculationMethod:       state.settings.calculationMethod,
          school:                  state.settings.school,
          dhikrReminder:           state.settings.dhikrReminder,
          prePrayerReminderOffset: isNaN(offset) ? 0 : offset,
        });
      }).catch(() => {});
    }
    if (state.settings.autoLocation) {
      startBackgroundLocationUpdates().catch(() => {});
    } else {
      stopBackgroundLocationUpdates().catch(() => {});
    }
  }, [ // eslint-disable-line
    state.settings.autoLocation,
    state.settings.notifications,
    state.settings.calculationMethod,
    state.settings.school,
    state.settings.dhikrReminder,
  ]);

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
      await loadPrayers(
        state.location,
        state.settings.calculationMethod,
        state.settings.school,
        state.settings.prayerSource ?? 'aladhan',
        state.settings.ifisCity ?? 'stockholm',
      );
    }
  }

  // ── Schedule / cancel prayer notifications whenever relevant state changes ──
  useEffect(() => {
    if (!state.prayerTimes || !state.location) return;
    const isIfis    = (state.settings.prayerSource ?? 'aladhan') === 'ifis';
    const notifCity = isIfis
      ? getIfisCityDisplayName(state.settings.ifisCity ?? 'stockholm')
      : getEffectivePrayerCity(state.location.city);
    if (!state.settings.notifications) {
      cancelPrayerNotifications().catch(() => {});
    } else {
      schedulePrayerNotifications(
        state.prayerTimes,
        state.tomorrowTimes,
        notifCity,
        { method: state.settings.calculationMethod, school: state.settings.school },
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
