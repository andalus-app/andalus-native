/**
 * MasjidMapView — MapLibre GL JS hosted in a react-native-webview.
 *
 * Declarative props (user, mosques, nearestId) are pushed into the map; one-off
 * camera commands are exposed via an imperative ref (focus / flyTo / search
 * marker). Messages sent before the map reports 'ready' are queued and flushed
 * on ready, so the parent never has to wait.
 *
 * Loading lifecycle (why this exists): the map only becomes usable once a remote
 * asset chain succeeds — MapLibre JS/CSS from unpkg, then the openfreemap vector
 * style + its glyphs/sprites/tiles. If any hop is slow or down, MapLibre's
 * 'load' never fires. To avoid the old "blank frozen rectangle", this component
 * runs an explicit state machine — loading → ready | error — with a premium
 * shimmer skeleton, a "Kartan laddas…" slow hint, a hard timeout fallback, and a
 * "Försök igen" retry that fully remounts the WebView (fresh map, no duplicate
 * markers/listeners). See masjidMapHtml.ts for the matching lifecycle events.
 *
 * Isolation: this component owns only the WebView and ref-tracked load timers
 * (cleared on unmount). When the parent screen unmounts, the WebView unmounts and
 * every bit of map JS, its animations and its tile requests die with it.
 */
import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import {
  Animated, Dimensions, Easing, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
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
  // Fired whenever the WebView reports a connectivity change (navigator.onLine /
  // online|offline events). Drives the local offline banner in app/masjid.tsx.
  onConnectivity?: (online: boolean) => void;
};

type MapState = 'loading' | 'ready' | 'error';

// After this long still loading → show the subtle "Kartan laddas…" hint.
const SLOW_HINT_MS = 5000;
// After this long with no 'ready' → give up and show the error/retry state.
const LOAD_TIMEOUT_MS = 12000;

const log = (...args: unknown[]) => {
  if (__DEV__) console.log('[MasjidMap]', ...args);
};

const MasjidMapView = forwardRef<MasjidMapHandle, Props>(function MasjidMapView(
  { accent, isDark, user, mosques, nearestId, onMarkerTap, onReady, onConnectivity }, ref,
) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<object[]>([]);
  const mountedRef = useRef(true);

  // Explicit map lifecycle state. 'idle' collapses into 'loading' on mount.
  const [mapState, setMapState] = useState<MapState>('loading');
  const [showSlowHint, setShowSlowHint] = useState(false);
  // Bumped on retry → used as the WebView `key` so a retry fully remounts the
  // WebView (old map + listeners torn down, fresh map mounted → no duplicates).
  const [reloadKey, setReloadKey] = useState(0);

  // Themed cover/skeleton over the WebView until the map reports 'ready'.
  // Eliminates the brief white flash the native WebView backing shows before the
  // first paint. Same colour as the map's HTML background so the fade is seamless.
  const bg = masjidMapBg(isDark);
  const coverFade = useRef(new Animated.Value(1)).current;
  const [covered, setCovered] = useState(true);

  // Ref-tracked load timers — cleared on ready/error/retry/unmount (CLAUDE.md).
  const slowHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLoadTimers = useCallback(() => {
    if (slowHintTimer.current) { clearTimeout(slowHintTimer.current); slowHintTimer.current = null; }
    if (timeoutTimer.current) { clearTimeout(timeoutTimer.current); timeoutTimer.current = null; }
  }, []);

  // Shimmer sweep for the skeleton (single Animated.loop, native-driven).
  const shimmer = useRef(new Animated.Value(0)).current;

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
  useEffect(() => {
    if (readyRef.current) post({ type: 'setMarkers', mosques, nearestId });
  }, [mosques, nearestId, post]);

  useEffect(() => {
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

  // (Re)arm the slow-hint + hard-timeout whenever a load attempt starts (mount or
  // retry). Cleared on ready/error inside the message handler and on unmount.
  useEffect(() => {
    log('component mounted — load attempt', reloadKey);
    slowHintTimer.current = setTimeout(() => {
      if (mountedRef.current && !readyRef.current) {
        log('slow load — showing "Kartan laddas…"');
        setShowSlowHint(true);
      }
    }, SLOW_HINT_MS);
    timeoutTimer.current = setTimeout(() => {
      if (mountedRef.current && !readyRef.current) {
        log('load timeout — entering error state');
        setMapState('error');
      }
    }, LOAD_TIMEOUT_MS);
    return clearLoadTimers;
  }, [reloadKey, clearLoadTimers]);

  // Drive the shimmer only while the skeleton is on screen.
  useEffect(() => {
    if (mapState !== 'loading') return;
    shimmer.setValue(0);
    const anim = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [mapState, shimmer]);

  // Track mount + clear timers on unmount (no late state, no leaked timers).
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearLoadTimers(); };
  }, [clearLoadTimers]);

  const handleMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }

    if (msg.type === 'ready') {
      log('map ready');
      readyRef.current = true;
      clearLoadTimers();
      setMapState('ready');
      setShowSlowHint(false);
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
      // Map is up — fade the themed cover/skeleton out to reveal it (no white flash).
      Animated.timing(coverFade, { toValue: 0, duration: 220, useNativeDriver: true })
        .start(() => { if (mountedRef.current) setCovered(false); });
    } else if (msg.type === 'maperror') {
      // Pre-ready asset failure (script/style/source). Ignore once ready so a
      // single late tile failure can't blank an already-usable map.
      if (!readyRef.current) {
        log('map error', msg.stage, msg.message ?? '');
        clearLoadTimers();
        setMapState('error');
      }
    } else if (msg.type === 'stage') {
      log('stage:', msg.stage);
    } else if (msg.type === 'net' && typeof msg.online === 'boolean') {
      // Connectivity change reported by the inline document (works even offline).
      log(msg.online ? 'internet connected' : 'internet disconnected');
      onConnectivity?.(msg.online);
    } else if (msg.type === 'markerTap' && typeof msg.id === 'string') {
      onMarkerTap(msg.id);
    }
  }, [post, onMarkerTap, onReady, onConnectivity, clearLoadTimers, coverFade]);

  // Retry: reset the bridge + cover, then remount the WebView via reloadKey.
  // The fresh WebView starts empty; markers/user are re-pushed on the next
  // 'ready' via the init message, so there are no duplicate markers/listeners.
  const handleRetry = useCallback(() => {
    log('retry pressed — remounting WebView');
    clearLoadTimers();
    readyRef.current = false;
    queueRef.current = [];
    coverFade.setValue(1);
    setCovered(true);
    setShowSlowHint(false);
    setMapState('loading');
    setReloadKey((k) => k + 1);
  }, [clearLoadTimers, coverFade]);

  const muted = isDark ? '#8E8E93' : '#6D6D72';
  const titleColor = isDark ? '#FFFFFF' : '#000000';
  const blockBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const shimmerBand = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.55)';
  const screenW = Dimensions.get('window').width;
  const shimmerX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-screenW, screenW],
  });

  return (
    <View style={[styles.fill, { backgroundColor: bg }]}>
      <WebView
        key={reloadKey}
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

      {/* Skeleton / cover — shown while loading, fades out on ready. */}
      {covered && mapState !== 'error' && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: bg, opacity: coverFade }]}
        >
          {/* Faint placeholder blocks echoing the real layout (search bar + pin). */}
          <View style={[styles.skelSearch, { backgroundColor: blockBg }]} />
          <View style={styles.skelCenter}>
            <View style={[styles.skelPin, { backgroundColor: blockBg }]} />
            {showSlowHint && (
              <Text style={[styles.skelHint, { color: muted }]}>Kartan laddas…</Text>
            )}
          </View>
          <View style={[styles.skelSheet, { backgroundColor: blockBg }]} />
          {/* Single sweeping shimmer band — native-driven, low opacity. */}
          <Animated.View
            style={[
              styles.shimmer,
              { backgroundColor: shimmerBand, transform: [{ translateX: shimmerX }, { rotate: '12deg' }] },
            ]}
          />
        </Animated.View>
      )}

      {/* Error / retry — interactive (the button must work). */}
      {mapState === 'error' && (
        <View style={[StyleSheet.absoluteFill, styles.errorWrap, { backgroundColor: bg }]}>
          <Text style={[styles.errorTitle, { color: titleColor }]}>Kartan kunde inte laddas</Text>
          <Text style={[styles.errorSub, { color: muted }]}>
            Kontrollera din internetanslutning och försök igen.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: accent }]}
            onPress={handleRetry}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Försök igen"
          >
            <Text style={styles.retryText}>Försök igen</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: 'transparent' },
  // Skeleton placeholders.
  skelSearch: {
    position: 'absolute', top: 110, left: 16, right: 16, height: 48, borderRadius: 14,
  },
  skelCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  skelPin: { width: 30, height: 40, borderRadius: 15 },
  skelHint: { marginTop: 16, fontSize: 14, fontWeight: '500' },
  skelSheet: {
    position: 'absolute', left: 16, right: 16, bottom: 28, height: 150, borderRadius: 18,
  },
  // Diagonal sweeping highlight.
  shimmer: { position: 'absolute', top: -80, bottom: -80, width: 120, opacity: 0.6 },
  // Error state.
  errorWrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  errorTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  errorSub: { marginTop: 8, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    marginTop: 22, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14,
  },
  retryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});

export default MasjidMapView;
