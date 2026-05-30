/**
 * "Närmaste masjid" — isolated map + list feature.
 *
 * ISOLATION (critical): every bit of masjid logic — the MapLibre WebView, GPS
 * reads, fetches, state — lives ONLY in this route. Navigating back unmounts
 * this screen, which unmounts the WebView (killing all map JS, listeners and CSS
 * animations) and runs the cleanup below. Nothing masjid-related keeps running
 * on the prayer-times tab when the feature is closed.
 *
 * Cleanup on unmount: abort the in-flight Supabase request and mark unmounted so
 * no late async callback updates state. No intervals, no timeouts, no geolocation
 * watcher, no realtime subscriptions, no background retries are ever started.
 *
 * Data source: Supabase only (approved mosques via nearby_mosques RPC).
 * NO Google APIs. Directions open an external maps app with a lat/lng URL only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import BackButton from '../components/BackButton';
import { listIconXml } from '../constants/listIcon';
import { useMasjidLocation } from '../hooks/useMasjidLocation';
import {
  fetchNearbyApprovedMosques,
  type Mosque, type MosqueSearchResult, MASJID_FETCH_LIMIT, MASJID_COLLAPSED_COUNT,
} from '../services/mosques';
import { geocodePlace } from '../services/nominatim';
import MasjidMapView, { type MasjidMapHandle } from '../components/masjid/MasjidMapView';
import MasjidPermissionGate from '../components/masjid/MasjidPermissionGate';
import MasjidList, { type SheetMode } from '../components/masjid/MasjidList';
import MasjidSearchBar from '../components/masjid/MasjidSearchBar';
import MasjidCard from '../components/masjid/MasjidCard';
import AddMasjidModal from '../components/masjid/AddMasjidModal';
import MasjidAddTipBubble from '../components/masjid/MasjidAddTipBubble';
import DirectionsSheet, { type DirectionsTarget } from '../components/masjid/DirectionsSheet';
import { masjidIconColor } from '../components/masjid/colors';
import MasjidOfflineBanner from '../components/masjid/MasjidOfflineBanner';

// "Lägg till en ny masjid" hint — shown once per week max, for 5 seconds.
// Owned at the screen level (NOT inside the bubble component) so the timer is
// guaranteed to clear on unmount per CLAUDE.md's lifecycle rules.
// Key bumped to v2 after the v1 positioning bug: v1 stamped the timestamp on
// open even though the bubble was rendered behind the bottom-sheet panel and
// never actually visible, which would silently lock anyone who installed v1
// out of the hint for a week. v2 forces a single fresh showing for everyone.
const ADD_TIP_KEY         = 'andalus_add_masjid_tip_last_shown_v2';
const ADD_TIP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // one week
const ADD_TIP_DURATION_MS = 5 * 1000;

// Mirror of MasjidList's panel sizing — used to compute how far to slide the
// right-side FAB stack down when the sheet collapses so the bottom FAB lines up
// horizontally with the list ball in the opposite corner. Must stay in sync
// with the BASE_H / ROW_H constants in `components/masjid/MasjidList.tsx`.
const PANEL_ROW_H  = 58;
const PANEL_BASE_H = 115;

// Great-circle distance (metres) between two lat/lng points. Used to show a
// searched masjid's REAL distance from the user on its card — the nearby RPC
// re-runs from the searched point, so its own distance there is always 0.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export default function MasjidScreen() {
  const { theme: T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { status, requesting, requestPermission } = useMasjidLocation();

  const mapRef = useRef<MasjidMapHandle>(null);

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [mosques, setMosques] = useState<Mosque[]>([]);
  const [loading, setLoading] = useState(true);
  // Bottom-sheet snap mode: 'default' (3 nearest, map visible) | 'expanded' (all, nearly full screen).
  const [sheetMode, setSheetMode] = useState<SheetMode>('default');
  const [selected, setSelected] = useState<Mosque | null>(null);
  const [directions, setDirections] = useState<DirectionsTarget | null>(null);
  // Bumped to clear the search bar (e.g. on "Min position").
  const [searchResetSignal, setSearchResetSignal] = useState(0);
  const [addVisible, setAddVisible] = useState(false);
  const [showAddTip, setShowAddTip] = useState(false);
  // Connectivity for the local offline banner — reported by the map WebView.
  const [online, setOnline] = useState<boolean>(true);

  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const loadedOnceRef = useRef(false);
  const addTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether we were offline, so the connectivity effect only re-fetches
  // on a real offline→online transition (not on the first online render).
  const wasOfflineRef = useRef(false);
  // Mirror userLoc into a ref so the reconnect-retry effect reads the latest
  // position without re-subscribing on every GPS update (CLAUDE.md refs rule).
  const userLocRef = useRef(userLoc);
  userLocRef.current = userLoc;

  // Card slide-up animation. `visibleSelected` mirrors `selected` but lingers
  // through the closing spring so the card stays mounted while it animates back
  // down. translateY is driven from off-screen-below (cardSlideRef.current) to 0
  // when opening; scrim opacity fades in parallel. Same spring config (tension
  // 90, friction 14) as MasjidList — keeps the two surfaces feeling consistent.
  const [visibleSelected, setVisibleSelected] = useState<Mosque | null>(null);
  const cardSlideRef = useRef(440);                  // refined by onLayout
  const cardTranslateY = useRef(new Animated.Value(440)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;

  // Remembers the list snap point the user had before a card forced it into
  // 'shrunk', so closing the card springs the list back to exactly that mode
  // (expanded → expanded, default → default, collapsed → collapsed).
  // Updated only on the non-shrunk → shrunk transition so marker→marker
  // selections don't overwrite it with 'shrunk'.
  const prevSheetModeRef = useRef<SheetMode>('default');

  // "List" ball — the round bottom-left button shown when the user drags the
  // list off-screen ('collapsed'). Spring-fades in/out with the same config as
  // the card/list so the three surfaces move as one. Kept mounted through the
  // exit spring (ballMounted lags ballAnim → 0) to avoid an instant pop-out.
  const [ballMounted, setBallMounted] = useState(false);
  const ballAnim = useRef(new Animated.Value(0)).current;

  // Right-side FAB stack (+ above, locate below). The stack sits ABOVE the
  // list panel in layout, so when the panel translates off-screen on collapse
  // the FABs are stranded mid-screen. We spring this translateY in parallel
  // with the panel/ball so the stack slides down to the bottom-right corner,
  // ending up horizontally level with the list ball in the opposite corner.
  const fabStackTranslateY = useRef(new Animated.Value(0)).current;

  const dismissAddTip = useCallback(() => {
    if (addTipTimerRef.current) {
      clearTimeout(addTipTimerRef.current);
      addTipTimerRef.current = null;
    }
    setShowAddTip(false);
  }, []);

  const openAddModal = useCallback(() => {
    dismissAddTip();
    setAddVisible(true);
  }, [dismissAddTip]);

  // Show the "Lägg till en ny masjid" hint at most once a week. Throttled via
  // AsyncStorage so navigating in/out of the screen doesn't burn through it on
  // the same day. Timer + state are cleared on unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw  = await AsyncStorage.getItem(ADD_TIP_KEY);
        const last = raw ? Number(raw) : 0;
        const now  = Date.now();
        if (!Number.isFinite(last) || now - last >= ADD_TIP_INTERVAL_MS) {
          await AsyncStorage.setItem(ADD_TIP_KEY, String(now));
          if (cancelled || !mountedRef.current) return;
          setShowAddTip(true);
          addTipTimerRef.current = setTimeout(() => {
            addTipTimerRef.current = null;
            if (mountedRef.current) setShowAddTip(false);
          }, ADD_TIP_DURATION_MS);
        }
      } catch {
        // Best-effort: if storage fails we simply skip the hint.
      }
    })();
    return () => {
      cancelled = true;
      if (addTipTimerRef.current) {
        clearTimeout(addTipTimerRef.current);
        addTipTimerRef.current = null;
      }
    };
  }, []);

  // Measured heights (px) of the bottom overlays, fed to the map as camera
  // padding so the selected/centred point sits in the VISIBLE map area above
  // them — not the raw viewport. Seeded with sensible estimates for the first
  // focus; corrected on layout. headerPad keeps the point clear of the top.
  const cardPadRef = useRef(360);
  const headerPad = insets.top + 52;
  const defaultSheetPad = insets.bottom + 300; // approx default-sheet height for min-position camera

  const nearestId = mosques[0]?.id ?? null;
  // Map shows ALL loaded markers; the bottom sheet shows a subset by mode.
  const points = useMemo(
    () => mosques.map((m) => ({ id: m.id, lat: m.latitude, lng: m.longitude })),
    [mosques],
  );

  // Replace any in-flight request with a fresh AbortController.
  const freshSignal = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl.signal;
  }, []);

  // Load mosques from a given origin (user GPS or, later, a searched place).
  // One fetch brings the full batch; the list collapses/expands client-side.
  const loadInitial = useCallback(async (lat: number, lng: number): Promise<Mosque[]> => {
    setLoading(true);
    setSheetMode('default'); // fresh origin → reset to the default 3-nearest view
    try {
      const signal = freshSignal();
      if (__DEV__) console.log('[Masjid] mosque data fetch started', lat, lng);
      const rows = await fetchNearbyApprovedMosques(lat, lng, MASJID_FETCH_LIMIT, 0, signal);
      if (!mountedRef.current) return [];
      if (__DEV__) console.log('[Masjid] mosque data fetch completed —', rows.length, 'rows');
      setMosques(rows);
      return rows;
    } catch {
      // AbortError or a real failure — keep current state, just stop the spinner.
      if (__DEV__) console.log('[Masjid] mosque data fetch failed/aborted');
      return [];
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [freshSignal]);

  // Read GPS once, then load mosques from the user's position.
  const fetchGpsAndLoad = useCallback(async () => {
    try {
      if (__DEV__) console.log('[Masjid] location fetch started');
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!mountedRef.current) return;
      const lat = loc.coords.latitude, lng = loc.coords.longitude;
      if (__DEV__) console.log('[Masjid] location fetch completed', lat, lng);
      setUserLoc({ lat, lng });
      await loadInitial(lat, lng);
    } catch {
      if (__DEV__) console.log('[Masjid] location fetch failed');
      if (mountedRef.current) setLoading(false);
    }
  }, [loadInitial]);

  // Kick off once permission is granted (guarded so it runs a single time).
  useEffect(() => {
    if (status === 'granted' && !loadedOnceRef.current) {
      loadedOnceRef.current = true;
      fetchGpsAndLoad();
    }
  }, [status, fetchGpsAndLoad]);

  // Auto-retry when connectivity returns. The WebView reports online/offline via
  // onConnectivity → `online`. On a real offline→online transition we re-call the
  // mosque API so the list/map recover on their own — previously the data stayed
  // frozen on the pre-offline state until the user tapped "Min position". We reuse
  // the last known position (no camera jump); if we never loaded, we read GPS.
  // freshSignal() inside loadInitial aborts any in-flight request, so connectivity
  // flapping can't stack overlapping fetches.
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return; // first online render or never went offline
    wasOfflineRef.current = false;
    if (!mountedRef.current || status !== 'granted') return;
    if (__DEV__) console.log('[Masjid] connectivity restored — auto-retrying mosque fetch');
    const loc = userLocRef.current;
    if (loc) loadInitial(loc.lat, loc.lng);
    else fetchGpsAndLoad();
  }, [online, status, loadInitial, fetchGpsAndLoad]);

  // Unmount: abort in-flight request, block late state updates, stop any
  // in-flight card animation. (No timers/watchers exist to clear.)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      geocodeAbortRef.current?.abort();
      cardTranslateY.stopAnimation();
      scrimOpacity.stopAnimation();
      ballAnim.stopAnimation();
      fabStackTranslateY.stopAnimation();
    };
  }, [cardTranslateY, scrimOpacity, ballAnim, fabStackTranslateY]);

  // Distance the right-side FAB stack must travel to land flush with the list
  // ball's vertical position when the sheet collapses. Computed off the same
  // BASE_H + min(count, COLLAPSED_COUNT) * ROW_H formula MasjidList uses for
  // its default-mode height, minus 4 px to align the locate FAB's bottom edge
  // (insets.bottom + 12) with the list ball's bottom edge (insets.bottom + 16).
  const fabCollapseShift = useMemo(
    () => PANEL_BASE_H + Math.min(mosques.length, MASJID_COLLAPSED_COUNT) * PANEL_ROW_H - 4,
    [mosques.length],
  );

  // Spring the FAB stack down on collapse and back up when the sheet returns.
  // Matches the panel/ball spring (tension 90, friction 14) so all three
  // surfaces land in the same beat. 'shrunk' keeps the stack at rest — the
  // card layer sits on top of it anyway, and sliding it down would expose
  // the FABs below the card.
  useEffect(() => {
    Animated.spring(fabStackTranslateY, {
      toValue: sheetMode === 'collapsed' ? fabCollapseShift : 0,
      tension: 90, friction: 14,
      useNativeDriver: true,
    }).start();
  }, [sheetMode, fabCollapseShift, fabStackTranslateY]);

  // Drive the ball spring on sheetMode change. Mount before the in-spring so
  // there's no first-frame flash at 0; clear after the out-spring lands so it
  // doesn't pop out mid-animation. Same spring config as MasjidCard/MasjidList.
  useEffect(() => {
    if (sheetMode === 'collapsed') {
      setBallMounted(true);
      Animated.spring(ballAnim, {
        toValue: 1, tension: 90, friction: 14, useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(ballAnim, {
        toValue: 0, tension: 90, friction: 14, useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && mountedRef.current) setBallMounted(false);
      });
    }
  }, [sheetMode, ballAnim]);

  // Drive the card's spring on `selected` change. Opening: snap to off-screen
  // first (so a re-open after a close doesn't flash at the previous resting
  // position), then spring up + fade scrim in parallel. Closing: spring down +
  // fade scrim, and only unmount the card (clear visibleSelected) when the
  // spring lands — otherwise the card would vanish mid-animation.
  useEffect(() => {
    if (selected) {
      cardTranslateY.setValue(cardSlideRef.current);
      scrimOpacity.setValue(0);
      setVisibleSelected(selected);
      Animated.parallel([
        Animated.spring(cardTranslateY, {
          toValue: 0, tension: 90, friction: 14, useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 1, duration: 220, useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(cardTranslateY, {
          toValue: cardSlideRef.current, tension: 90, friction: 14, useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 0, duration: 200, useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished && mountedRef.current) setVisibleSelected(null);
      });
    }
  }, [selected, cardTranslateY, scrimOpacity]);

  // Centre the map on a masjid in the free area above the bottom card.
  const focusOn = useCallback((m: Mosque) => {
    mapRef.current?.focus(m.id, cardPadRef.current, headerPad);
  }, [headerPad]);

  // Selecting a masjid (list or marker) tucks the list away ('shrunk') so the
  // card owns the bottom area, opens the card (its own layer) and focuses the
  // marker. The list's pre-card mode is captured into prevSheetModeRef on the
  // non-shrunk → shrunk transition only, so switching between masjids while a
  // card is open doesn't overwrite the value the close handler needs.
  // Focus is deferred one frame so the camera uses the post-shrink layout; the
  // card's onLayout then fine-tunes the padding.
  const selectMasjid = useCallback((m: Mosque) => {
    setSheetMode((prev) => {
      if (prev !== 'shrunk') prevSheetModeRef.current = prev;
      return 'shrunk';
    });
    setSelected(m);
    requestAnimationFrame(() => { if (mountedRef.current) focusOn(m); });
  }, [focusOn]);

  // Close the card: card slides down + list springs back to whatever mode it
  // was in before opening (default or expanded). Both animations run in
  // parallel because the state updates batch into a single render.
  const closeCard = useCallback(() => {
    setSelected(null);
    setSheetMode(prevSheetModeRef.current);
  }, []);

  const handleSelect = useCallback((m: Mosque) => selectMasjid(m), [selectMasjid]);

  const handleMarkerTap = useCallback((id: string) => {
    const m = mosques.find((x) => x.id === id);
    if (m) selectMasjid(m);
  }, [mosques, selectMasjid]);

  // Address/place search → geocode (Nominatim) → recenter + searched marker +
  // rerun nearby_mosques from the searched point (nearest then pulses).
  // Search is a fresh-start action: any open card closes and the list returns
  // to the default 3-nearest view (prevSheetModeRef is reset accordingly so a
  // later card-close lands on default, not the user's pre-search mode).
  const handleSearchPlace = useCallback(async (query: string) => {
    geocodeAbortRef.current?.abort();
    const ctrl = new AbortController();
    geocodeAbortRef.current = ctrl;
    try {
      const place = await geocodePlace(query, ctrl.signal);
      if (!mountedRef.current || !place) return;
      prevSheetModeRef.current = 'default';
      setSelected(null);
      mapRef.current?.setSearchMarker(place.lat, place.lng);
      mapRef.current?.flyTo(place.lat, place.lng, 13, defaultSheetPad, headerPad);
      await loadInitial(place.lat, place.lng);
    } catch { /* abort or geocode failure — leave the current view */ }
  }, [loadInitial, defaultSheetPad, headerPad]);

  // Masjid text result → recenter on it, rerun nearby from there, open its card.
  // Opening a card via search shrinks the list too; closing the card returns it
  // to default (search reset the list anyway).
  const handleSelectSearchMosque = useCallback(async (m: MosqueSearchResult) => {
    mapRef.current?.clearSearchMarker();
    mapRef.current?.flyTo(m.latitude, m.longitude, 15, cardPadRef.current, headerPad);
    await loadInitial(m.latitude, m.longitude);
    if (!mountedRef.current) return;
    // Card distance must be from the USER's real position — NOT from the searched
    // masjid (which is 0 m from itself). If GPS is unknown, leave it non-finite so
    // formatDistance() renders nothing instead of a misleading "0 m".
    const here = userLocRef.current;
    const distance_meters = here
      ? haversineMeters(here.lat, here.lng, m.latitude, m.longitude)
      : Number.POSITIVE_INFINITY;
    const sel: Mosque = { ...m, distance_meters };
    prevSheetModeRef.current = 'default';
    setSheetMode('shrunk');
    setSelected(sel);
    requestAnimationFrame(() => { if (mountedRef.current) focusOn(sel); });
  }, [loadInitial, headerPad, focusOn]);

  const handleMinPosition = useCallback(async () => {
    // "Min position" resets the view: close any open card and bring the list
    // straight back to default (don't wait for the GPS round-trip + loadInitial
    // to do it). prevSheetModeRef is reset so this acts as a fresh start.
    prevSheetModeRef.current = 'default';
    setSelected(null);
    setSheetMode('default');
    setSearchResetSignal((s) => s + 1);   // clear the search bar
    mapRef.current?.clearSearchMarker();
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!mountedRef.current) return;
      const lat = loc.coords.latitude, lng = loc.coords.longitude;
      setUserLoc({ lat, lng });
      // No card open here → pad by the (approx) default sheet height.
      mapRef.current?.flyTo(lat, lng, 14, defaultSheetPad, headerPad);
      await loadInitial(lat, lng);
    } catch { /* keep current view */ }
  }, [loadInitial, headerPad, defaultSheetPad]);

  // Source of truth is visibleSelected — during the close spring, `selected` is
  // already null but the card (and its Vägbeskrivning button) is still on screen.
  const openDirections = useCallback(() => {
    const m = visibleSelected;
    if (m) setDirections({ lat: m.latitude, lng: m.longitude, name: m.name });
  }, [visibleSelected]);

  // ── Header (shared by gate + map) ──────────────────────────────────────────
  // Over the map the title is always black: the OSM basemap is light in both
  // themes, so white (dark-mode T.text) would be unreadable. On the gate it
  // sits over the app background, so it stays themed.
  const renderHeader = (onMap: boolean) => (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <BackButton onPress={() => router.back()} />
      <Text style={[styles.title, { color: onMap ? '#000000' : T.text }]}>Närmaste masjid</Text>
      <View style={{ width: 36 }} />
    </View>
  );

  if (status !== 'granted') {
    return (
      <View style={[styles.root, { backgroundColor: T.bg }]}>
        {renderHeader(false)}
        {status === 'checking'
          ? <View style={styles.fill} />
          : <MasjidPermissionGate requesting={requesting} onRequest={requestPermission} />}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      {/* Map fills the screen; mounted only now that permission is granted. */}
      <MasjidMapView
        ref={mapRef}
        accent={T.accent}
        isDark={isDark}
        user={userLoc}
        mosques={points}
        nearestId={nearestId}
        onMarkerTap={handleMarkerTap}
        onConnectivity={setOnline}
      />

      {/* Overlay header — title black for contrast over the light map */}
      <View style={styles.headerOverlay} pointerEvents="box-none">{renderHeader(true)}</View>

      {/* Search bar — masjid text search + Nominatim place search */}
      <View style={[styles.searchWrap, { top: insets.top + 52 }]} pointerEvents="box-none">
        <MasjidSearchBar
          onSelectMosque={handleSelectSearchMosque}
          onSearchPlace={handleSearchPlace}
          resetSignal={searchResetSignal}
        />
      </View>

      {/* Zoom controls — vertical +/- pill anchored directly under the search
          bar's right edge. Card surface + hairline border + 14 px radius +
          search-bar shadow on purpose: reads as a smaller sibling of the
          search field rather than a separate widget. MapLibre's in-map
          NavigationControl is removed in masjidMapHtml.ts; these dispatch
          zoomIn/zoomOut via the map ref.

          Shadow lives on the OUTER wrapper because the inner group uses
          overflow:'hidden' (so the rounded corners cleanly clip the
          divider) — and overflow:'hidden' clips the iOS layer shadow on
          the same node. Splitting them gives us both a crisp pill and the
          same shadow the search field has. */}
      <View style={[styles.zoomWrap, { top: insets.top + 110 }]} pointerEvents="box-none">
        <View style={styles.zoomShadow}>
          <View style={[styles.zoomGroup, { backgroundColor: T.card, borderColor: T.border }]}>
            <TouchableOpacity
              style={styles.zoomBtn}
              onPress={() => mapRef.current?.zoomIn()}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Zooma in"
            >
              <Ionicons name="add" size={20} color={masjidIconColor(T)} />
            </TouchableOpacity>
            <View style={[styles.zoomDivider, { backgroundColor: T.border }]} />
            <TouchableOpacity
              style={styles.zoomBtn}
              onPress={() => mapRef.current?.zoomOut()}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Zooma ut"
            >
              <Ionicons name="remove" size={20} color={masjidIconColor(T)} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Bottom stack: floating controls (+ above min-position) over the list */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
        <Animated.View
          style={[styles.fabStack, { transform: [{ translateY: fabStackTranslateY }] }]}
          pointerEvents="box-none"
        >
          {/* "Lägg till masjid" — round + button, directly above min-position.
              Wrapped in a relative View so the hint bubble can be anchored to
              the FAB itself (right: 56 = 48 fab width + 8 px gap). This keeps
              the bubble glued to the + icon regardless of how tall the bottom
              sheet grows — measuring from the bottom container instead would
              put it behind the panel. */}
          <View style={styles.addFabWrap}>
            {showAddTip && (
              <View style={styles.addFabTipAnchor} pointerEvents="box-none">
                <MasjidAddTipBubble visible={showAddTip} onDismiss={dismissAddTip} />
              </View>
            )}
            <TouchableOpacity
              style={[styles.fab, { backgroundColor: T.card, borderColor: T.border }]}
              onPress={openAddModal}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={26} color={masjidIconColor(T)} />
            </TouchableOpacity>
          </View>
          {/* "Hitta min position" */}
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: T.card, borderColor: T.border }]}
            onPress={handleMinPosition}
            activeOpacity={0.8}
          >
            <Ionicons name="locate" size={22} color={masjidIconColor(T)} />
          </TouchableOpacity>
        </Animated.View>

        <MasjidList
          mosques={mosques}
          loading={loading}
          mode={sheetMode}
          onModeChange={setSheetMode}
          onSelect={handleSelect}
        />
      </View>

      {/* Collapsed-list ball — round bottom-LEFT button shown after the user
          drags the sheet off-screen. Tap brings the list back to its default
          3-nearest snap. opacity+scale share the ball's spring so the entry
          mirrors the list's slide and the card's translateY rhythm. */}
      {ballMounted && (
        <Animated.View
          style={[
            styles.listBallWrap,
            {
              left: 16,
              bottom: insets.bottom + 16,
              opacity: ballAnim,
              transform: [{ scale: ballAnim }],
            },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: T.card, borderColor: T.border }]}
            onPress={() => setSheetMode('default')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Visa lista"
          >
            <SvgXml xml={listIconXml(masjidIconColor(T))} width={22} height={22} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Subtle scrim — dims the map + list so the open card reads as the primary
          layer. Opacity is animated in parallel with the card spring so it fades
          in/out instead of popping. pointerEvents none keeps the map interactive
          and the marker visible. */}
      {visibleSelected && (
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]} pointerEvents="none" />
      )}

      {/* Selected masjid card — a distinct floating layer ABOVE the list (zIndex).
          translateY is driven by the same spring as MasjidList; onLayout updates
          the slide distance (so close springs to exactly off-screen below) AND
          re-centres the map so the marker lands in the visible area above the
          card regardless of card content. */}
      {visibleSelected && (
        <Animated.View
          style={[
            styles.cardWrap,
            { paddingBottom: insets.bottom + 12, transform: [{ translateY: cardTranslateY }] },
          ]}
          pointerEvents="box-none"
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            // Track the card's full wrapper height so the close spring lands
            // it exactly off-screen below — no clipped peek, no overshoot.
            cardSlideRef.current = h;
            if (Math.abs(h - cardPadRef.current) > 8) {
              cardPadRef.current = h;
              mapRef.current?.focus(visibleSelected.id, h, headerPad);
            }
          }}
        >
          <MasjidCard mosque={visibleSelected} onClose={closeCard} onDirections={openDirections} />
        </Animated.View>
      )}

      <DirectionsSheet visible={!!directions} target={directions} onClose={() => setDirections(null)} />

      <AddMasjidModal visible={addVisible} onClose={() => setAddVisible(false)} userLoc={userLoc} />

      {/* Offline banner — local to this screen; slides in when internet drops */}
      <MasjidOfflineBanner online={online} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40 },
  searchWrap: { position: 'absolute', left: 16, right: 16, zIndex: 45 },
  // Zoom pill — right-anchored under the search field. zIndex sits BELOW the
  // bottom container (10) so the expanded list panel cleanly covers the pill
  // instead of letting it float on top of the rows; in default/collapsed
  // states the list is parked near the bottom of the screen so it never
  // reaches the pill anyway. Still above the map base so taps register.
  zoomWrap: { position: 'absolute', right: 16, zIndex: 5 },
  // Outer wrapper carries the shadow only — see comment at the JSX site for
  // why it lives separately from the rounded inner group. Same values as
  // MasjidSearchBar's `bar` so the two surfaces read as a family.
  zoomShadow: {
    borderRadius: 14,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  zoomGroup: {
    width: 38,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  zoomBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10 },
  // Vertical stack of floating controls, bottom-right, above the list.
  fabStack: { alignSelf: 'flex-end', alignItems: 'center', gap: 14, marginRight: 16, marginBottom: 12 },
  fab: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  // Wraps the + FAB so its child bubble can be absolutely positioned against it.
  // `overflow: 'visible'` lets the bubble extend leftward beyond the 48 px width.
  addFabWrap: { position: 'relative', width: 48, height: 48 },
  // Bubble anchor: full-height absolute strip aligned to the FAB's right edge.
  // `right: 56` = 48 px FAB + 8 px gap → bubble's caret hugs the FAB's left side.
  // `justifyContent: 'center'` vertically centres the bubble against the FAB.
  // `width: 240` matches the bubble's typical content width; bubble itself is
  // right-aligned inside this strip via flex-end so it sticks to the FAB.
  addFabTipAnchor: {
    position: 'absolute',
    right: 56,
    top: 0,
    bottom: 0,
    width: 240,
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 50,
    elevation: 50,
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.18)', zIndex: 20 },
  // Floating card layer: inset from edges + above the scrim/list.
  cardWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, zIndex: 30 },
  // Collapsed-list ball — bottom-LEFT corner, sits above the bottom container
  // (FAB stack is bottom-right, so no overlap) but BELOW the card layer
  // (zIndex 30) so an open card still wins.
  listBallWrap: { position: 'absolute', zIndex: 15 },
});
