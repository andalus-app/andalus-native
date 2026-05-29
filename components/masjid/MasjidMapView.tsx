/**
 * MasjidMapView — MapLibre GL JS hosted in a react-native-webview.
 *
 * Declarative props (user, mosques, nearestId) are pushed into the map; one-off
 * camera commands are exposed via an imperative ref (focus / flyTo / search
 * marker). Messages sent before the map reports 'ready' are queued and flushed
 * on ready, so the parent never has to wait.
 *
 * Isolation: this component owns no timers and no listeners outside the WebView.
 * When the parent screen unmounts, the WebView unmounts and every bit of map JS,
 * its animations and its tile requests die with it.
 */
import React, {
  forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildMasjidMapHtml, masjidMapBg } from './masjidMapHtml';

export type MapPoint = { id: string; lat: number; lng: number };
export type LatLng = { lat: number; lng: number };

export type MasjidMapHandle = {
  // padBottom = bottom-overlay (card/list) height; padTop = header height — both
  // in px, so the map centres within the visible map area, not the raw viewport.
  focus: (id: string, padBottom?: number, padTop?: number) => void;
  flyTo: (lat: number, lng: number, zoom?: number, padBottom?: number, padTop?: number) => void;
  setSearchMarker: (lat: number, lng: number) => void;
  clearSearchMarker: () => void;
  // RN-owned +/- controls (see app/masjid.tsx). MapLibre's built-in
  // NavigationControl was removed so the buttons can live in the app's design
  // system instead of floating in the top-right corner of the map.
  zoomIn: () => void;
  zoomOut: () => void;
};

type Props = {
  accent: string;
  isDark: boolean;
  user: LatLng | null;
  mosques: MapPoint[];
  nearestId: string | null;
  onMarkerTap: (id: string) => void;
  onReady?: () => void;
};

const MasjidMapView = forwardRef<MasjidMapHandle, Props>(function MasjidMapView(
  { accent, isDark, user, mosques, nearestId, onMarkerTap, onReady }, ref,
) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<object[]>([]);

  // Themed cover over the WebView until the map reports 'ready'. Eliminates the
  // brief white flash the native WebView backing shows before the first paint.
  // Same colour as the map's HTML background so the fade reveals seamlessly.
  const bg = masjidMapBg(isDark);
  const coverFade = useRef(new Animated.Value(1)).current;
  const [covered, setCovered] = useState(true);

  // Latest props mirrored into refs so the 'ready' handler sends current state.
  const userRef = useRef(user);          userRef.current = user;
  const mosquesRef = useRef(mosques);    mosquesRef.current = mosques;
  const nearestRef = useRef(nearestId);  nearestRef.current = nearestId;

  // Built once per theme — rebuilding would reload the WebView.
  const html = useMemo(() => buildMasjidMapHtml(accent, isDark), [accent, isDark]);

  const post = useCallback((msg: object) => {
    if (!readyRef.current) { queueRef.current.push(msg); return; }
    webRef.current?.injectJavaScript(
      `window.__masjid && window.__masjid.handle(${JSON.stringify(msg)}); true;`,
    );
  }, []);

  // Re-sync markers / user whenever the declarative props change (post-ready).
  React.useEffect(() => {
    if (readyRef.current) post({ type: 'setMarkers', mosques, nearestId });
  }, [mosques, nearestId, post]);

  React.useEffect(() => {
    if (readyRef.current && user) post({ type: 'setUser', lat: user.lat, lng: user.lng });
  }, [user, post]);

  useImperativeHandle(ref, () => ({
    focus: (id, padBottom, padTop) => post({ type: 'focus', id, padBottom, padTop }),
    flyTo: (lat, lng, zoom, padBottom, padTop) => post({ type: 'flyTo', lat, lng, zoom, padBottom, padTop }),
    setSearchMarker: (lat, lng) => post({ type: 'searchMarker', lat, lng }),
    clearSearchMarker: () => post({ type: 'clearSearchMarker' }),
    zoomIn:  () => post({ type: 'zoomIn' }),
    zoomOut: () => post({ type: 'zoomOut' }),
  }), [post]);

  const handleMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      readyRef.current = true;
      // Initial paint with current state, then flush anything queued meanwhile.
      post({
        type: 'init',
        user: userRef.current,
        mosques: mosquesRef.current,
        nearestId: nearestRef.current,
      });
      const queued = queueRef.current;
      queueRef.current = [];
      queued.forEach(post);
      onReady?.();
      // Map is up — fade the themed cover out to reveal it (no white flash).
      Animated.timing(coverFade, { toValue: 0, duration: 220, useNativeDriver: true })
        .start(() => setCovered(false));
    } else if (msg.type === 'markerTap' && typeof msg.id === 'string') {
      onMarkerTap(msg.id);
    }
  }, [post, onMarkerTap, onReady]);

  return (
    <View style={[styles.fill, { backgroundColor: bg }]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
        // Themed (not white) backing so there's no white flash before paint.
        style={[styles.fill, { backgroundColor: bg }]}
        // HTTP-cache the MapLibre JS/CSS + tiles so later opens load from disk.
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        // No file access needed; map + tiles load over https.
        allowsInlineMediaPlayback
      />
      {covered && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: bg, opacity: coverFade }]}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: 'transparent' } });

export default MasjidMapView;
