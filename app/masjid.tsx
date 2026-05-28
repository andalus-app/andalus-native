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
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import BackButton from '../components/BackButton';
import { useMasjidLocation } from '../hooks/useMasjidLocation';
import {
  fetchNearbyApprovedMosques,
  type Mosque, type MosqueSearchResult, MASJID_FETCH_LIMIT,
} from '../services/mosques';
import { geocodePlace } from '../services/nominatim';
import MasjidMapView, { type MasjidMapHandle } from '../components/masjid/MasjidMapView';
import MasjidPermissionGate from '../components/masjid/MasjidPermissionGate';
import MasjidList, { type SheetMode } from '../components/masjid/MasjidList';
import MasjidSearchBar from '../components/masjid/MasjidSearchBar';
import MasjidCard from '../components/masjid/MasjidCard';
import AddMasjidModal from '../components/masjid/AddMasjidModal';
import DirectionsSheet, { type DirectionsTarget } from '../components/masjid/DirectionsSheet';

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

  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const loadedOnceRef = useRef(false);

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
      const rows = await fetchNearbyApprovedMosques(lat, lng, MASJID_FETCH_LIMIT, 0, signal);
      if (!mountedRef.current) return [];
      setMosques(rows);
      return rows;
    } catch {
      // AbortError or a real failure — keep current state, just stop the spinner.
      return [];
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [freshSignal]);

  // Read GPS once, then load mosques from the user's position.
  const fetchGpsAndLoad = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!mountedRef.current) return;
      const lat = loc.coords.latitude, lng = loc.coords.longitude;
      setUserLoc({ lat, lng });
      await loadInitial(lat, lng);
    } catch {
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

  // Unmount: abort in-flight request, block late state updates. (No timers/watchers exist to clear.)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      geocodeAbortRef.current?.abort();
    };
  }, []);

  // Centre the map on a masjid in the free area above the bottom card.
  const focusOn = useCallback((m: Mosque) => {
    mapRef.current?.focus(m.id, cardPadRef.current, headerPad);
  }, [headerPad]);

  // Selecting a masjid (list or marker) collapses the list back to the default
  // 3-nearest view so the map + chosen marker are visible, opens the card (its
  // own layer), and focuses the marker. Focus is deferred one frame so the camera
  // uses the collapsed layout; the card's onLayout then fine-tunes the padding.
  const selectMasjid = useCallback((m: Mosque) => {
    setSheetMode('default');
    setSelected(m);
    requestAnimationFrame(() => { if (mountedRef.current) focusOn(m); });
  }, [focusOn]);

  const handleSelect = useCallback((m: Mosque) => selectMasjid(m), [selectMasjid]);

  const handleMarkerTap = useCallback((id: string) => {
    const m = mosques.find((x) => x.id === id);
    if (m) selectMasjid(m);
  }, [mosques, selectMasjid]);

  // Address/place search → geocode (Nominatim) → recenter + searched marker +
  // rerun nearby_mosques from the searched point (nearest then pulses).
  const handleSearchPlace = useCallback(async (query: string) => {
    geocodeAbortRef.current?.abort();
    const ctrl = new AbortController();
    geocodeAbortRef.current = ctrl;
    try {
      const place = await geocodePlace(query, ctrl.signal);
      if (!mountedRef.current || !place) return;
      setSelected(null);
      mapRef.current?.setSearchMarker(place.lat, place.lng);
      mapRef.current?.flyTo(place.lat, place.lng, 13, defaultSheetPad, headerPad);
      await loadInitial(place.lat, place.lng);
    } catch { /* abort or geocode failure — leave the current view */ }
  }, [loadInitial, defaultSheetPad, headerPad]);

  // Masjid text result → recenter on it, rerun nearby from there, open its card.
  const handleSelectSearchMosque = useCallback(async (m: MosqueSearchResult) => {
    mapRef.current?.clearSearchMarker();
    mapRef.current?.flyTo(m.latitude, m.longitude, 15, cardPadRef.current, headerPad);
    const rows = await loadInitial(m.latitude, m.longitude);
    if (!mountedRef.current) return;
    const sel = rows.find((r) => r.id === m.id) ?? { ...m, distance_meters: 0 };
    setSelected(sel);
    requestAnimationFrame(() => { if (mountedRef.current) focusOn(sel); });
  }, [loadInitial, headerPad, focusOn]);

  const handleMinPosition = useCallback(async () => {
    setSelected(null);
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

  const openDirections = useCallback(() => {
    if (selected) setDirections({ lat: selected.latitude, lng: selected.longitude, name: selected.name });
  }, [selected]);

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

      {/* Bottom stack: floating controls (+ above min-position) over the list */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
        <View style={styles.fabStack}>
          {/* "Lägg till masjid" — round + button, directly above min-position */}
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: T.card, borderColor: T.border }]}
            onPress={() => setAddVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={26} color={T.accent} />
          </TouchableOpacity>
          {/* "Hitta min position" */}
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: T.card, borderColor: T.border }]}
            onPress={handleMinPosition}
            activeOpacity={0.8}
          >
            <Ionicons name="locate" size={22} color={T.accent} />
          </TouchableOpacity>
        </View>

        <MasjidList
          mosques={mosques}
          loading={loading}
          mode={sheetMode}
          onModeChange={setSheetMode}
          onSelect={handleSelect}
        />
      </View>

      {/* Subtle scrim — dims the map + list so the open card reads as the primary
          layer. pointerEvents none keeps the map interactive and the marker visible. */}
      {selected && <View style={styles.scrim} pointerEvents="none" />}

      {/* Selected masjid card — a distinct floating layer ABOVE the list (zIndex).
          onLayout measures its real height and re-centres so the marker lands in
          the visible area above the card regardless of card content. */}
      {selected && (
        <View
          style={[styles.cardWrap, { paddingBottom: insets.bottom + 12 }]}
          pointerEvents="box-none"
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (Math.abs(h - cardPadRef.current) > 8) {
              cardPadRef.current = h;
              mapRef.current?.focus(selected.id, h, headerPad);
            }
          }}
        >
          <MasjidCard mosque={selected} onClose={() => setSelected(null)} onDirections={openDirections} />
        </View>
      )}

      <DirectionsSheet visible={!!directions} target={directions} onClose={() => setDirections(null)} />

      <AddMasjidModal visible={addVisible} onClose={() => setAddVisible(false)} userLoc={userLoc} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40 },
  searchWrap: { position: 'absolute', left: 16, right: 16, zIndex: 45 },
  title: { fontSize: 17, fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10 },
  // Vertical stack of floating controls, bottom-right, above the list.
  fabStack: { alignSelf: 'flex-end', alignItems: 'center', gap: 14, marginRight: 16, marginBottom: 12 },
  fab: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.18)', zIndex: 20 },
  // Floating card layer: inset from edges + above the scrim/list.
  cardWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, zIndex: 30 },
});
