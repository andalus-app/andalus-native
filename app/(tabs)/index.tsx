import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, ActivityIndicator, TouchableOpacity, ScrollView,
  useWindowDimensions, Animated, Alert, RefreshControl, AppState, Platform,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect , SvgXml } from 'react-native-svg';
import * as Location from 'expo-location';
import HidayahLogo from '../../components/HidayahLogo';
import SvgIcon from '../../components/SvgIcon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPrayerTimesWithFallback } from '../../services/monthlyCache';
import { getIfisTodayAndTomorrow, getIfisCityDisplayName } from '../../services/ifisApi';

import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../context/ThemeContext';
import { useApp } from '../../context/AppContext';
import { nativeReverseGeocode } from '../../services/geocoding';
import { updateWidgetData } from '../../modules/WidgetData';
import PrayerEmptyState from '../../components/PrayerEmptyState';
import type { CityResult } from '../../components/CitySearchModal';
import { masjidIconXml } from '../../constants/masjidIcon';
import MasjidTipBubble from '../../components/masjid/MasjidTipBubble';

const MONTHLY_CALENDAR_SVG = `<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 14C17.5523 14 18 13.5523 18 13C18 12.4477 17.5523 12 17 12C16.4477 12 16 12.4477 16 13C16 13.5523 16.4477 14 17 14Z" fill="__C__"/><path d="M17 18C17.5523 18 18 17.5523 18 17C18 16.4477 17.5523 16 17 16C16.4477 16 16 16.4477 16 17C16 17.5523 16.4477 18 17 18Z" fill="__C__"/><path d="M13 13C13 13.5523 12.5523 14 12 14C11.4477 14 11 13.5523 11 13C11 12.4477 11.4477 12 12 12C12.5523 12 13 12.4477 13 13Z" fill="__C__"/><path d="M13 17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17C11 16.4477 11.4477 16 12 16C12.5523 16 13 16.4477 13 17Z" fill="__C__"/><path d="M7 14C7.55229 14 8 13.5523 8 13C8 12.4477 7.55229 12 7 12C6.44772 12 6 12.4477 6 13C6 13.5523 6.44772 14 7 14Z" fill="__C__"/><path d="M7 18C7.55229 18 8 17.5523 8 17C8 16.4477 7.55229 16 7 16C6.44772 16 6 16.4477 6 17C6 17.5523 6.44772 18 7 18Z" fill="__C__"/><path fill-rule="evenodd" clip-rule="evenodd" d="M7 1.75C7.41421 1.75 7.75 2.08579 7.75 2.5V3.26272C8.412 3.24999 9.14133 3.24999 9.94346 3.25H14.0564C14.8586 3.24999 15.588 3.24999 16.25 3.26272V2.5C16.25 2.08579 16.5858 1.75 17 1.75C17.4142 1.75 17.75 2.08579 17.75 2.5V3.32709C18.0099 3.34691 18.2561 3.37182 18.489 3.40313C19.6614 3.56076 20.6104 3.89288 21.3588 4.64124C22.1071 5.38961 22.4392 6.33855 22.5969 7.51098C22.75 8.65018 22.75 10.1058 22.75 11.9435V14.0564C22.75 15.8941 22.75 17.3498 22.5969 18.489C22.4392 19.6614 22.1071 20.6104 21.3588 21.3588C20.6104 22.1071 19.6614 22.4392 18.489 22.5969C17.3498 22.75 15.8942 22.75 14.0565 22.75H9.94359C8.10585 22.75 6.65018 22.75 5.51098 22.5969C4.33856 22.4392 3.38961 22.1071 2.64124 21.3588C1.89288 20.6104 1.56076 19.6614 1.40314 18.489C1.24997 17.3498 1.24998 15.8942 1.25 14.0564V11.9436C1.24998 10.1058 1.24997 8.65019 1.40314 7.51098C1.56076 6.33855 1.89288 5.38961 2.64124 4.64124C3.38961 3.89288 4.33856 3.56076 5.51098 3.40313C5.7439 3.37182 5.99006 3.34691 6.25 3.32709V2.5C6.25 2.08579 6.58579 1.75 7 1.75ZM5.71085 4.88976C4.70476 5.02502 4.12511 5.27869 3.7019 5.7019C3.27869 6.12511 3.02502 6.70476 2.88976 7.71085C2.86685 7.88123 2.8477 8.06061 2.83168 8.25H21.1683C21.1523 8.06061 21.1331 7.88124 21.1102 7.71085C20.975 6.70476 20.7213 6.12511 20.2981 5.7019C19.8749 5.27869 19.2952 5.02502 18.2892 4.88976C17.2615 4.75159 15.9068 4.75 14 4.75H10C8.09318 4.75 6.73851 4.75159 5.71085 4.88976ZM2.75 12C2.75 11.146 2.75032 10.4027 2.76309 9.75H21.2369C21.2497 10.4027 21.25 11.146 21.25 12V14C21.25 15.9068 21.2484 17.2615 21.1102 18.2892C20.975 19.2952 20.7213 19.8749 20.2981 20.2981C19.8749 20.7213 19.2952 20.975 18.2892 21.1102C17.2615 21.2484 15.9068 21.25 14 21.25H10C8.09318 21.25 6.73851 21.2484 5.71085 21.1102C4.70476 20.975 4.12511 20.7213 3.7019 20.2981C3.27869 19.8749 3.02502 19.2952 2.88976 18.2892C2.75159 17.2615 2.75 15.9068 2.75 14V12Z" fill="__C__"/></svg>`;
const calendarXml = (color: string) => MONTHLY_CALENDAR_SVG.replace(/__C__/g, color);

// ── Topbar icon tokens ──────────────────────────────────────────────────────
// Glyph sizes are kept separate from the touch area: every topbar icon gets a
// generous hitSlop so usability never depends on the rendered glyph size.
const CALENDAR_ICON_SIZE = 28; // calendar (square viewBox) — prayer-tab reference glyph
const MASJID_ICON_SIZE   = 26; // portrait pin fits to height, so it's trimmed to match the calendar's optical height
const SETTINGS_ICON_SIZE = 19; // identical to home.tsx + more.tsx ("Visa mer") so it no longer jumps between pages
const TOPBAR_HIT_SLOP    = { top: 8, right: 8, bottom: 8, left: 8 };

const PRAYER_CACHE_KEY = 'andalus_prayer_cache';
// First-run hint pointing at the "Närmaste masjid" topbar icon. Shown at most
// once per 24h (Date.now() timestamp persisted; auto-hides after 10s).
const MASJID_TIP_KEY = 'andalus_masjid_tip_last_shown_v1';
const MASJID_TIP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MASJID_TIP_DURATION_MS = 10 * 1000;
// Vertical offset for the bubble inside the topbar container: paddingTop(56)
// + icon row height(~28) + caret gap(~6) → sits just below the icon.
const MASJID_TIP_TOP = 90;

const PRAYER_NAMES: Record<string, string> = {
  Fajr: 'Fajr', Sunrise: 'Shuruq', Dhuhr: 'Dhuhr',
  Asr: 'Asr', Maghrib: 'Maghrib', Isha: 'Isha', Midnight: 'Halva natten',
};
const PRAYER_ORDER = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Midnight'];
function stripTz(t: string) { return t ? t.replace(/\s*\(.*\)/, '').trim() : ''; }
function calcMidnight(maghrib: string, fajrNext: string) {
  if (!maghrib || !fajrNext) return null;
  const [mh, mm] = maghrib.split(':').map(Number);
  const [fh, fm] = fajrNext.split(':').map(Number);
  const maghribMin = mh * 60 + mm;
  const fajrMin    = fh * 60 + fm + 24 * 60;
  const midMin     = (maghribMin + Math.ceil((fajrMin - maghribMin) / 2)) % (24 * 60);
  return `${String(Math.floor(midMin / 60)).padStart(2,'0')}:${String(midMin % 60).padStart(2,'0')}`;
}
function timeToMinutes(t: string) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function splitCity(combined: string): { suburb: string; cityName: string } {
  if (!combined) return { suburb: '', cityName: '' };
  const idx = combined.indexOf(', ');
  if (idx === -1) return { suburb: '', cityName: combined };
  return { suburb: combined.slice(0, idx), cityName: combined.slice(idx + 2) };
}
function nowMinutes() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function nowSeconds() { const n = new Date(); return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds(); }
function getActivePrayer(timings: Record<string, string>) {
  const now = nowMinutes();
  for (let i = PRAYER_ORDER.length - 1; i >= 0; i--) {
    const key = PRAYER_ORDER[i];
    if (!timings[key]) continue;
    const pMin = timeToMinutes(timings[key]);
    if (key === 'Midnight' && timings['Isha'] && timings['Fajr']) {
      const ishaMin = timeToMinutes(timings['Isha']);
      const fajrMin = timeToMinutes(timings['Fajr']);
      if (pMin < ishaMin) {
        if (now < pMin || now >= fajrMin) continue;
      }
    }
    if (now >= pMin) return key;
  }
  return '';
}
function getNextPrayer(timings: Record<string, string>) {
  const now = nowMinutes();
  for (const key of PRAYER_ORDER) {
    if (!timings[key]) continue;
    const pMin = timeToMinutes(timings[key]);

    // Special case: Midnight is calculated as the midpoint between today's Maghrib
    // and tomorrow's Fajr. When it falls after 00:00, its time string is 00:XX,
    // which compares as less than Isha (~22:XX), even though it's chronologically
    // after Isha. We need to detect this and treat it as a future event when
    // we're past Isha but before tomorrow's Fajr.
    if (key === 'Midnight' && timings['Isha'] && timings['Fajr']) {
      const ishaMin = timeToMinutes(timings['Isha']);
      const fajrMin = timeToMinutes(timings['Fajr']);
      // Midnight crosses the calendar day if its time value is less than Isha's
      if (pMin < ishaMin) {
        // Midnight is the next prayer if we're already past Isha
        if (now >= ishaMin) return key;
        // If we're before Isha, another prayer is next
        continue;
      }
    }

    if (pMin > now) return key;
  }
  return 'Fajr';
}
function getTimeUntil(timeStr: string) {
  const now = nowSeconds();
  const [h, m] = timeStr.split(':').map(Number);
  let diff = (h * 3600 + m * 60) - now;
  if (diff < 0) diff += 24 * 3600;
  return `${String(Math.floor(diff / 3600)).padStart(2,'0')}:${String(Math.floor((diff % 3600) / 60)).padStart(2,'0')}:${String(diff % 60).padStart(2,'0')}`;
}



export default function PrayerTimesScreen() {
  const { theme: T, isDark } = useTheme();
  const app            = useApp();
  const { dispatch: appDispatch } = app;
  const router       = useRouter();
  const { width }    = useWindowDimensions();

  // Seed local state from AppContext data that is already loaded from cache at
  // app startup. This ensures the countdown and prayer list render immediately
  // on mount without waiting for the async restoreCache() call.
  const _seedT   = app.prayerTimes   ?? null;
  const _seedTom = app.tomorrowTimes ?? null;
  function _seedCountdown(t: Record<string, string> | null, tom: Record<string, string> | null) {
    if (!t) return { np: '', ap: '', cd: '' };
    const np = getNextPrayer(t);
    const ap = getActivePrayer(t);
    const todayFajrMin = t['Fajr'] ? timeToMinutes(t['Fajr']) : -1;
    const isPost = np === 'Fajr' && todayFajrMin >= 0 && todayFajrMin <= nowMinutes();
    const time   = isPost && tom?.['Fajr'] ? tom['Fajr'] : (t[np] || '');
    return { np, ap, cd: getTimeUntil(time) };
  }
  const _seed = _seedCountdown(_seedT, _seedTom);

  // AppContext now stores suburb and city as separate fields — read them directly
  // so the initial render shows the correct suburb/city split with no async jump.
  const _initCity = {
    suburb:   app.location?.suburb || '',
    cityName: app.location?.city   || '',
  };

  const [timings,         setTimings]         = useState<Record<string, string> | null>(_seedT);
  const [tomorrowTimings, setTomorrowTimings] = useState<Record<string, string> | null>(_seedTom);
  const [hijri,           setHijri]           = useState<any>(app.hijriDate ?? null);
  const [tomorrowLabel,   setTomorrowLabel]   = useState('');
  const [suburb,          setSuburb]          = useState(_initCity.suburb);
  const [cityName,        setCityName]        = useState(_initCity.cityName);
  const [country,         setCountry]         = useState(() => app.location?.country || '');
  const [nextPrayer,      setNextPrayer]      = useState(_seed.np);
  const [activePrayer,    setActivePrayer]    = useState(_seed.ap);
  const [countdown,       setCountdown]       = useState(_seed.cd);
  const [refreshing,           setRefreshing]           = useState(false);
  const [showNoLocation,       setShowNoLocation]       = useState(false);
  const [noLocationGpsLoading, setNoLocationGpsLoading] = useState(false);
  const [showMasjidTip,        setShowMasjidTip]        = useState(false);

  // Refs must match the seeded initial state so the countdown interval that
  // fires immediately on mount uses the correct data.
  const timingsRef         = useRef<Record<string, string> | null>(_seedT);
  const tomorrowTimingsRef = useRef<Record<string, string> | null>(_seedTom);
  // Date string (e.g. "Fri Apr 04 2026") when prayer data was last fetched.
  // Used to detect civil-day crossover while the interval is running.
  const loadedDateRef  = useRef<string>('');
  const reloadingRef   = useRef(false);
  const lastFetchRef   = useRef<number>(0); // timestamp of last completed fetch attempt
  // Always points to the latest loadPrayerTimes closure — safe to call from interval.
  const doReloadRef    = useRef<() => void>(() => {});
  const intervalRef    = useRef<any>(null);
  // Auto-hide timer for the "Hitta närmaste masjid" tip bubble. Kept in a ref
  // so re-renders don't restart the 10s countdown and unmount can clear it.
  const masjidTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLocationRef  = useRef(true);
  const appStateRef      = useRef(AppState.currentState);
  const refreshOpacity   = useRef(new Animated.Value(0)).current;

  const rowLayouts    = useRef<Partial<Record<string, { y: number; height: number }>>>({});

  // Tracks horizontal scroll position for label animations
  const scrollX = useRef(new Animated.Value(0)).current;

  // ── Section label animations driven by scrollX ──
  const todayLabelTranslateX = scrollX.interpolate({
    inputRange: [0, width], outputRange: [0, -width * 0.35], extrapolate: 'clamp',
  });
  const todayLabelOpacity = scrollX.interpolate({
    inputRange: [0, width * 0.45], outputRange: [1, 0], extrapolate: 'clamp',
  });
  const tomorrowLabelTranslateX = scrollX.interpolate({
    inputRange: [0, width], outputRange: [width * 0.35, 0], extrapolate: 'clamp',
  });
  const tomorrowLabelOpacity = scrollX.interpolate({
    inputRange: [width * 0.45, width], outputRange: [0, 1], extrapolate: 'clamp',
  });
  // "→ Swipe för imorgon" fades out first
  const swipeHintTodayOpacity = scrollX.interpolate({
    inputRange: [0, width * 0.2], outputRange: [1, 0], extrapolate: 'clamp',
  });
  // "← Swipe för idag" fades in last
  const swipeHintTomorrowOpacity = scrollX.interpolate({
    inputRange: [width * 0.8, width], outputRange: [0, 1], extrapolate: 'clamp',
  });

  // ── Fade refresh spinner in/out ──
  useEffect(() => {
    Animated.timing(refreshOpacity, {
      toValue: refreshing ? 1 : 0,
      duration: refreshing ? 150 : 400,
      useNativeDriver: true,
    }).start();
  }, [refreshing]);

  // If AppContext had data ready at mount time, start the countdown interval
  // immediately so the timer ticks from the very first frame.
  // loadPrayerTimes will call startCountdownInterval again once fresh data
  // arrives; clearInterval inside it makes the restart safe.
  useEffect(() => {
    if (timingsRef.current) startCountdownInterval();
  }, []);  

  // Load once on mount + re-fetch when app returns from background
  useEffect(() => {
    loadPrayerTimes();
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        loadPrayerTimes();
      }
      appStateRef.current = nextState;
    });
    return () => { sub.remove(); clearInterval(intervalRef.current); };
  }, []);

  // Re-fetch when navigating back from settings; pause/resume countdown on tab focus change.
  useFocusEffect(
    useCallback(() => {
      loadPrayerTimes();
      if (timingsRef.current) startCountdownInterval();
      return () => { clearInterval(intervalRef.current); };
    }, [])
  );

  // ── "Hitta närmaste masjid" hint bubble ───────────────────────────────────
  // Shown the first time the prayer-times tab is focused, then at most once
  // every 24h. Auto-hides after 10s; the timestamp is persisted in
  // AsyncStorage the moment we decide to show, so leaving and re-entering the
  // tab within the same day does not re-trigger it.
  const dismissMasjidTip = useCallback(() => {
    if (masjidTipTimerRef.current) {
      clearTimeout(masjidTipTimerRef.current);
      masjidTipTimerRef.current = null;
    }
    setShowMasjidTip(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(MASJID_TIP_KEY);
          const last = raw ? Number(raw) : 0;
          const now = Date.now();
          if (!Number.isFinite(last) || now - last >= MASJID_TIP_INTERVAL_MS) {
            await AsyncStorage.setItem(MASJID_TIP_KEY, String(now));
            if (cancelled) return;
            setShowMasjidTip(true);
            masjidTipTimerRef.current = setTimeout(() => {
              masjidTipTimerRef.current = null;
              setShowMasjidTip(false);
            }, MASJID_TIP_DURATION_MS);
          }
        } catch {
          // Best-effort: if storage fails we simply don't show the hint.
        }
      })();
      return () => {
        cancelled = true;
        if (masjidTipTimerRef.current) {
          clearTimeout(masjidTipTimerRef.current);
          masjidTipTimerRef.current = null;
        }
        setShowMasjidTip(false);
      };
    }, [])
  );

  // Keep doReloadRef pointing at the latest loadPrayerTimes so the interval
  // can trigger a reload without a stale closure.
  doReloadRef.current = () => { loadPrayerTimes(); };

  // ── Countdown interval helper ─────────────────────────────────────────────
  //
  // Two edge cases handled here:
  //
  //   1. Post-Islamic-midnight (before civil 00:00):
  //      getNextPrayer exhausts all of today's prayers and falls back to 'Fajr'.
  //      "today's" Fajr has already passed, so we must count down to
  //      tomorrowTimings.Fajr instead.
  //      Detection: np === 'Fajr'  AND  timeToMinutes(today.Fajr) <= nowMinutes()
  //
  //   2. Civil midnight crossed while the app stayed open (data is from yesterday):
  //      The old Fajr time is numerically in the "future" even though it already
  //      fired yesterday. We reload for the new day.
  //      Detection: loadedDateRef.current !== new Date().toDateString()
  //
  function startCountdownInterval() {
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (!timingsRef.current) return;

      // Case 2: civil day changed — trigger a best-effort reload, but NEVER block
      // the countdown. Offline (or when fallback can't resolve due to GPS drift),
      // loadedDateRef stays stale and an early-return here would freeze the timer
      // on every tick. Letting it fall through means the countdown keeps ticking
      // from cached timings + Date.now() — prayer times shift by only seconds per
      // day, so stale-by-one-day data is far better than a frozen display.
      // lastFetchRef cooldown is intentionally kept so we don't hammer GPS/API
      // every second when offline.
      if (loadedDateRef.current && loadedDateRef.current !== new Date().toDateString()) {
        if (!reloadingRef.current) {
          doReloadRef.current();
        }
      }

      const np2 = getNextPrayer(timingsRef.current);

      // Case 1: post-Islamic-midnight — today's Fajr is in the past → use tomorrow's
      const todayFajrMin = timingsRef.current['Fajr']
        ? timeToMinutes(timingsRef.current['Fajr'])
        : -1;
      const isPostMidnight = np2 === 'Fajr' && todayFajrMin >= 0 && todayFajrMin <= nowMinutes();
      const countdownTime = isPostMidnight && tomorrowTimingsRef.current?.['Fajr']
        ? tomorrowTimingsRef.current['Fajr']
        : (timingsRef.current[np2] || '');

      setNextPrayer(np2);
      setActivePrayer(getActivePrayer(timingsRef.current));
      setCountdown(getTimeUntil(countdownTime));
    }, 1000);
  }

  // Restore cached prayer times instantly (returns true if any cache was loaded).
  // Accepts stale cache (from a previous day) — prayer times shift by only
  // seconds per day, so stale data is far better than a blank/error screen.
  async function restoreCache(): Promise<boolean> {
    try {
      const raw = await AsyncStorage.getItem(PRAYER_CACHE_KEY);
      if (!raw) return false;
      const c = JSON.parse(raw);
      // Handle both tab format (timings) and AppContext IFIS format (todayT)
      const timingsData    = c.timings ?? c.todayT ?? null;
      const tomTimingsData = c.tomorrowTimings ?? c.tomT ?? null;
      if (!timingsData) return false;
      timingsRef.current         = timingsData;
      tomorrowTimingsRef.current = tomTimingsData;
      loadedDateRef.current      = c.date;
      setTimings(timingsData);
      setTomorrowTimings(tomTimingsData);
      setHijri(c.hijri);
      // Only update location display when the cache includes location fields.
      // AppContext writes to the same key without suburb/cityName — blanking these
      // would leave the city empty until the subsequent network fetch completes.
      const cityFromIfisKey = c.key?.startsWith?.('ifis:') ? getIfisCityDisplayName(c.key.split(':')[1] ?? '') : '';
      if ('suburb' in c) setSuburb(c.suburb || '');
      if ('cityName' in c || cityFromIfisKey) setCityName(c.cityName || cityFromIfisKey || '');
      if ('country' in c) setCountry(c.country || '');
      if ('tomorrowLabel' in c) setTomorrowLabel(c.tomorrowLabel || '');
      // Use timingsData (normalised above) instead of c.timings directly — AppContext-format
      // caches use todayT rather than timings, so c.timings would be undefined here.
      const np = getNextPrayer(timingsData);
      const todayFajrMinC = timingsData['Fajr'] ? timeToMinutes(timingsData['Fajr']) : -1;
      const isPostMidnightC = np === 'Fajr' && todayFajrMinC >= 0 && todayFajrMinC <= nowMinutes();
      const initTimeC = isPostMidnightC && tomTimingsData?.['Fajr']
        ? tomTimingsData['Fajr']
        : (timingsData[np] || '');
      setNextPrayer(np);
      setActivePrayer(getActivePrayer(timingsData));
      setCountdown(getTimeUntil(initTimeC));
      startCountdownInterval();
      return true;
    } catch { return false; }
  }

  // Prayer times change once per day; 10 min cooldown is plenty.
  const FETCH_COOLDOWN_MS = 10 * 60_000;

  // Haversine distance in metres between two GPS coordinates.
  function gpsDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6_371_000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function loadPrayerTimes() {
    // Guard 1: skip if a fetch is already in flight
    if (reloadingRef.current) return;

    const [settingsRaw, locationRaw] = await Promise.all([
      AsyncStorage.getItem('andalus_settings'),
      AsyncStorage.getItem('andalus_location'),
    ]);
    const saved                  = settingsRaw ? JSON.parse(settingsRaw) : {};
    const method: number         = saved.calculationMethod ?? 3;
    const school: number         = saved.school ?? 0;
    const autoLocation: boolean  = saved.autoLocation ?? true;
    const prayerSource           = (saved.prayerSource ?? 'aladhan') as 'aladhan' | 'ifis';
    const ifisCity: string       = saved.ifisCity ?? 'stockholm';
    autoLocationRef.current = autoLocation;

    // Guard 2: respect 10-minute cooldown, but bypass it when settings were
    // changed after the last fetch (e.g. user switched AlAdhan ↔ IFIS).
    if (Date.now() - lastFetchRef.current < FETCH_COOLDOWN_MS) {
      try {
        const updatedRaw = await AsyncStorage.getItem('andalus_settings_updated');
        const updatedAt  = updatedRaw ? parseInt(updatedRaw, 10) : 0;
        if (updatedAt <= lastFetchRef.current) return; // no settings change — keep cooldown
        // Settings changed since last fetch — fall through and re-fetch
      } catch { return; }
    }

    reloadingRef.current = true;

    // ── IFIS path: no GPS needed — city is set by settings/auto-match in AppContext ──
    if (prayerSource === 'ifis') {
      try {
        await restoreCache();
        await fetchAndSetIfisTimesForTab(ifisCity);
      } catch { /* IFIS failure — stale data from restoreCache() stays visible */ }
      lastFetchRef.current = Date.now();
      reloadingRef.current = false;
      return;
    }

    // ── AlAdhan path ──
    if (!autoLocation && !locationRaw) {
      setShowNoLocation(true);
      reloadingRef.current = false;
      return;
    }
    setShowNoLocation(false);

    try {
      await restoreCache();  // show stale data instantly; await is safe (AsyncStorage ~2ms vs GPS+API ~500ms+)

      let lat: number, lng: number;
      let resolvedCity = '', resolvedCountry = '', resolvedSuburb = '';

      if (!autoLocation && locationRaw) {
        const loc       = JSON.parse(locationRaw);
        lat             = loc.lat;
        lng             = loc.lng;
        resolvedCity    = loc.city        || '';
        resolvedCountry = loc.country     || '';
        resolvedSuburb  = loc.subLocality || '';
      } else {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          setShowNoLocation(true);
          reloadingRef.current = false;
          return;
        }
        const loc = await Location.getCurrentPositionAsync({});
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;

        // Skip reverse geocoding if we haven't moved more than 500 m —
        // reuse the cached city/suburb/country to avoid unnecessary API calls.
        const cachedLoc = locationRaw ? (() => { try { return JSON.parse(locationRaw); } catch { return null; } })() : null;
        const movedFar = !cachedLoc
          || gpsDistance(cachedLoc.lat, cachedLoc.lng, lat, lng) >= 500;

        if (!movedFar && cachedLoc) {
          resolvedCity    = cachedLoc.city        || '';
          resolvedSuburb  = cachedLoc.subLocality || '';
          resolvedCountry = cachedLoc.country     || '';
        } else {
          try {
            const geo = await nativeReverseGeocode(lat, lng);
            resolvedCity    = geo.city;
            resolvedSuburb  = geo.subLocality;
            resolvedCountry = geo.country;
            await AsyncStorage.setItem('andalus_location', JSON.stringify({
              lat, lng,
              city:        geo.city,
              subLocality: geo.subLocality,
              country:     geo.country,
            })).catch(() => {});
          } catch { /* geocoding failed — prayer fetch continues without city name */ }
        }
      }

      try {
        await fetchAndSetTimes(lat, lng, method, school, resolvedCity, resolvedCountry, resolvedSuburb);
      } catch {
        // API failed — fallback priority:
        //   1. valid daily cache for today  (readDailyCache validates date)
        //   2. yearly cache for today       (getTodayFromYearlyCache)
        //   3. stale data from restoreCache() remains visible as emergency last resort
        const local = await getPrayerTimesWithFallback(resolvedCity, lat, lng, method, school);
        if (local) {
          timingsRef.current         = local.todayT;
          tomorrowTimingsRef.current = local.tomT;
          loadedDateRef.current      = new Date().toDateString();
          setTimings(local.todayT);
          setTomorrowTimings(local.tomT);
          const np       = getNextPrayer(local.todayT);
          const fajrMin  = local.todayT['Fajr'] ? timeToMinutes(local.todayT['Fajr']) : -1;
          const isPost   = np === 'Fajr' && fajrMin >= 0 && fajrMin <= nowMinutes();
          const initTime = isPost && local.tomT?.['Fajr'] ? local.tomT['Fajr'] : (local.todayT[np] || '');
          setNextPrayer(np);
          setActivePrayer(getActivePrayer(local.todayT));
          setCountdown(getTimeUntil(initTime));
          startCountdownInterval();
        }
        // local === null: stale data from restoreCache() stays in refs — no action needed
      }
    } catch { /* GPS/location failure — silently keep whatever cache was loaded */ }
    lastFetchRef.current = Date.now();
    reloadingRef.current = false;
  }

  async function fetchAndSetIfisTimesForTab(city: string) {
    const { todayT, tomT } = await getIfisTodayAndTomorrow(city);
    const displayName = getIfisCityDisplayName(city);

    timingsRef.current         = todayT;
    tomorrowTimingsRef.current = tomT ?? null;
    loadedDateRef.current      = new Date().toDateString();
    setTimings(todayT);
    setTomorrowTimings(tomT ?? null);
    setSuburb('');
    setCityName(displayName);
    setCountry('Sverige');

    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowLbl = tomorrowDate
      .toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })
      .toUpperCase();
    setTomorrowLabel(tomorrowLbl);

    AsyncStorage.setItem(PRAYER_CACHE_KEY, JSON.stringify({
      date:           new Date().toDateString(),
      timings:        todayT,
      tomorrowTimings: tomT ?? null,
      hijri:          app.hijriDate ?? null,
      suburb:         '',
      cityName:       displayName,
      country:        'Sverige',
      tomorrowLabel:  tomorrowLbl,
      prayerSource:   'ifis',
    })).catch(() => {});

    const np          = getNextPrayer(todayT);
    const todayFajrMin = todayT['Fajr'] ? timeToMinutes(todayT['Fajr']) : -1;
    const isPostMidnight = np === 'Fajr' && todayFajrMin >= 0 && todayFajrMin <= nowMinutes();
    const initTime    = isPostMidnight && tomT?.['Fajr'] ? tomT['Fajr'] : (todayT[np] || '');
    setNextPrayer(np);
    setActivePrayer(getActivePrayer(todayT));
    setCountdown(getTimeUntil(initTime));
    startCountdownInterval();

    // Sync AppContext so home screen reflects these IFIS times if the tab fetches first
    appDispatch({ type: 'SET_PRAYER_TIMES',   payload: todayT });
    if (tomT) appDispatch({ type: 'SET_TOMORROW_TIMES', payload: tomT });
  }

  async function handleEmptyStateCitySelected(r: CityResult) {
    await AsyncStorage.setItem('andalus_location', JSON.stringify({
      lat: r.latitude, lng: r.longitude, city: r.city, country: r.country,
    }));
    const settingsRaw = await AsyncStorage.getItem('andalus_settings');
    const settings    = settingsRaw ? JSON.parse(settingsRaw) : {};
    await AsyncStorage.setItem('andalus_settings', JSON.stringify({ ...settings, autoLocation: false }));
    await AsyncStorage.setItem('andalus_settings_updated', Date.now().toString());
    setShowNoLocation(false);
    loadPrayerTimes();
  }

  async function handleEmptyStateGPS() {
    setNoLocationGpsLoading(true);
    await refreshWithGPS();
    if (timingsRef.current) setShowNoLocation(false);
    setNoLocationGpsLoading(false);
  }

  async function fetchAndSetTimes(
    lat: number, lng: number, method: number, school: number,
    resolvedCity: string, resolvedCountry: string, resolvedSuburb: string,
  ) {
    const today    = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;

    const requests: Promise<Response>[] = [
      fetch(`https://api.aladhan.com/v1/timings/${fmt(today)}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`),
      fetch(`https://api.aladhan.com/v1/timings/${fmt(tomorrow)}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`),
      fetch(`https://api.aladhan.com/v1/timings/${fmt(dayAfter)}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`),
    ];

    const [results, geoResult] = await Promise.all([
      Promise.all(requests),
      !resolvedCity ? nativeReverseGeocode(lat, lng) : Promise.resolve(null),
    ]);
    const j1        = await results[0].json();
    const j2        = await results[1].json();
    const j3        = await results[2].json();
    const t         = j1.data.timings;
    const tTom      = j2.data.timings;
    const tDayAfter = j3.data.timings;

    const mapped: Record<string, string> = {
      Fajr: stripTz(t.Fajr), Sunrise: stripTz(t.Sunrise), Dhuhr: stripTz(t.Dhuhr),
      Asr: stripTz(t.Asr), Maghrib: stripTz(t.Maghrib), Isha: stripTz(t.Isha),
      Midnight: calcMidnight(stripTz(t.Maghrib), stripTz(tTom.Fajr)) || '',
    };
    const mappedTomorrow: Record<string, string> = {
      Fajr: stripTz(tTom.Fajr), Sunrise: stripTz(tTom.Sunrise), Dhuhr: stripTz(tTom.Dhuhr),
      Asr: stripTz(tTom.Asr), Maghrib: stripTz(tTom.Maghrib), Isha: stripTz(tTom.Isha),
      Midnight: calcMidnight(stripTz(tTom.Maghrib), stripTz(tDayAfter.Fajr)) || '',
    };

    timingsRef.current         = mapped;
    tomorrowTimingsRef.current = mappedTomorrow;
    loadedDateRef.current      = new Date().toDateString();
    setTimings(mapped);
    setTomorrowTimings(mappedTomorrow);
    setHijri(j1.data.date?.hijri);

    if (!resolvedCity && geoResult) {
      resolvedCity    = geoResult.city;
      resolvedSuburb  = geoResult.subLocality;
      resolvedCountry = geoResult.country;
    }
    setSuburb(resolvedSuburb);
    setCityName(resolvedCity);
    setCountry(resolvedCountry);

    const tomorrowLbl = tomorrow.toLocaleDateString('sv-SE', { weekday:'long', day:'numeric', month:'long' }).toUpperCase();
    setTomorrowLabel(tomorrowLbl);

    try {
      await AsyncStorage.setItem(PRAYER_CACHE_KEY, JSON.stringify({
        date: new Date().toDateString(),
        timings: mapped, tomorrowTimings: mappedTomorrow,
        hijri: j1.data.date?.hijri,
        suburb: resolvedSuburb, cityName: resolvedCity, country: resolvedCountry,
        tomorrowLabel: tomorrowLbl,
      }));
    } catch {}

    const np = getNextPrayer(mapped);
    const todayFajrMin = mapped['Fajr'] ? timeToMinutes(mapped['Fajr']) : -1;
    const isPostMidnight = np === 'Fajr' && todayFajrMin >= 0 && todayFajrMin <= nowMinutes();
    const initTime = isPostMidnight && mappedTomorrow['Fajr']
      ? mappedTomorrow['Fajr']
      : (mapped[np] || '');
    setNextPrayer(np);
    setActivePrayer(getActivePrayer(mapped));
    setCountdown(getTimeUntil(initTime));
    startCountdownInterval();

    if (resolvedCity) {
      appDispatch({ type: 'SET_LOCATION', payload: {
        latitude: lat, longitude: lng,
        city:     resolvedCity,
        suburb:   resolvedSuburb,
        country:  resolvedCountry,
      }});
    }
    appDispatch({ type: 'SET_PRAYER_TIMES',   payload: mapped });
    appDispatch({ type: 'SET_TOMORROW_TIMES', payload: mappedTomorrow });

    if (Platform.OS === 'ios' && resolvedCity) {
      const h = j1.data.date?.hijri;
      updateWidgetData({
        city:      resolvedSuburb || resolvedCity,
        latitude:  lat,
        longitude: lng,
        prayers: [
          { name: 'Fajr',       time: mapped.Fajr    ?? '' },
          { name: 'Soluppgång', time: mapped.Sunrise  ?? '' },
          { name: 'Dhuhr',      time: mapped.Dhuhr   ?? '' },
          { name: 'Asr',        time: mapped.Asr     ?? '' },
          { name: 'Maghrib',    time: mapped.Maghrib ?? '' },
          { name: 'Isha',       time: mapped.Isha    ?? '' },
        ],
        hijri: {
          day:         parseInt(h?.day ?? '0', 10),
          monthNumber: parseInt(h?.month?.number ?? '0', 10),
          monthNameEn: h?.month?.en ?? '',
          year:        parseInt(h?.year ?? '0', 10),
        },
        date:      new Date().toISOString().slice(0, 10),
        timestamp: Date.now() / 1000,
      }).catch(() => {});
    }
  }

  async function refreshWithGPS() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Plats', 'Platsåtkomst nekad'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      const { latitude: lat, longitude: lng } = loc.coords;

      const geo = await nativeReverseGeocode(lat, lng);

      await AsyncStorage.setItem('andalus_location', JSON.stringify({
        lat, lng,
        city:        geo.city,
        subLocality: geo.subLocality,
        country:     geo.country,
      }));

      const settingsRaw = await AsyncStorage.getItem('andalus_settings');
      const saved = settingsRaw ? JSON.parse(settingsRaw) : {};
      const method: number = saved.calculationMethod ?? 3;
      const school: number = saved.school ?? 0;

      await fetchAndSetTimes(lat, lng, method, school, geo.city, geo.country, geo.subLocality);
    } catch { Alert.alert('Fel', 'Kunde inte hämta plats'); }
  }

  async function handleRefresh() {
    if (autoLocationRef.current) {
      setRefreshing(true);
      lastFetchRef.current = 0; // bypass cooldown for explicit pull-to-refresh
      await loadPrayerTimes();
      setRefreshing(false);
    } else {
      Alert.alert(
        'Uppdatera plats',
        'Vill du uppdatera bönetiderna till din nuvarande GPS-plats? Nuvarande stad i inställningar uppdateras.',
        [
          { text: 'Avbryt', style: 'cancel' },
          { text: 'Uppdatera', onPress: async () => {
            setRefreshing(true);
            await refreshWithGPS();
            setRefreshing(false);
          }},
        ]
      );
    }
  }

  if (showNoLocation) return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={{ paddingTop: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <HidayahLogo size={52} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          {/* Masjid-ikon — vänster om månadskalendern → öppnar "Närmaste masjid" */}
          <TouchableOpacity onPress={() => router.push('/masjid' as any)} hitSlop={TOPBAR_HIT_SLOP}>
            <SvgXml xml={masjidIconXml(T.textMuted)} width={MASJID_ICON_SIZE} height={MASJID_ICON_SIZE} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/monthly' as any)} hitSlop={TOPBAR_HIT_SLOP}>
            <SvgXml xml={calendarXml(T.textMuted)} width={CALENDAR_ICON_SIZE} height={CALENDAR_ICON_SIZE} />
          </TouchableOpacity>
          {/* Inställningar-ikon — längst ut till höger (samma glyph-storlek som hemskärmen/Visa mer) */}
          <TouchableOpacity onPress={() => router.push('/settings' as any)} hitSlop={TOPBAR_HIT_SLOP}>
            <SvgIcon name="settings" size={SETTINGS_ICON_SIZE} color={T.textMuted} />
          </TouchableOpacity>
        </View>
        <MasjidTipBubble visible={showMasjidTip} top={MASJID_TIP_TOP} onDismiss={dismissMasjidTip} />
      </View>
      <PrayerEmptyState
        T={T}
        onCitySelected={handleEmptyStateCitySelected}
        onUseGPS={handleEmptyStateGPS}
        gpsLoading={noLocationGpsLoading}
      />
    </View>
  );


  const dateStr   = new Date().toLocaleDateString('sv-SE', { weekday:'long', day:'numeric', month:'long' });
  const hijriStr  = hijri ? `${hijri.day} ${hijri.month.en} ${hijri.year} AH` : '';
  const isPreFajr = nextPrayer === 'Fajr';
  const todayFajrMin = timings?.['Fajr'] ? timeToMinutes(timings['Fajr']) : -1;
  const isPostMidnight = isPreFajr && todayFajrMin >= 0 && todayFajrMin <= nowMinutes();
  const nextTime  = (isPostMidnight && tomorrowTimings?.['Fajr'])
    ? tomorrowTimings['Fajr']
    : (timings?.[nextPrayer] || '');

  return (
    <ScrollView
      style={{ flex:1, backgroundColor: T.bg }}
      contentContainerStyle={{ flex:1 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={T.accent}
        />
      }
    >

      {/* ── Logo + monthly calendar icon ── */}
      <View style={{ paddingTop:56, paddingHorizontal:20, flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
        <HidayahLogo size={52} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          {/* Masjid-ikon — vänster om månadskalendern → öppnar "Närmaste masjid" */}
          <TouchableOpacity onPress={() => router.push('/masjid' as any)} hitSlop={TOPBAR_HIT_SLOP}>
            <SvgXml xml={masjidIconXml(T.textMuted)} width={MASJID_ICON_SIZE} height={MASJID_ICON_SIZE} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/monthly' as any)} hitSlop={TOPBAR_HIT_SLOP}>
            <SvgXml xml={calendarXml(T.textMuted)} width={CALENDAR_ICON_SIZE} height={CALENDAR_ICON_SIZE} />
          </TouchableOpacity>
          {/* Inställningar-ikon — längst ut till höger (samma glyph-storlek som hemskärmen/Visa mer) */}
          <TouchableOpacity onPress={() => router.push('/settings' as any)} hitSlop={TOPBAR_HIT_SLOP}>
            <SvgIcon name="settings" size={SETTINGS_ICON_SIZE} color={T.textMuted} />
          </TouchableOpacity>
        </View>
        <MasjidTipBubble visible={showMasjidTip} top={MASJID_TIP_TOP} onDismiss={dismissMasjidTip} />
      </View>

      {/* ── Refresh spinner (fades above date) ── */}
      <Animated.View style={{ alignItems:'center', height:18, justifyContent:'center', opacity: refreshOpacity }} pointerEvents="none">
        <ActivityIndicator size="small" color={T.accent} />
      </Animated.View>

      {/* ── Date + location ── */}
      <View style={{ paddingTop:2, paddingHorizontal:20, paddingBottom:6, alignItems:'center' }}>
        <Text style={{ fontSize:15, color: T.text, fontWeight:'400', textAlign:'center' }}>
          {dateStr.charAt(0).toUpperCase()+dateStr.slice(1)}
        </Text>
        <Text style={{ fontSize:15, color: T.text, fontWeight:'400', textAlign:'center', marginBottom:6 }}>
          {hijriStr}
        </Text>
        <Text style={{ fontSize:12, color: T.textMuted, textAlign:'center' }}>
          Du följer bönetiderna i
        </Text>
        {(() => {
          // suburb may be empty if cache was saved before split logic existed —
          // in that case cityName holds the full "Spånga, Stockholm" string.
          // Always derive the display pair so suburb shows small on its own line.
          const raw = suburb && cityName
            ? `${suburb}, ${cityName}`
            : (cityName || suburb);
          const split = splitCity(raw);
          return (
            <>
              {split.suburb ? (
                <Text style={{ fontSize:13, color: T.textMuted, textAlign:'center', marginTop:4 }}>
                  {split.suburb}
                </Text>
              ) : null}
              <Text style={{ fontSize:24, fontWeight:'bold', color: T.text, textAlign:'center', marginTop:2 }}>
                {split.cityName || split.suburb}
              </Text>
            </>
          );
        })()}
      </View>

      {/* ── Countdown ── */}
      <View style={{ marginHorizontal:16, backgroundColor: T.card, borderRadius:16, paddingVertical:12, paddingHorizontal:20, alignItems:'center', marginBottom:10, ...(!isDark && { borderWidth: 1.5, borderColor: 'rgba(42,64,48,0.5)' }) }}>
        <Text style={{ fontSize:11, color: isDark ? '#cab488' : T.accent, letterSpacing:1.5, fontWeight:'600', marginBottom:6 }}>
          TID KVAR TILL {PRAYER_NAMES[nextPrayer]?.toUpperCase()}
        </Text>
        <Text style={{ fontSize:38, fontWeight:'bold', color: isDark ? '#cab488' : T.accent, letterSpacing:1, fontVariant:['tabular-nums'], marginBottom:4 }}>
          {countdown}
        </Text>
        <Text style={{ fontSize:14, color: T.textMuted }}>
          {PRAYER_NAMES[nextPrayer]} kl. {nextTime}
        </Text>
      </View>

      {/* ── Animated section label ── */}
      <View style={{ height:22, marginHorizontal:16, marginTop:13, marginBottom:8 }}>

        {/* Today label — slides left + fades out */}
        <Animated.View style={{
          position:'absolute', left:0, right:0,
          flexDirection:'row', alignItems:'center', justifyContent:'space-between',
          opacity: todayLabelOpacity,
          transform: [{ translateX: todayLabelTranslateX }],
        }}>
          <Text style={{ fontSize:11, fontWeight:'700', color: T.textMuted, letterSpacing:1.5 }}>
            DAGENS BÖNER
          </Text>
          <Animated.Text style={{ fontSize:11, color: T.textMuted, fontWeight:'500', opacity: swipeHintTodayOpacity }}>
            → Swipe för imorgon
          </Animated.Text>
        </Animated.View>

        {/* Tomorrow label — slides in from right + fades in */}
        <Animated.View style={{
          position:'absolute', left:0, right:0,
          flexDirection:'row', alignItems:'center', justifyContent:'space-between',
          opacity: tomorrowLabelOpacity,
          transform: [{ translateX: tomorrowLabelTranslateX }],
        }}>
          <Text style={{ fontSize:11, fontWeight:'700', color: T.textMuted, letterSpacing:1.2 }}>
            IMORGON · {tomorrowLabel}
          </Text>
          <Animated.Text style={{ fontSize:11, color: T.textMuted, fontWeight:'500', opacity: swipeHintTomorrowOpacity }}>
            ← Swipe för idag
          </Animated.Text>
        </Animated.View>

      </View>

      {/* ── Swipeable prayer list ── */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        directionalLockEnabled
        onScroll={e => scrollX.setValue(e.nativeEvent.contentOffset.x)}
        style={{ flex:1 }}
      >
        {/* Page 1 — Today with glow & gold border indicators */}
        <View style={{ width }}>
          <View style={{ marginHorizontal:16, backgroundColor: T.card, borderRadius:16, overflow:'hidden' }}>

            {PRAYER_ORDER.map((key, i) => {
              const isActive  = key === activePrayer;
              // When post-midnight (halva natten passed, still before 00:00), the countdown
              // points to tomorrow's Fajr — don't highlight any row in today's list.
              const isNext    = key === nextPrayer && !isPostMidnight;

              const nextColor  = isDark ? '#cab488' : T.accent;
              const activeColor = isDark ? '#ffffff' : '#000000';
              // Passed and upcoming prayers render in full text colour at 100% opacity;
              // only the active/next prayer gets a tinted highlight.
              const nameColor = isActive ? activeColor : isNext ? nextColor : T.text;
              const timeColor = isActive ? activeColor : isNext ? nextColor : T.text;
              // Shuruq is not a prayer — its row must never render in bold/semibold,
              // even when it's the active or next event. Colour/glow stay as-is.
              const weight: '700' | '600' | '400' =
                key === 'Sunrise' ? '400' : isActive ? '700' : isNext ? '600' : '400';
              const rowOpacity = 1;

              return (
                <React.Fragment key={key}>
                  <View
                    onLayout={e => {
                      const { y, height } = e.nativeEvent.layout;
                      rowLayouts.current[key] = { y, height };
                    }}
                    style={{
                      flexDirection:'row', alignItems:'center',
                      height: 48, paddingHorizontal:16,
                      backgroundColor: 'transparent',
                      opacity: rowOpacity,
                    }}
                  >
                    {/* Next prayer highlight — SVG gradient glow + left bar */}
                    {isNext && (
                      <>
                        <Svg style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} width="100%" height="100%">
                          <Defs>
                            <SvgLinearGradient id="hGlow" x1="0" y1="0" x2="1" y2="0">
                              <Stop offset="0"    stopColor={nextColor} stopOpacity={0} />
                              <Stop offset="0.25" stopColor={nextColor} stopOpacity={isDark ? 0.09 : 0.07} />
                              <Stop offset="0.5"  stopColor={nextColor} stopOpacity={isDark ? 0.14 : 0.10} />
                              <Stop offset="0.75" stopColor={nextColor} stopOpacity={isDark ? 0.09 : 0.07} />
                              <Stop offset="1"    stopColor={nextColor} stopOpacity={0} />
                            </SvgLinearGradient>
                            <SvgLinearGradient id="vGlow" x1="0" y1="0" x2="0" y2="1">
                              <Stop offset="0"   stopColor={nextColor} stopOpacity={0} />
                              <Stop offset="0.5" stopColor={nextColor} stopOpacity={isDark ? 0.06 : 0.05} />
                              <Stop offset="1"   stopColor={nextColor} stopOpacity={0} />
                            </SvgLinearGradient>
                          </Defs>
                          <Rect x="0" y="0" width="100%" height="100%" fill="url(#hGlow)" />
                          <Rect x="0" y="0" width="100%" height="100%" fill="url(#vGlow)" />
                        </Svg>
                        <View style={{
                          position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
                          backgroundColor: nextColor,
                          borderTopRightRadius: 2, borderBottomRightRadius: 2,
                        }} />
                      </>
                    )}
                    <View style={{ flexDirection:'row', alignItems:'center', flex:1 }}>
                      <Text style={{ fontSize:16, color: nameColor, fontWeight: weight }}>
                        {PRAYER_NAMES[key]}
                      </Text>
                    </View>
                    <Text style={{ fontSize:16, color: timeColor, fontWeight: weight }}>
                      {timings?.[key] || ''}
                    </Text>
                  </View>
                  {i < PRAYER_ORDER.length - 1 && (
                    <View style={{ height:0.5, marginHorizontal:16, backgroundColor: T.separator }} />
                  )}
                </React.Fragment>
              );
            })}

          </View>
        </View>

        {/* Page 2 — Tomorrow */}
        <View style={{ width }}>
          <View style={{ marginHorizontal:16, backgroundColor: T.card, borderRadius:16, overflow:'hidden' }}>
            {PRAYER_ORDER.map((key, i) => {
              // When post-midnight, Fajr is the next prayer and belongs to tomorrow's list.
              // Highlight it the same way as isNext on page 1.
              const isTomNext = isPostMidnight && key === 'Fajr';
              const nextColor = isDark ? '#cab488' : T.accent;
              // Tomorrow's prayers also render at 100% opacity — only the
              // post-midnight Fajr highlight uses the accent colour.
              const tomRowOpacity = 1;
              const nameColor = isTomNext ? nextColor : T.text;
              const weight: '600' | '400' = isTomNext ? '600' : '400';

              return (
              <React.Fragment key={key}>
                <View style={{
                  flexDirection:'row', alignItems:'center',
                  height: 48, paddingHorizontal:16,
                  backgroundColor:'transparent',
                  opacity: tomRowOpacity,
                }}>
                  {/* Next prayer highlight glow — only when post-midnight on Fajr */}
                  {isTomNext && (
                    <>
                      <Svg style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} width="100%" height="100%">
                        <Defs>
                          <SvgLinearGradient id="tGlow" x1="0" y1="0" x2="1" y2="0">
                            <Stop offset="0"    stopColor={nextColor} stopOpacity={0} />
                            <Stop offset="0.25" stopColor={nextColor} stopOpacity={isDark ? 0.09 : 0.07} />
                            <Stop offset="0.5"  stopColor={nextColor} stopOpacity={isDark ? 0.14 : 0.10} />
                            <Stop offset="0.75" stopColor={nextColor} stopOpacity={isDark ? 0.09 : 0.07} />
                            <Stop offset="1"    stopColor={nextColor} stopOpacity={0} />
                          </SvgLinearGradient>
                        </Defs>
                        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tGlow)" />
                      </Svg>
                      <View style={{
                        position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
                        backgroundColor: nextColor,
                        borderTopRightRadius: 2, borderBottomRightRadius: 2,
                      }} />
                    </>
                  )}
                  <View style={{ flexDirection:'row', alignItems:'center', flex:1 }}>
                    <Text style={{ fontSize:16, color: nameColor, fontWeight: weight }}>
                      {PRAYER_NAMES[key]}
                    </Text>
                  </View>
                  <Text style={{ fontSize:16, color: nameColor, fontWeight: weight }}>
                    {tomorrowTimings?.[key] || ''}
                  </Text>
                </View>
                {i < PRAYER_ORDER.length - 1 && (
                  <View style={{ height: 0.5, marginHorizontal: 16, backgroundColor: T.separator }} />
                )}
              </React.Fragment>
              );
            })}
          </View>
        </View>

      </ScrollView>

    </ScrollView>
  );
}
