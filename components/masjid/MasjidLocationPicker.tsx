/**
 * MasjidLocationPicker — full-screen map modal for choosing a masjid position.
 * Pan the map; the centre crosshair marks the point (selected coordinate = map
 * centre, emitted on moveend).
 *
 * On open it auto-centres on the user's GPS position (if permission is granted)
 * and shows a blue dot for it. A "Hitta min position" FAB (same style as the
 * Närmaste masjid map) re-fetches GPS — requesting permission if needed — then
 * recenters the map (which moves the crosshair) and updates the coordinate.
 *
 * Isolation: the WebView (and all its JS) mounts only while open and unmounts on
 * confirm/cancel. GPS is read one-shot (no watcher), guarded by mountedRef. No
 * timers, no background JS, no effect on the main map or the prayer tab.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Alert,
  Keyboard, AppState,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { geocodeAddress, geocodePlace, type AddressQuery } from '../../services/nominatim';
import { buildPickerHtml } from './masjidPickerHtml';
import { masjidIconColor, masjidLabelColor } from './colors';

const DEFAULT_LAT = 59.3293, DEFAULT_LNG = 18.0686; // Stockholm fallback

export default function MasjidLocationPicker({
  visible,
  initialLat,
  initialLng,
  addressQuery,
  onCancel,
  onPicked,
}: {
  visible: boolean;
  initialLat: number | null;
  initialLng: number | null;
  /** Structured address (street + postal + city). When the user hasn't already
   *  picked coords, the picker forward-geocodes this via Nominatim's structured
   *  search on open and centers the crosshair there. Pass `null` once coords
   *  are committed so re-opens don't yank the crosshair away from a manual pan.
   *  Structured fields are required for precision — free-text q= returns the
   *  wrong house for "Fornbyvägen 29, 163 70 Stockholm". */
  addressQuery?: AddressQuery | null;
  onCancel: () => void;
  onPicked: (lat: number, lng: number) => void;
}) {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const startLat = initialLat ?? DEFAULT_LAT;
  const startLng = initialLng ?? DEFAULT_LNG;

  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<{ lat: number; lng: number; withUserDot: boolean } | null>(null);
  const mountedRef = useRef(true);
  const centerRef = useRef({ lat: startLat, lng: startLng });

  const [coordLabel, setCoordLabel] = useState(`${startLat.toFixed(5)}, ${startLng.toFixed(5)}`);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { searchAbortRef.current?.abort(); }, []);

  const html = useMemo(() => buildPickerHtml(T.accent, startLat, startLng), [T.accent, startLat, startLng]);

  const post = useCallback((msg: object) => {
    webRef.current?.injectJavaScript(`window.__picker && window.__picker.handle(${JSON.stringify(msg)}); true;`);
  }, []);

  // Recenter the map (moves the crosshair). Optionally drops the blue user
  // dot — true for GPS-based recentering, false for address geocoding (the
  // crosshair alone is enough; a "user dot" at a geocoded address would lie).
  // Queues until the WebView reports ready.
  const centerMap = useCallback((lat: number, lng: number, withUserDot: boolean) => {
    if (readyRef.current) {
      post({ type: 'center', lat, lng });
      if (withUserDot) post({ type: 'user', lat, lng });
    } else {
      pendingRef.current = { lat, lng, withUserDot };
    }
  }, [post]);

  // Fetch GPS and recenter. askPermission=true → request/Settings prompt on the
  // user-initiated FAB; false → silent auto-center on open if already granted.
  const goToMyLocation = useCallback(async (askPermission: boolean) => {
    setLocating(true);
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && askPermission) {
        if (perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Platsåtkomst krävs', 'Tillåt åtkomst till platsinfo i Inställningar för att hitta din position.');
          return;
        }
      }
      if (!perm.granted) return; // silent path, not granted → leave map as-is
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!mountedRef.current) return;
      const lat = loc.coords.latitude, lng = loc.coords.longitude;
      centerRef.current = { lat, lng };
      setCoordLabel(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      centerMap(lat, lng, true);
    } catch {
      /* GPS failed — keep current view */
    } finally {
      if (mountedRef.current) setLocating(false);
    }
  }, [centerMap]);

  // Free-text place/address search → recenter the crosshair on the hit. Biased
  // to Sweden (Nominatim countrycodes=se). User-initiated only (one submit →
  // one request) so it stays within Nominatim's ≤1 req/sec policy.
  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || searching) return;
    Keyboard.dismiss();
    searchAbortRef.current?.abort();
    const ctl = new AbortController();
    searchAbortRef.current = ctl;
    setSearching(true);
    try {
      const res = await geocodePlace(q, ctl.signal);
      if (!mountedRef.current || ctl.signal.aborted) return;
      if (res) {
        centerRef.current = { lat: res.lat, lng: res.lng };
        setCoordLabel(`${res.lat.toFixed(5)}, ${res.lng.toFixed(5)}`);
        centerMap(res.lat, res.lng, false);
      } else {
        Alert.alert('Hittade ingen plats', 'Försök med en annan adress eller ett platsnamn.');
      }
    } catch {
      if (mountedRef.current && !ctl.signal.aborted) {
        Alert.alert('Sökningen misslyckades', 'Kontrollera din anslutning och försök igen.');
      }
    } finally {
      if (mountedRef.current && searchAbortRef.current === ctl) setSearching(false);
    }
  }, [query, searching, centerMap]);

  // On open: reset bridge state, then choose the starting view in this order:
  //   1) Forward-geocode the structured address via Nominatim if the parent
  //      provided one — auto-finds the exact house on the map so the user
  //      doesn't have to pan from their GPS location.
  //   2) Otherwise auto-center on the user's GPS position (silently — no
  //      permission prompt; the FAB is the user-initiated path).
  // The geocode is aborted if the picker is closed mid-flight, and an empty /
  // failed geocode falls back to GPS so the picker always has a sane view.
  useEffect(() => {
    if (!visible) return;
    readyRef.current = false;
    pendingRef.current = null;
    searchAbortRef.current?.abort();
    setQuery('');
    setSearching(false);

    const a = addressQuery;
    const hasAnyField =
      !!(a && ((a.street && a.street.trim()) || (a.postalCode && a.postalCode.trim()) || (a.city && a.city.trim())));
    if (!hasAnyField) {
      goToMyLocation(false);
      return;
    }

    const ctl = new AbortController();
    geocodeAddress(a!, ctl.signal)
      .then(res => {
        if (!mountedRef.current || ctl.signal.aborted) return;
        if (res) {
          centerRef.current = { lat: res.lat, lng: res.lng };
          setCoordLabel(`${res.lat.toFixed(5)}, ${res.lng.toFixed(5)}`);
          centerMap(res.lat, res.lng, false);
        } else {
          goToMyLocation(false);
        }
      })
      .catch(() => {
        if (mountedRef.current && !ctl.signal.aborted) goToMyLocation(false);
      });

    return () => { ctl.abort(); };
  }, [visible, addressQuery, centerMap, goToMyLocation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Remount the WebView when the app returns to the foreground. iOS can leave a
  // backgrounded WebView blank/black after switching to another app (e.g. Google
  // Maps) and back — that produced the picker's black map. On remount we reset
  // the bridge to "not ready" and queue the current centre so the fresh map
  // re-centres (with the user dot) on its next 'ready'. Only while visible.
  const [webviewKey, setWebviewKey] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && mountedRef.current) {
        readyRef.current = false;
        pendingRef.current = { lat: centerRef.current.lat, lng: centerRef.current.lng, withUserDot: true };
        setWebviewKey((k) => k + 1);
      }
    });
    return () => sub.remove();
  }, [visible]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      readyRef.current = true;
      if (pendingRef.current) {
        const { lat, lng, withUserDot } = pendingRef.current;
        pendingRef.current = null;
        post({ type: 'center', lat, lng });
        if (withUserDot) post({ type: 'user', lat, lng });
      }
    } else if (msg.type === 'center' && typeof msg.lat === 'number') {
      centerRef.current = { lat: msg.lat, lng: msg.lng };
      setCoordLabel(`${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}`);
    }
  }, [post]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.root, { backgroundColor: T.bg }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: T.bg, borderBottomColor: T.separator }]}>
          <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.cancel, { color: T.textMuted }]}>Avbryt</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: T.text }]}>Välj plats</Text>
          <TouchableOpacity onPress={() => onPicked(centerRef.current.lat, centerRef.current.lng)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.confirm, { color: T.accent }]}>Klar</Text>
          </TouchableOpacity>
        </View>

        {/* Sök adress eller plats → centrerar markören på träffen */}
        <View style={[styles.searchWrap, { backgroundColor: T.bg, borderBottomColor: T.separator }]}>
          <View style={[styles.searchBar, { backgroundColor: T.card, borderColor: T.border }]}>
            <Ionicons name="search" size={18} color={masjidLabelColor(T)} />
            <TextInput
              style={[styles.searchInput, { color: T.text }]}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={runSearch}
              placeholder="Sök adress eller plats"
              placeholderTextColor={masjidLabelColor(T)}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searching ? (
              <ActivityIndicator size="small" color={masjidIconColor(T)} />
            ) : query.length > 0 ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={18} color={masjidLabelColor(T)} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {visible && (
          <WebView
            key={webviewKey}
            ref={webRef}
            originWhitelist={['*']}
            source={{ html }}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            style={styles.web}
          />
        )}

        {/* Hitta min position — same floating style as the main map */}
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: T.card, borderColor: T.border, bottom: insets.bottom + 96 }]}
          onPress={() => goToMyLocation(true)}
          activeOpacity={0.8}
        >
          {locating ? <ActivityIndicator color={masjidIconColor(T)} /> : <Ionicons name="locate" size={22} color={masjidIconColor(T)} />}
        </TouchableOpacity>

        <View style={[styles.coordBar, { backgroundColor: T.card, bottom: insets.bottom + 16 }]} pointerEvents="none">
          <Text style={[styles.coordText, { color: T.textMuted }]}>Dra kartan för att placera markören</Text>
          <Text style={[styles.coordVal, { color: T.text }]}>{coordLabel}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: { fontSize: 16 },
  confirm: { fontSize: 16, fontWeight: '700' },
  title: { fontSize: 17, fontWeight: '700' },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  web: { flex: 1 },
  fab: {
    position: 'absolute', right: 16, width: 48, height: 48, borderRadius: 24, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  coordBar: {
    position: 'absolute', alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  coordText: { fontSize: 12 },
  coordVal: { fontSize: 14, fontWeight: '600', marginTop: 2 },
});
