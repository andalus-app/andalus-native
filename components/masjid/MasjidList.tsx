/**
 * MasjidList — a draggable iOS-style bottom sheet of approved mosques.
 *
 * The sheet's HEIGHT is an Animated.Value. While the grab handle is dragged, the
 * height follows the finger live (setValue, clamped between snap points). On
 * release it springs to the nearest snap point, chosen by drag velocity or, if
 * slow, by which point is closer. There is NO instant state switch during a drag.
 *
 * Snap points:
 *   default  → fits the 3 nearest (map clearly visible)
 *   expanded → nearly full screen (scrollable list is the focus)
 * "Visa fler" / "Visa färre" and selecting a masjid animate (spring) to a snap
 * point too — never an instant jump.
 *
 * Cleanup: the Animated.Value listener is removed and any running animation is
 * stopped on unmount. PanResponder lives on the handle view only — nothing keeps
 * running after the screen closes (MapLibre/WebView cleanup is unaffected).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
  Animated, PanResponder, useWindowDimensions, type PanResponderInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type Mosque, MASJID_COLLAPSED_COUNT } from '../../services/mosques';
import { useTheme } from '../../context/ThemeContext';
import { formatDistance } from './format';

export type SheetMode = 'default' | 'expanded';

const ROW_H = 58;                 // approx height of one list row
const BASE_H = 115;               // handle + header + footer + paddings (excl. safe-area)
const DRAG_ACTIVATE = 4;          // px before the handle claims the gesture
const FLICK_VELOCITY = 0.5;       // |vy| above which a flick decides the snap

export default function MasjidList({
  mosques,
  loading,
  mode,
  onModeChange,
  onSelect,
}: {
  mosques: Mosque[];
  loading: boolean;
  mode: SheetMode;
  onModeChange: (m: SheetMode) => void;
  onSelect: (m: Mosque) => void;
}) {
  const { theme: T } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const count = mosques.length;
  const canExpand = count > MASJID_COLLAPSED_COUNT;

  // Snap heights. default fits ≤3 rows; expanded is nearly full screen (capped
  // so it never hides the header and never exceeds the actual content).
  const DEFAULT_H = BASE_H + Math.min(count, MASJID_COLLAPSED_COUNT) * ROW_H;
  const EXPANDED_H = Math.min(height - insets.top - insets.bottom - 90, BASE_H + count * ROW_H);

  // Animated sheet height + a mirror ref (kept current via a listener) so the
  // PanResponder can read the live height without re-rendering.
  const heightAnim = useRef(new Animated.Value(DEFAULT_H)).current;
  const heightRef = useRef(DEFAULT_H);
  const dragStartRef = useRef(DEFAULT_H);
  const draggingRef = useRef(false);
  const didInitRef = useRef(false);

  // Latest values for the once-created PanResponder / spring helper.
  const snapRef = useRef({ def: DEFAULT_H, exp: EXPANDED_H, canExpand, mode });
  snapRef.current = { def: DEFAULT_H, exp: EXPANDED_H, canExpand, mode };
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  const springTo = useCallback((m: SheetMode) => {
    const { def, exp } = snapRef.current;
    Animated.spring(heightAnim, {
      toValue: m === 'expanded' ? exp : def,
      tension: 90, friction: 14,
      useNativeDriver: false, // height can't use the native driver
    }).start();
  }, [heightAnim]);

  // Keep heightRef in sync with the animation; clean up on unmount.
  useEffect(() => {
    const id = heightAnim.addListener(({ value }) => { heightRef.current = value; });
    return () => { heightAnim.removeListener(id); heightAnim.stopAnimation(); };
  }, [heightAnim]);

  // Animate to the snap point for the current mode whenever mode or the snap
  // heights change (e.g. data loaded, select → default). First run sets it
  // instantly (no bounce on mount); later runs spring. Never fights a drag.
  useEffect(() => {
    if (draggingRef.current) return;
    if (!didInitRef.current) {
      heightAnim.setValue(mode === 'expanded' ? EXPANDED_H : DEFAULT_H);
      heightRef.current = mode === 'expanded' ? EXPANDED_H : DEFAULT_H;
      didInitRef.current = true;
      return;
    }
    springTo(mode);
  }, [mode, DEFAULT_H, EXPANDED_H, heightAnim, springTo]);

  // Snap scroll to top whenever we settle back to default.
  useEffect(() => {
    if (mode === 'default') scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [mode]);

  // Grab-handle drag: follow the finger live, snap on release.
  const panRef = useRef<PanResponderInstance | null>(null);
  if (!panRef.current) {
    panRef.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > DRAG_ACTIVATE && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        draggingRef.current = true;
        heightAnim.stopAnimation();
        dragStartRef.current = heightRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const { def, exp, canExpand: ce } = snapRef.current;
        const max = ce ? exp : def;
        let h = dragStartRef.current - g.dy; // drag up (dy<0) → taller
        if (h < def) h = def;
        if (h > max) h = max;
        heightAnim.setValue(h);
      },
      onPanResponderRelease: (_e, g) => {
        draggingRef.current = false;
        const { def, exp, canExpand: ce, mode: cur } = snapRef.current;
        if (!ce) { springTo('default'); return; }
        let target: SheetMode;
        if (g.vy < -FLICK_VELOCITY) target = 'expanded';
        else if (g.vy > FLICK_VELOCITY) target = 'default';
        else target = heightRef.current > (def + exp) / 2 ? 'expanded' : 'default';
        if (target === cur) springTo(target);          // snap back to current
        else onModeChangeRef.current(target);           // parent → effect springs
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        springTo(snapRef.current.mode);
      },
    });
  }

  const expanded = mode === 'expanded';

  return (
    <Animated.View style={[styles.panel, { backgroundColor: T.card, height: heightAnim }]}>
      {/* Interactive grab handle — follows the finger live */}
      <View style={styles.handle} {...panRef.current.panHandlers}>
        <View style={[styles.handleBar, { backgroundColor: T.textTertiary }]} />
      </View>

      <Text style={[styles.header, { color: T.text }]}>Närmaste masjid</Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={T.accent} /></View>
      ) : count === 0 ? (
        <Text style={[styles.empty, { color: T.textMuted }]}>Inga masjid hittades i närheten.</Text>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            scrollEnabled={expanded}
            showsVerticalScrollIndicator={expanded}
            contentContainerStyle={{ paddingBottom: 4 }}
          >
            {mosques.map((m) => {
              const sub = [m.city, m.address].filter(Boolean).join(' · ');
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.row, { borderBottomColor: T.separator }]}
                  onPress={() => onSelect(m)}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowMain}>
                    <Text style={[styles.rowName, { color: T.text }]} numberOfLines={1}>{m.name}</Text>
                    {!!sub && <Text style={[styles.rowSub, { color: T.textMuted }]} numberOfLines={1}>{sub}</Text>}
                  </View>
                  <Text style={[styles.rowDist, { color: T.accent }]}>{formatDistance(m.distance_meters)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={T.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Pinned footer toggle — always visible (springs to a snap point) */}
          {canExpand && (
            <TouchableOpacity
              style={[styles.more, { backgroundColor: T.cardElevated }]}
              onPress={() => onModeChange(expanded ? 'default' : 'expanded')}
              activeOpacity={0.8}
            >
              <Text style={[styles.moreText, { color: T.accent }]}>
                {expanded ? 'Visa färre' : 'Visa fler'}
              </Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={T.accent} />
            </TouchableOpacity>
          )}
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingBottom: 8,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: -2 }, elevation: 10,
  },
  handle: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
  handleBar: { width: 42, height: 5, borderRadius: 3 },
  header: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  scroll: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 13, marginTop: 2 },
  rowDist: { fontSize: 14, fontWeight: '600' },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 13, marginTop: 8 },
  moreText: { fontSize: 15, fontWeight: '600' },
});
