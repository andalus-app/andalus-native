/**
 * MasjidList — a draggable iOS-style bottom sheet of approved mosques.
 *
 * The sheet's HEIGHT is an Animated.Value. While the grab handle is dragged, the
 * height follows the finger live (setValue, clamped between snap points). On
 * release it springs to the nearest snap point, chosen by drag velocity or, if
 * slow, by which point is closer. There is NO instant state switch during a drag.
 *
 * Snap points:
 *   collapsed → user dragged the list off the bottom; parent shows a small
 *               round button (the "list" ball) to bring it back. Visually
 *               identical to 'shrunk' (translated off-screen, height kept).
 *   shrunk    → system-forced off-screen because a MasjidCard is on top.
 *               Restores to whatever mode preceded it.
 *   default   → fits the 3 nearest (map clearly visible)
 *   expanded  → nearly full screen (scrollable list is the focus)
 * "Visa fler" / "Visa färre" and selecting a masjid animate (spring) to a snap
 * point too — never an instant jump. The grab handle ignores drags while
 * collapsed/shrunk (panel is off-screen anyway; the parent owns re-entry).
 *
 * Two-layer view to satisfy the native-animated module: the OUTER Animated.View
 * owns the transform (translateY, useNativeDriver: true) and the INNER
 * Animated.View owns the layout height (useNativeDriver: false). Mixing the two
 * drivers on the same node throws "Style property 'height' is not supported by
 * native animated module" — different nodes, different drivers, no conflict.
 *
 * Cleanup: Animated listeners removed and any running animations stopped on
 * unmount. PanResponder lives on the handle view only — nothing keeps running
 * after the screen closes (MapLibre/WebView cleanup is unaffected).
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
import { masjidSubColor } from './colors';

export type SheetMode = 'collapsed' | 'shrunk' | 'default' | 'expanded';

const ROW_H = 58;                 // approx height of one list row
const BASE_H = 115;               // handle + header + footer + paddings (excl. safe-area)
const SLIDE_MARGIN = 60;          // extra px past panel height so shadow/safe-area also clears
const DRAG_ACTIVATE = 4;          // px before the handle claims the gesture
const FLICK_VELOCITY = 0.5;       // |vy| above which a flick decides the snap
const COLLAPSE_RATIO = 0.33;      // drag down at least 1/3 of panel height to collapse on release

const isHidden = (m: SheetMode) => m === 'shrunk' || m === 'collapsed';

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
  // Top buffer = insets.top + header(52) + searchBar(46) + 12 px breathing room
  // = insets.top + 110. The `-110` cap below subtracts that from the available
  // screen so the expanded panel's top edge lands directly under the search
  // field instead of sliding behind it.
  const DEFAULT_H = BASE_H + Math.min(count, MASJID_COLLAPSED_COUNT) * ROW_H;
  const EXPANDED_H = Math.min(height - insets.top - insets.bottom - 110, BASE_H + count * ROW_H);

  // Animated values + mirror refs so the PanResponder reads live values without
  // re-rendering. Height stays on the JS driver (native animated doesn't
  // support layout); translateY stays on the native driver (smoother slide).
  const heightAnim = useRef(new Animated.Value(DEFAULT_H)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const heightRef = useRef(DEFAULT_H);
  const dragStartRef = useRef(DEFAULT_H);
  const startModeRef = useRef<SheetMode>('default');
  const draggingRef = useRef(false);
  const didInitRef = useRef(false);

  // Latest values for the once-created PanResponder / spring helper.
  const snapRef = useRef({ def: DEFAULT_H, exp: EXPANDED_H, canExpand, mode });
  snapRef.current = { def: DEFAULT_H, exp: EXPANDED_H, canExpand, mode };
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  // Spring helper: animates height + translateY in parallel. For visible snaps
  // height matches the mode and translateY returns to 0. For hidden snaps
  // (collapsed/shrunk) the height is preserved (so the slide-back lands on the
  // same snap) and translateY drives the panel fully off the bottom.
  const springTo = useCallback((m: SheetMode) => {
    const { def, exp } = snapRef.current;
    const targetH = m === 'expanded' ? exp : isHidden(m) ? heightRef.current : def;
    const targetY = isHidden(m) ? heightRef.current + SLIDE_MARGIN : 0;
    Animated.parallel([
      Animated.spring(heightAnim, {
        toValue: targetH,
        tension: 90, friction: 14,
        useNativeDriver: false,
      }),
      Animated.spring(translateYAnim, {
        toValue: targetY,
        tension: 90, friction: 14,
        useNativeDriver: true,
      }),
    ]).start();
  }, [heightAnim, translateYAnim]);

  // Keep heightRef in sync with the animation; clean up on unmount.
  useEffect(() => {
    const id = heightAnim.addListener(({ value }) => { heightRef.current = value; });
    return () => {
      heightAnim.removeListener(id);
      heightAnim.stopAnimation();
      translateYAnim.stopAnimation();
    };
  }, [heightAnim, translateYAnim]);

  // Animate to the snap for the current mode whenever mode or the snap heights
  // change (e.g. data loaded, select → shrunk). First run sets values
  // instantly (no bounce on mount); later runs spring. Never fights a drag.
  // Hidden modes keep the current height — they only drive translateY.
  useEffect(() => {
    if (draggingRef.current) return;
    if (!didInitRef.current) {
      const initH = mode === 'expanded' ? EXPANDED_H : DEFAULT_H;
      heightAnim.setValue(initH);
      heightRef.current = initH;
      translateYAnim.setValue(isHidden(mode) ? initH + SLIDE_MARGIN : 0);
      didInitRef.current = true;
      return;
    }
    springTo(mode);
  }, [mode, DEFAULT_H, EXPANDED_H, heightAnim, translateYAnim, springTo]);

  // Snap scroll to top whenever we settle back to default.
  useEffect(() => {
    if (mode === 'default') scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [mode]);

  // Grab-handle drag.
  //   • Up from default / either way in expanded → height follows finger
  //     (existing snap behaviour: default ↔ expanded).
  //   • Down from default → translateY follows finger; release past
  //     COLLAPSE_RATIO or with a downward flick snaps to 'collapsed', else
  //     springs back to 'default'.
  // startModeRef locks the axis (height vs translateY) per drag, captured at
  // grant time, so a finger that changes direction mid-drag can't bounce
  // between the two systems.
  const panRef = useRef<PanResponderInstance | null>(null);
  if (!panRef.current) {
    panRef.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !isHidden(snapRef.current.mode) &&
        Math.abs(g.dy) > DRAG_ACTIVATE && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        draggingRef.current = true;
        heightAnim.stopAnimation();
        translateYAnim.stopAnimation();
        dragStartRef.current = heightRef.current;
        startModeRef.current = snapRef.current.mode;
      },
      onPanResponderMove: (_e, g) => {
        const { def, exp, canExpand: ce } = snapRef.current;
        const startMode = startModeRef.current;

        // Drag DOWN from default → translateY follows finger (slide off-screen).
        if (startMode === 'default' && g.dy > 0) {
          const maxSlide = def + SLIDE_MARGIN;
          translateYAnim.setValue(Math.min(g.dy, maxSlide));
          return;
        }

        // Otherwise drag changes height between snap points as before.
        const max = ce ? exp : def;
        let h = dragStartRef.current - g.dy; // drag up (dy<0) → taller
        if (h < def) h = def;
        if (h > max) h = max;
        heightAnim.setValue(h);
      },
      onPanResponderRelease: (_e, g) => {
        draggingRef.current = false;
        const { def, exp, canExpand: ce, mode: cur } = snapRef.current;
        const startMode = startModeRef.current;

        // Down-drag from default → collapse on a flick or after enough distance.
        if (startMode === 'default' && g.dy > 0) {
          const flickedDown = g.vy > FLICK_VELOCITY;
          if (flickedDown || g.dy > def * COLLAPSE_RATIO) {
            onModeChangeRef.current('collapsed');
          } else {
            springTo('default'); // snap the panel back up
          }
          return;
        }

        // Otherwise: existing height-based snap between default and expanded.
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
    // Outer node owns the transform (native driver). Inner node owns the
    // height (JS driver). See file header for why this split exists.
    <Animated.View style={{ transform: [{ translateY: translateYAnim }] }}>
      <Animated.View style={[styles.panel, { backgroundColor: T.card, height: heightAnim }]}>
        {/* Interactive grab handle — follows the finger live */}
        <View style={styles.handle} {...panRef.current.panHandlers}>
          <View style={[styles.handleBar, { backgroundColor: T.textTertiary }]} />
        </View>

        <Text style={[styles.header, { color: T.text }]}>Närmaste moské</Text>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={T.accent} /></View>
        ) : count === 0 ? (
          <Text style={[styles.empty, { color: T.textMuted }]}>Inga moskéer hittades i närheten.</Text>
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
                      {!!sub && <Text style={[styles.rowSub, { color: masjidSubColor(T) }]} numberOfLines={1}>{sub}</Text>}
                    </View>
                    <Text style={[styles.rowDist, { color: masjidSubColor(T) }]}>{formatDistance(m.distance_meters)}</Text>
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
                <Text style={[styles.moreText, { color: masjidSubColor(T) }]}>
                  {expanded ? 'Visa färre' : 'Visa fler'}
                </Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={masjidSubColor(T)} />
              </TouchableOpacity>
            )}
          </>
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
    paddingHorizontal: 16, paddingBottom: 8,
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
