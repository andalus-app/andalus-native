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
  Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { buildPickerHtml } from './masjidPickerHtml';

const DEFAULT_LAT = 59.3293, DEFAULT_LNG = 18.0686; // Stockholm fallback

export default function MasjidLocationPicker({
  visible,
  initialLat,
  initialLng,
  onCancel,
  onPicked,
}: {
  visible: boolean;
  initialLat: number | null;
  initialLng: number | null;
  onCancel: () => void;
  onPicked: (lat: number, lng: number) => void;
}) {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const startLat = initialLat ?? DEFAULT_LAT;
  const startLng = initialLng ?? DEFAULT_LNG;

  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<{ lat: number; lng: number } | null>(null);
  const mountedRef = useRef(true);
  const centerRef = useRef({ lat: startLat, lng: startLng });

  const [coordLabel, setCoordLabel] = useState(`${startLat.toFixed(5)}, ${startLng.toFixed(5)}`);
  const [locating, setLocating] = useState(false);

  const html = useMemo(() => buildPickerHtml(T.accent, startLat, startLng), [T.accent, startLat, startLng]);

  const post = useCallback((msg: object) => {
    webRef.current?.injectJavaScript(`window.__picker && window.__picker.handle(${JSON.stringify(msg)}); true;`);
  }, []);

  // Recenter the map (moves the crosshair) + show the user dot. Queues until ready.
  const centerMap = useCallback((lat: number, lng: number) => {
    if (readyRef.current) {
      post({ type: 'center', lat, lng });
      post({ type: 'user', lat, lng });
    } else {
      pendingRef.current = { lat, lng };
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
      centerMap(lat, lng);
    } catch {
      /* GPS failed — keep current view */
    } finally {
      if (mountedRef.current) setLocating(false);
    }
  }, [centerMap]);

  // On open: reset bridge state and auto-center on the user (if already allowed).
  useEffect(() => {
    if (!visible) return;
    readyRef.current = false;
    pendingRef.current = null;
    goToMyLocation(false);
  }, [visible, goToMyLocation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      readyRef.current = true;
      if (pendingRef.current) {
        const { lat, lng } = pendingRef.current;
        pendingRef.current = null;
        post({ type: 'center', lat, lng });
        post({ type: 'user', lat, lng });
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

        {visible && (
          <WebView
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
          {locating ? <ActivityIndicator color={T.accent} /> : <Ionicons name="locate" size={22} color={T.accent} />}
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
