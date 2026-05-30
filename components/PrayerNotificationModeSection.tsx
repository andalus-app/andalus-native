/**
 * Premium iOS-native "Aviseringsläge per bön" settings section.
 *
 * One row per prayer with a SINGLE active mode icon (no row of all-mode chips —
 * cleaner, less noisy, more iOS-native). Tapping the icon cycles the mode in
 * the order defined in PRAYER_NOTIFICATION_MODE_CYCLE. Selecting an adhan mode
 * expands an inline reciter picker beneath that prayer; the picker collapses
 * when the user cycles back to silent / vibration / standard.
 *
 * Mode changes:
 *   • write to AsyncStorage via storage/prayerNotificationPreferences
 *   • trigger a haptic
 *   • emit a frosted toast at the top of the section (auto-dismiss ~1.5 s)
 *   • the AppContext subscriber (see context/AppContext.tsx) reschedules the
 *     pending iOS notifications so the next fire respects the new mode.
 *
 * No state lives outside this component except the persisted modes themselves.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SvgXml } from 'react-native-svg';

import {
  ADHAN_RECITER_LABELS,
  PRAYER_DISPLAY_NAMES,
  PRAYER_NOTIFICATION_MODE_LABELS,
  PRAYER_NOTIFICATION_MODE_SUBTITLES,
  PRAYER_NOTIFICATION_MODE_TOAST,
  getAdhanReciterList,
  getNextPrayerNotificationMode,
  prayerNotificationModeIconXml,
} from '../services/prayerNotificationModes';
import {
  DEFAULT_PRAYER_NOTIFICATION_MODES,
  getCachedPrayerNotificationModes,
  loadPrayerNotificationModes,
  subscribePrayerNotificationModes,
  updatePrayerNotificationMode,
  updatePrayerNotificationReciter,
} from '../storage/prayerNotificationPreferences';
import {
  DEFAULT_ADHAN_RECITER,
  PRAYER_KEYS,
  isAdhanMode,
  type AdhanReciter,
  type PrayerKey,
  type PrayerNotificationMode,
  type PrayerNotificationModes,
} from '../types/prayerNotificationTypes';
import { playAdhan, stopAdhan, subscribeAdhanPlayback, getActiveAdhanTag } from '../services/adhanAudioService';
import { showToast } from '../services/toastService';
import type { Theme } from '../theme/colors';

// LayoutAnimation needs an explicit opt-in on Android (no-op on iOS).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Disclosure chevron — points down when collapsed, rotates 180° to point up when
// expanded. `__C__` is swapped for the muted theme colour at render time.
const CHEVRON_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="__C__" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>';

// Order shown in the bottom legend strip: Adhan, Standard, Tyst, Vibration.
const LEGEND_MODES: PrayerNotificationMode[] = ['adhan_short', 'standard', 'silent', 'vibration'];

// ── Mode icon (animated cross-fade on cycle) ─────────────────────────────────

function ModeIcon({ mode, color, size }: { mode: PrayerNotificationMode; color: string; size: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale   = useRef(new Animated.Value(1)).current;
  const lastModeRef = useRef(mode);

  useEffect(() => {
    if (lastModeRef.current === mode) return;
    lastModeRef.current = mode;
    opacity.setValue(0);
    scale.setValue(0.7);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(scale,   { toValue: 1, bounciness: 10, useNativeDriver: true }),
    ]).start();
  }, [mode, opacity, scale]);

  const xml = useMemo(() => prayerNotificationModeIconXml(mode, color), [mode, color]);

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      <SvgXml xml={xml} width={size} height={size} />
    </Animated.View>
  );
}

// ── Reciter selector (expandable inline strip) ───────────────────────────────

function ReciterStrip({
  prayer, reciter, expanded, T, onPick,
}: {
  prayer: PrayerKey;
  reciter: AdhanReciter;
  expanded: boolean;
  T: Theme;
  onPick: (r: AdhanReciter) => void;
}) {
  const height  = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const opacity = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  // When collapse animation finishes we drop the children from the tree so
  // the row's bottom padding fully collapses. `mounted` tracks the "should we
  // render the strip at all" decision separately from the animated value.
  const [mounted, setMounted] = useState(expanded);

  useEffect(() => {
    if (expanded) {
      setMounted(true);
    }
    const anim = Animated.parallel([
      Animated.timing(height,  { toValue: expanded ? 1 : 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(opacity, { toValue: expanded ? 1 : 0, duration: expanded ? 260 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]);
    anim.start(() => {
      if (!expanded) setMounted(false);
    });
  }, [expanded, height, opacity]);

  const maxHeight = height.interpolate({ inputRange: [0, 1], outputRange: [0, 72] });

  if (!mounted) return null;

  return (
    <Animated.View style={{ maxHeight, opacity, overflow: 'hidden' }}>
      <View style={styles.reciterStripInner}>
        {getAdhanReciterList().map((r) => {
          const active = r === reciter;
          return (
            <TouchableOpacity
              key={`${prayer}-${r}`}
              activeOpacity={0.7}
              onPress={() => onPick(r)}
              style={[
                styles.reciterChip,
                {
                  backgroundColor: active ? T.accent : 'transparent',
                  borderColor:     active ? T.accent : T.border,
                },
              ]}
            >
              <Text style={[styles.reciterChipText, { color: active ? '#fff' : T.text, fontWeight: active ? '700' : '500' }]}>
                {ADHAN_RECITER_LABELS[r]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}

// ── Play / stop preview button (inline triangle / square) ────────────────────

function PreviewButton({ playing, color, size }: { playing: boolean; color: string; size: number }) {
  if (playing) {
    return (
      <View style={{
        width: size * 0.46,
        height: size * 0.46,
        borderRadius: 2,
        backgroundColor: color,
      }}/>
    );
  }
  // CSS-free play triangle: a square rotated 45° with two adjacent borders
  // hidden by a coloured square would be heavier than just using SVG, so we
  // build it with borders — pointing right.
  const w = size * 0.5;
  const h = w * 0.86;
  return (
    <View style={{
      width: 0,
      height: 0,
      marginLeft: 3,
      borderTopWidth:    h / 2,
      borderBottomWidth: h / 2,
      borderLeftWidth:   w,
      borderTopColor:    'transparent',
      borderBottomColor: 'transparent',
      borderLeftColor:   color,
    }}/>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function PrayerRow({
  prayer, config, T, previewingPrayer, onCycle, onReciter, onPreview,
}: {
  prayer: PrayerKey;
  config: { mode: PrayerNotificationMode; reciter: AdhanReciter | null };
  T: Theme;
  previewingPrayer: PrayerKey | null;
  onCycle: (prayer: PrayerKey) => void;
  onReciter: (prayer: PrayerKey, r: AdhanReciter) => void;
  onPreview: (prayer: PrayerKey) => void;
}) {
  const expanded   = isAdhanMode(config.mode);
  const reciter    = config.reciter ?? DEFAULT_ADHAN_RECITER;
  const subtitle   = expanded
    ? `${PRAYER_NOTIFICATION_MODE_SUBTITLES[config.mode]} - ${ADHAN_RECITER_LABELS[reciter]}`
    : PRAYER_NOTIFICATION_MODE_SUBTITLES[config.mode];
  const isPreviewing = previewingPrayer === prayer;

  return (
    <View style={[styles.row, { backgroundColor: T.card, borderColor: T.border }]}>
      <View style={styles.rowMain}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.prayerName, { color: T.text }]}>{PRAYER_DISPLAY_NAMES[prayer]}</Text>
          <Text style={[styles.prayerSubtitle, { color: T.textMuted }]} numberOfLines={1}>{subtitle}</Text>
        </View>

        {expanded && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onPreview(prayer)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={isPreviewing ? 'Stoppa förhandsvisning' : 'Lyssna på adhan'}
            style={[
              styles.previewButton,
              {
                backgroundColor: isPreviewing ? T.text : 'transparent',
                borderColor:     isPreviewing ? T.text : T.border,
              },
            ]}
          >
            <PreviewButton playing={isPreviewing} color={isPreviewing ? (T.isDark ? '#000' : '#fff') : T.text} size={22} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onCycle(prayer)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[
            styles.iconButton,
            { backgroundColor: T.accentGlow, borderColor: T.border },
          ]}
        >
          <ModeIcon mode={config.mode} color={T.text} size={22} />
        </TouchableOpacity>
      </View>

      <ReciterStrip
        prayer={prayer}
        reciter={reciter}
        expanded={expanded}
        T={T}
        onPick={r => onReciter(prayer, r)}
      />
    </View>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

/** Tag prefix used on adhanAudioService so we can distinguish settings previews
 *  from actual prayer-notification playback. The suffix is the PrayerKey. */
const PREVIEW_TAG_PREFIX = 'preview:';

function tagFor(prayer: PrayerKey): string {
  return `${PREVIEW_TAG_PREFIX}${prayer}`;
}

function previewingPrayerFromTag(tag: string | null): PrayerKey | null {
  if (!tag || !tag.startsWith(PREVIEW_TAG_PREFIX)) return null;
  const candidate = tag.slice(PREVIEW_TAG_PREFIX.length) as PrayerKey;
  return (PRAYER_KEYS as readonly string[]).includes(candidate) ? candidate : null;
}

export default function PrayerNotificationModeSection({ T }: { T: Theme }) {
  const [modes, setModes] = useState<PrayerNotificationModes>(DEFAULT_PRAYER_NOTIFICATION_MODES);
  const [previewingPrayer, setPreviewingPrayer] = useState<PrayerKey | null>(
    () => previewingPrayerFromTag(getActiveAdhanTag()),
  );

  useEffect(() => {
    let mounted = true;
    loadPrayerNotificationModes().then(m => { if (mounted) setModes(m); }).catch(() => {});
    const unsubscribeModes = subscribePrayerNotificationModes(m => {
      if (mounted) setModes(m);
    });
    // Track which prayer's preview is currently playing so the row button can
    // switch between play / stop. The tag is what `playAdhan(..., tag)` stamped
    // on the active player; we strip the prefix to get the PrayerKey.
    const unsubscribePlayback = subscribeAdhanPlayback(tag => {
      if (mounted) setPreviewingPrayer(previewingPrayerFromTag(tag));
    });
    return () => {
      mounted = false;
      unsubscribeModes();
      unsubscribePlayback();
    };
  }, []);

  // All three handlers read directly from the storage cache instead of the
  // React `modes` state so rapid taps cycle on the LATEST value — never on a
  // stale closure that captured a one-render-old `modes` object. The cache is
  // updated synchronously inside `updatePrayerNotificationMode` before the
  // async AsyncStorage write completes, so successive clicks always advance.

  const handleCycle = useCallback((prayer: PrayerKey) => {
    const cached  = getCachedPrayerNotificationModes();
    const current = cached[prayer]?.mode ?? 'standard';
    const next    = getNextPrayerNotificationMode(current);
    Haptics.selectionAsync().catch(() => {});
    // Stop any preview that may still be running — cycling away from adhan_*
    // should also halt the audio.
    try { stopAdhan(); } catch {}
    // Fire and forget — the storage write is awaited internally, but we don't
    // block the click handler on it. Toast goes out immediately so the user
    // sees feedback in the same frame as their tap.
    updatePrayerNotificationMode(prayer, next).catch(() => {});
    showToast(PRAYER_NOTIFICATION_MODE_TOAST[next]);
  }, []);

  const handleReciter = useCallback((prayer: PrayerKey, reciter: AdhanReciter) => {
    const cached  = getCachedPrayerNotificationModes();
    const current = cached[prayer];
    if (!current || !isAdhanMode(current.mode)) return;
    if (current.reciter === reciter) return;
    Haptics.selectionAsync().catch(() => {});
    // No auto-preview here — the user previews explicitly with the play button
    // next to the mode icon, so picking a reciter is purely a state change.
    // If a preview is currently running for this prayer, stop it so the next
    // play tap loads the newly-picked reciter rather than continuing the old one.
    if (previewingPrayer === prayer) {
      try { stopAdhan(); } catch {}
    }
    updatePrayerNotificationReciter(prayer, reciter).catch(() => {});
  }, [previewingPrayer]);

  const handlePreview = useCallback((prayer: PrayerKey) => {
    const cached  = getCachedPrayerNotificationModes();
    const current = cached[prayer];
    if (!current || !isAdhanMode(current.mode)) return;
    Haptics.selectionAsync().catch(() => {});
    if (previewingPrayer === prayer) {
      try { stopAdhan(); } catch {}
      return;
    }
    const reciter = current.reciter ?? DEFAULT_ADHAN_RECITER;
    // Preview uses the bundled short clip — the same audio the iOS notification
    // will play when the prayer time fires (≤30 s, capped by iOS).
    try { playAdhan(reciter, tagFor(prayer)); } catch {}
  }, [previewingPrayer]);

  // Collapsed by default — the five per-prayer rows + legend live behind a
  // disclosure chevron so the Aviseringar section stays compact. LayoutAnimation
  // handles the variable-height expand/collapse; the chevron rotates via Animated.
  const [expanded, setExpanded] = useState(false);
  const chevron = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(chevron, {
      toValue: expanded ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [expanded, chevron]);

  const toggleExpanded = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    LayoutAnimation.configureNext(
      LayoutAnimation.create(260, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
    );
    setExpanded(prev => !prev);
  }, []);

  const chevronRotate = chevron.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View>
      {/* Disclosure header — tap the row / chevron to reveal the per-prayer rows */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={toggleExpanded}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Dölj lägen per bön' : 'Visa lägen per bön'}
        style={[styles.header, { backgroundColor: T.card, borderColor: T.border }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: T.text }]}>Anpassa per bön</Text>
          <Text style={[styles.headerSub, { color: T.textMuted }]} numberOfLines={1}>
            Ljud, vibration eller adhan för varje bön
          </Text>
        </View>
        <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
          <SvgXml xml={CHEVRON_ICON.replace(/__C__/g, T.textMuted)} width={20} height={20} />
        </Animated.View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedWrap}>
          <View style={styles.helperWrap}>
            <Text style={[styles.helperText, { color: T.textMuted }]} numberOfLines={2}>
              Tryck på ikonen för att växla läge för varje bön. Standard är aktivt för alla bönerna.
            </Text>
          </View>

          {PRAYER_KEYS.map(prayer => (
            <PrayerRow
              key={prayer}
              prayer={prayer}
              config={modes[prayer]}
              T={T}
              previewingPrayer={previewingPrayer}
              onCycle={handleCycle}
              onReciter={handleReciter}
              onPreview={handlePreview}
            />
          ))}

          {/* Icon legend — explains every mode symbol horizontally */}
          <View style={[styles.legend, { backgroundColor: T.card, borderColor: T.border }]}>
            {LEGEND_MODES.map(m => (
              <View key={m} style={styles.legendItem}>
                <SvgXml xml={prayerNotificationModeIconXml(m, T.text)} width={22} height={22} />
                <Text style={[styles.legendLabel, { color: T.textMuted }]} numberOfLines={1}>
                  {PRAYER_NOTIFICATION_MODE_LABELS[m]}
                </Text>
              </View>
            ))}
          </View>

          <Text style={[styles.footnote, { color: T.textMuted }]} numberOfLines={2}>
            Adhan spelas upp av iOS — fungerar även när telefonen är låst.
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 0.5,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  headerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  expandedWrap: {
    marginTop: 8,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 0.5,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  legendItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  helperWrap: {
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
  },
  row: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 8,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  prayerName: {
    fontSize: 15,
    fontWeight: '600',
  },
  prayerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  reciterStripInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 12,
  },
  reciterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  reciterChipText: {
    fontSize: 12.5,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
    paddingHorizontal: 4,
  },
});
