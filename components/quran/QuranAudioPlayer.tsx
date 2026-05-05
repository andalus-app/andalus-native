/**
 * QuranAudioPlayer.tsx
 *
 * Ayah-style audio player using react-native-track-player.
 * All playback routes through QuranAudioEngine (RNTP singleton).
 * This component subscribes to engine snapshots and renders UI only.
 *
 * Two modes:
 *   idle   — compact pill: [surah + reciter ▼] [▶]
 *   active — full card: reciter header / verse label / seek bar / controls
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  memo,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { setAudioModeAsync } from 'expo-audio';
import { BlurView } from 'expo-blur';
import { usePathname } from 'expo-router';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext, useActiveVerseKey } from '../../context/QuranContext';
import { useNotification } from '../../context/NotificationContext';
import { pauseYoutubePlayer } from '../../context/YoutubePlayerContext';
import {
  getAudioUri,
  downloadSurahAudio,
  ensureAudioDir,
  isSurahDownloaded,
  getBismillahAudioUri,
  isBismillahDownloaded,
  getVerseAudioUri,
  RECITERS,
  DownloadCancelledError,
} from '../../services/quranAudioService';
import {
  fetchVerseTimings,
  type VerseTimestamp,
} from '../../services/mushafTimingService';
import { SURAH_INDEX } from '../../data/surahIndex';
import RepeatSettingsModal, { type RepeatSettings } from './RepeatSettingsModal';
import { showRoutePicker } from 'airplay-route-picker';
import { QuranAudioEngine, VerseUrlUnavailableError } from '../../services/quranAudioEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

type PlayerState =
  | { mode: 'hidden' }
  | { mode: 'downloading'; surahId: number; progress: number }
  | { mode: 'loading'; surahId: number; positionMs?: number; durationMs?: number }
  | { mode: 'playing'; surahId: number; positionMs: number; durationMs: number }
  | { mode: 'paused'; surahId: number; positionMs: number; durationMs: number }
  | { mode: 'error'; surahId: number; message: string };

// Height of the thumbnail-strip page picker (paddingTop + surahName + FlatList + paddingBottom).
// iOS paddingBottom=10, Android=8 → picker height ~137/135px.
// picker.bottom is 22 (iOS) / 10 (Android) — add that + 8px gap to clear it.
const PICKER_CLEARANCE = Platform.OS === 'ios'
  ? 36 + 138 - 6   // 168 px
  : 20 + 136 - 6;  // 150 px
// Sorted highest-first so top of popup = fastest, bottom = slowest
const RATE_STEPS = [2, 1.75, 1.5, 1.25, 1, 0.75, 0.5] as const;
const DEFAULT_RATE_INDEX = 4; // 1× normal speed


// ── Helpers ────────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseVerseKey(key: string | null): { surahName: string; verseNum: number } | null {
  if (!key) return null;
  const parts = key.split(':');
  if (parts.length !== 2) return null;
  const surahId = parseInt(parts[0], 10);
  const verseNum = parseInt(parts[1], 10);
  const surah = SURAH_INDEX.find((s) => s.id === surahId);
  if (!surah) return null;
  return { surahName: surah.nameSimple, verseNum };
}

// ── Animated Download Icon ────────────────────────────────────────────────────
//
// A looping download animation: thick arrow slides down toward a tray base,
// fades out as it hits the bottom, then fades back in at the top and repeats.

const AnimatedDownloadIcon = memo(function AnimatedDownloadIcon() {
  const progress = useRef(new Animated.Value(0)).current;
  const animRef  = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current = Animated.loop(
      Animated.timing(progress, {
        toValue:         1,
        duration:        850,
        useNativeDriver: true,
        easing:          Easing.inOut(Easing.quad),
      }),
    );
    animRef.current.start();
    return () => {
      animRef.current?.stop();
      progress.setValue(0);
    };
  }, [progress]);

  const translateY = progress.interpolate({
    inputRange:  [0, 1],
    outputRange: [-7, 5],
  });
  const opacity = progress.interpolate({
    inputRange:  [0, 0.12, 0.65, 1],
    outputRange: [0,  1,    1,   0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
      {/* Static tray base — U-shape at the bottom */}
      <Svg width={28} height={28} viewBox="0 0 28 28" style={{ position: 'absolute' }}>
        <Path
          d="M5 20 L5 23 Q5 24.5 6.5 24.5 L21.5 24.5 Q23 24.5 23 23 L23 20"
          stroke="#fff"
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>

      {/* Animated arrow: stem + chevron head */}
      <Animated.View style={{ transform: [{ translateY }], opacity }}>
        <Svg width={18} height={16} viewBox="0 0 18 16">
          {/* Stem */}
          <Path
            d="M9 1 L9 10"
            stroke="#fff"
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
          {/* Arrowhead */}
          <Path
            d="M3.5 7 L9 13 L14.5 7"
            stroke="#fff"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Animated.View>
    </View>
  );
});

// ── Component ─────────────────────────────────────────────────────────────────

function QuranAudioPlayer() {
  const { theme: T, isDark } = useTheme();
  const { show: showNotification } = useNotification();
  // Mirrored into a ref so the stable status callback / async chains can call
  // the latest version without re-creating callbacks on every notification re-render.
  const showNotificationRef = useRef(showNotification);
  showNotificationRef.current = showNotification;
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isLandscape = screenW > screenH;
  // In landscape, constrain width to match portrait (= landscape height minus margins).
  // Center horizontally with equal left/right insets.
  const landscapePlayerW = screenH - 24; // mirrors portrait: screenW - left12 - right12
  const landscapeInset   = isLandscape ? (screenW - landscapePlayerW) / 2 : 12;
  const {
    audioCommandsRef,
    audioCacheRefreshRef,
    settings,
    openReciterSelector,
    currentSurahId,
    currentPage,
    setPlaybackVerse,
    chromeVisible,
    contentsMenuOpen,
    settingsPanelOpen,
    searchOpen,
    reciterSelectorOpen,
    longPressedVerse,
    clearUserPageOverride,
  } = useQuranContext();
  const activeVerseKey = useActiveVerseKey();

  // This component is mounted at app root (see app/_layout.tsx) so the audio
  // engine — player ref, status listener, lock-screen integration, repeat
  // logic — survives navigation away from /quran. The UI bar, however, must
  // only appear while the user is actually on the Quran reader page itself.
  //
  // Two gates:
  //   1. pathname must be /quran — hides the chip when the user navigates to
  //      home, prayer times, qibla etc. while audio plays in the background.
  //   2. No full-screen Quran modal (contents / settings / search / reciter /
  //      verse-actions) is open. Pre-hoist these used a higher z-index in the
  //      same render tree to cover the chip; now the chip lives in a different
  //      tree so we must hide it explicitly.
  const pathname = usePathname();
  const isOnQuranScreen = pathname === '/quran';
  const isAnyModalOpen =
    contentsMenuOpen || settingsPanelOpen || searchOpen ||
    reciterSelectorOpen || longPressedVerse !== null;
  const showPlayerUi = isOnQuranScreen && !isAnyModalOpen;

  const [playerState, setPlayerState] = useState<PlayerState>({ mode: 'hidden' });
  const [rateIndex, setRateIndex] = useState(DEFAULT_RATE_INDEX);
  const [seekBarWidth, setSeekBarWidth] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showRepeatModal, setShowRepeatModal] = useState(false);
  const [repeatSettings, setRepeatSettings] = useState<RepeatSettings>({
    fromSurahId: currentSurahId,
    fromVerse: 1,
    toSurahId: currentSurahId,
    toVerse: SURAH_INDEX.find((s) => s.id === currentSurahId)?.versesCount ?? 1,
    repeatInterval: false,
    repeatVerse: false,
    repeatCount: null,
    repeatVerseCount: null,
  });

  const mountedRef = useRef(true);
  const currentSurahIdRef = useRef<number | null>(null);
  const rateIndexRef = useRef(DEFAULT_RATE_INDEX);

  // Repeat settings refs — accessed inside the stable onPlaybackStatusUpdate callback.
  const repeatSettingsRef = useRef(repeatSettings);
  repeatSettingsRef.current = repeatSettings;

  // Set when the player is currently sourced from a per-verse audio file
  // (one ayah, played end-to-end and looped) instead of the chapter file.
  // While active:
  //   • verseTimingsRef.current is null — no verse-transition / highlight sync.
  //   • The chapter-file repeat-interval / verse-transition logic in
  //     onPlaybackStatusUpdate is bypassed.
  //   • didJustFinish either reseeks-and-replays (finite count, JS counts) or
  //     never fires at all (infinite count, native AVPlayer loop handles it).
  //
  // For finite count: `count` is the target number of plays; `plays` starts at 1
  // (the first end-to-end play) and increments on each didJustFinish.
  // For infinite count: count = null, plays is unused (AVPlayer.loop = true does
  // the work natively, didJustFinish is suppressed by the native loop branch).
  const verseLoopActiveRef = useRef<{
    surahId: number;
    verseId: number;     // 0 for bismillah (BSMLLH_X)
    verseKey: string;    // canonical key for highlight + lock-screen metadata
    count: number | null;
    plays: number;
    pageNumber: number;
  } | null>(null);

  // Set true while loadAndLoopVerse is invoking its chapter-mode fallback
  // (per-verse CDN URL didn't resolve). Tells loadAndPlayFromVerse to skip
  // its repeat-verse → verse-loop routing, otherwise the two functions
  // would tail-recurse via promise chain forever, the audio session
  // would never get a real player, and nothing would play.
  const bypassVerseLoopRoutingRef = useRef(false);

  // Reciter IDs whose CDN doesn't expose per-verse audio files. Populated
  // the first time loadAndLoopVerse falls back for a reciter; checked by
  // the auto-enter-on-first-verse hook in onPlaybackStatusUpdate so we
  // don't retry verse-loop on every verse transition (which would tear
  // down the chapter player every few seconds and prevent any audio from
  // playing). The set is intentionally not persisted across app launches —
  // expo-audio's reciter list and QuranCDN slugs both change rarely; a
  // restart simply gives the user one more chance to discover availability.
  const verseLoopUnavailableReciterRef = useRef<Set<number>>(new Set());

  // Cross-surah "Spela till" target — set when stopAtVerseKey belongs to a future surah.
  // Persists across intermediate loadAndPlay calls so each surah advance can check it.
  // Cleared by stop() and at the start of loadAndPlayFromVerse (new session).
  const pendingStopVerseKeyRef = useRef<string | null>(null);

  // continuous: true = "Spela vidare" mode — auto-advance through surahs on finish.
  // Ref-mirrored loadAndPlay so onPlaybackStatusUpdate can trigger it without
  // capturing a stale closure (onPlaybackStatusUpdate has empty deps).
  const continuousPlayRef = useRef(false);
  const loadAndPlayRef = useRef<((surahId: number) => void) | null>(null);
  const loadAndPlayFromVerseRef = useRef<((surahId: number, startVerseKey: string, stopAtVerseKey: string | null) => Promise<void>) | null>(null);

  const setPlaybackVerseRef = useRef(setPlaybackVerse);
  setPlaybackVerseRef.current = setPlaybackVerse;

  // Mirror activeVerseKey in a ref so async callbacks always read the latest value.
  const activeVerseKeyRef = useRef(activeVerseKey);
  activeVerseKeyRef.current = activeVerseKey;

  // Load generation counter: prevents stale async chains from multiple rapid taps.
  const loadGenerationRef = useRef<number>(0);

  // Cancel hook for an in-progress download — set by downloadSurahAudio, cleared on finish/cancel.
  const downloadCancelRef = useRef<(() => void) | null>(null);

  // Stable reciter ref — used in loadAndLoopVerse error handler.
  const reciterIdRef = useRef(settings.reciterId);
  reciterIdRef.current = settings.reciterId;

  // ── Audio mode + engine setup ──────────────────────────────────────────────
  //
  // Both expo-audio (for dhikr/asmaul/umrah short clips) and TrackPlayer (for
  // Quran) share the global AVAudioSession. To make the final session category
  // deterministic, we chain: setAudioModeAsync resolves first (configures the
  // session for expo-audio), then engine.init() runs TrackPlayer.setupPlayer
  // which overrides the category to .playback and registers the lock-screen
  // capabilities. TrackPlayer is the last writer → wins for the Quran playback
  // session that this component cares about.
  useEffect(() => {
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    })
      .catch(() => undefined)
      .then(() => QuranAudioEngine.init())
      .catch(() => undefined);
  }, []);

  // ── TrackPlayer engine bridge ───────────────────────────────────────────────
  //
  // Mirrors engine snapshots into PlayerState + the QuranContext verse-page
  // bridge. The engine itself only fires emit() when AppState === 'active',
  // so this subscriber does not run in background — that's how we stay under
  // iOS's audio-background CPU budget. See services/quranAudioEngine.ts.
  useEffect(() => {
    const unsub = QuranAudioEngine.subscribe((snap) => {
      if (!mountedRef.current) return;

      switch (snap.state) {
        case 'idle':
          setPlayerState({ mode: 'hidden' });
          // Engine is idle → no verse-loop can be running. Clear the component-side
          // ref so the reciter-change handler doesn't see stale verse-loop state
          // from a previous session (e.g. finite verse-loop that completed, or
          // stop() called while verse-loop was active). Without this, changing the
          // reciter after a surah ends would incorrectly restart the old verse-loop
          // instead of beginning the surah from the top.
          verseLoopActiveRef.current = null;
          break;
        case 'downloading':
          setPlayerState({
            mode:     'downloading',
            surahId:  snap.surahId ?? 0,
            progress: snap.downloadProgress ?? 0,
          });
          break;
        case 'loading':
          setPlayerState({
            mode:       'loading',
            surahId:    snap.surahId ?? 0,
            positionMs: snap.positionMs,
            durationMs: snap.durationMs,
          });
          break;
        case 'playing':
          setPlayerState({
            mode:       'playing',
            surahId:    snap.surahId ?? 0,
            positionMs: snap.positionMs,
            durationMs: snap.durationMs,
          });
          break;
        case 'paused':
          setPlayerState({
            mode:       'paused',
            surahId:    snap.surahId ?? 0,
            positionMs: snap.positionMs,
            durationMs: snap.durationMs,
          });
          break;
        case 'error':
          setPlayerState({
            mode:    'error',
            surahId: snap.surahId ?? 0,
            message: snap.errorMessage ?? 'Kunde inte ladda ljud',
          });
          break;
      }

      // Drive verse highlight + auto-page-advance from the engine snapshot.
      setPlaybackVerseRef.current(snap.activeVerseKey, snap.pageNumber);
    });

    return () => unsub();
  }, []);

  // Push the current reciter ID + repeat settings into the engine. The engine
  // reads these on its next loadAndPlay / loadAndLoopVerse / loadAndPlayFromVerse
  // call, so they must be current before any user-initiated playback.
  useEffect(() => {
    QuranAudioEngine.setReciter(settings.reciterId);
  }, [settings.reciterId]);

  useEffect(() => {
    QuranAudioEngine.setRepeatSettings(repeatSettings);
  }, [repeatSettings]);

  // When interval-repeat loops back to the from-verse the engine fires this
  // callback so we can clear the user-page-override before the audio-driven
  // page revert fires. Without this, the override (set by onViewableItemsChanged
  // confirming the audio-advance to the to-verse's page) would block the revert.
  useEffect(() => {
    QuranAudioEngine.setIntervalLoopBackCallback(clearUserPageOverride);
    return () => QuranAudioEngine.setIntervalLoopBackCallback(null);
  }, [clearUserPageOverride]);

  // ── Chrome fade — replicated locally now that the player is mounted at app
  // root rather than wrapped by QuranScreen's chromeAnim Animated.View. The
  // visual behavior on /quran is unchanged: opacity follows chromeVisible.
  const chromeAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(chromeAnim, {
      toValue: chromeVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [chromeVisible, chromeAnim]);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadAndPlay = useCallback(
    async (surahId: number) => {
      if (!mountedRef.current) return;
      ++loadGenerationRef.current;
      pauseYoutubePlayer();
      clearUserPageOverride();
      currentSurahIdRef.current = surahId;

      QuranAudioEngine.setReciter(settings.reciterId);
      QuranAudioEngine.setRepeatSettings(repeatSettings);

      QuranAudioEngine.loadAndPlay(surahId).catch(() => undefined);

      audioCacheRefreshRef.current?.();
    },
    [settings.reciterId, repeatSettings, audioCacheRefreshRef, clearUserPageOverride],
  );

  // Keep ref in sync so onPlaybackStatusUpdate can call loadAndPlay without a
  // stale closure. Pattern mirrors setPlaybackVerseRef / isRepeatRef above.
  // NOTE: loadAndPlayFromVerseRef is assigned AFTER its useCallback definition below
  // (line ~965) — assigning it here would capture undefined due to const TDZ / hoisting.
  loadAndPlayRef.current = loadAndPlay;

  const pause = useCallback(() => {
    QuranAudioEngine.pause().catch(() => undefined);
    // Immediate UI feedback — don't wait for the engine snapshot.
    setPlayerState((prev) =>
      prev.mode === 'playing'
        ? { mode: 'paused', surahId: prev.surahId, positionMs: prev.positionMs, durationMs: prev.durationMs }
        : prev,
    );
  }, []);

  const resume = useCallback(() => {
    // User actively resumed playback — re-enable auto-page so the reader follows
    // along again. (See QuranContext.userPageOverrideTsRef.)
    clearUserPageOverride();
    QuranAudioEngine.resume().catch(() => undefined);
    // Immediate UI feedback — flip to playing so the icon changes instantly.
    setPlayerState((prev) =>
      prev.mode === 'paused'
        ? { mode: 'playing', surahId: prev.surahId, positionMs: prev.positionMs, durationMs: prev.durationMs }
        : prev,
    );
  }, [clearUserPageOverride]);

  const stop = useCallback(() => {
    QuranAudioEngine.stop().catch(() => undefined);
    currentSurahIdRef.current = null;
    verseLoopActiveRef.current = null;
    if (mountedRef.current) setPlayerState({ mode: 'hidden' });
  }, []);

  const skipVerse = useCallback(
    (delta: 1 | -1) => {
      // Delegate entirely to the engine's skipVerse which holds live timings,
      // handles verse-loop / BSMLLH_ / surah-boundary cases, and is the same
      // implementation used by the lock-screen remote controls.
      QuranAudioEngine.skipVerse(delta).catch(() => undefined);
    },
    [],
  );

  const seekTo = useCallback((positionMs: number) => {
    QuranAudioEngine.seekTo(positionMs).catch(() => undefined);
  }, []);

  const selectRate = useCallback((index: number) => {
    rateIndexRef.current = index;
    setRateIndex(index);
    setShowSpeedMenu(false);
    setDragIndex(null);
    QuranAudioEngine.setRate(RATE_STEPS[index]).catch(() => undefined);
  }, []);

  // ── Speed menu drag interaction ───────────────────────────────────────────
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  const ITEM_HEIGHT = 44;

  const speedPanResponder = useRef(
    PanResponder.create({
      // Don't capture on initial touch — let TouchableOpacity handle taps
      onStartShouldSetPanResponder: () => false,
      // Capture only when the finger actually drags (> 4px)
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 4,
      onPanResponderGrant: (evt) => {
        isDraggingRef.current = true;
        const touchY = evt.nativeEvent.locationY;
        const idx = Math.min(
          RATE_STEPS.length - 1,
          Math.max(0, Math.floor(touchY / ITEM_HEIGHT)),
        );
        dragIndexRef.current = idx;
        setDragIndex(idx);
        Haptics.selectionAsync();
      },
      onPanResponderMove: (evt) => {
        const touchY = evt.nativeEvent.locationY;
        const idx = Math.min(
          RATE_STEPS.length - 1,
          Math.max(0, Math.floor(touchY / ITEM_HEIGHT)),
        );
        if (idx !== dragIndexRef.current) {
          dragIndexRef.current = idx;
          setDragIndex(idx);
          Haptics.selectionAsync();
        }
      },
      onPanResponderRelease: () => {
        const idx = dragIndexRef.current;
        if (isDraggingRef.current && idx !== null && idx >= 0 && idx < RATE_STEPS.length) {
          rateIndexRef.current = idx;
          setRateIndex(idx);
          QuranAudioEngine.setRate(RATE_STEPS[idx]).catch(() => undefined);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setShowSpeedMenu(false);
        }
        dragIndexRef.current = null;
        setDragIndex(null);
        isDraggingRef.current = false;
      },
      onPanResponderTerminate: () => {
        dragIndexRef.current = null;
        setDragIndex(null);
        isDraggingRef.current = false;
      },
    }),
  ).current;

  // ── Load and play from a specific verse ────────────────────────────────────
  //
  // Fetches timings and audio URI in parallel, seeks to the start verse, then
  // plays. If stopAtVerseKey is provided, pauses when that verse's end timestamp
  // is reached (implementing "Till sidans slut" / "Till surans slut").
  const loadAndPlayFromVerse = useCallback(
    async (surahId: number, startVerseKey: string, stopAtVerseKey: string | null, continuous?: boolean) => {
      if (!mountedRef.current) return;

      // Verse-loop fast path (Step 4): if "repeat verse" is on AND this is a
      // plain "play this verse" request (no stop-at, not continuous, not
      // bismillah), hand off to engine.loadAndLoopVerse for single-ayah loop.
      const rsForLoop = repeatSettingsRef.current;
      const verseIdMatch = startVerseKey.match(/^(\d+):(\d+)$/);
      if (
        rsForLoop.repeatVerse &&
        !continuous &&
        stopAtVerseKey === null &&
        verseIdMatch &&
        parseInt(verseIdMatch[1], 10) === surahId &&
        !bypassVerseLoopRoutingRef.current
      ) {
        const verseId = parseInt(verseIdMatch[2], 10);
        const surahMeta = SURAH_INDEX.find((s) => s.id === surahId);
        const targetPage = surahMeta?.firstPage ?? 1;
        await loadAndLoopVerseRef.current?.(surahId, verseId, rsForLoop.repeatVerseCount, targetPage);
        return;
      }

      ++loadGenerationRef.current;
      pauseYoutubePlayer();
      clearUserPageOverride();
      currentSurahIdRef.current = surahId;

      QuranAudioEngine.setReciter(settings.reciterId);
      // Use the ref instead of the closure-captured state so callers like
      // handleUpdateRepeatSettings can update repeatSettingsRef.current before
      // calling loadAndPlayFromVerse and have the engine receive the new value.
      // The state value (repeatSettings) may be stale when setRepeatSettings() +
      // loadAndPlayFromVerse() are called in the same synchronous event handler.
      QuranAudioEngine.setRepeatSettings(repeatSettingsRef.current);

      setPlaybackVerseRef.current(startVerseKey, currentPage);
      continuousPlayRef.current = continuous ?? false;

      try {
        await QuranAudioEngine.loadAndPlayFromVerse(surahId, startVerseKey, stopAtVerseKey, continuous);
      } catch (err) {
        if (mountedRef.current) {
          const msg = err instanceof Error ? err.message : 'Kunde inte ladda ljud';
          setPlayerState({ mode: 'error', surahId, message: msg.includes('cancel') ? 'Kunde inte ladda ljud' : msg });
        }
      }
    },
    [settings.reciterId, repeatSettings, currentPage, clearUserPageOverride],
  );
  // Assign ref here, after the useCallback — assigning it before the declaration
  // (line ~843) would set it to undefined on every render due to const hoisting.
  loadAndPlayFromVerseRef.current = loadAndPlayFromVerse;

  // ── Verse-loop mode ─────────────────────────────────────────────────────────
  //
  // Loads a single ayah audio file as the player source and (for infinite
  // repeat) hands the loop to AVPlayer's native `loop = true` — iOS rewinds
  // and replays inside the audio engine without ever emitting JS callbacks
  // or letting the audio session go silent. This is what makes verse-repeat
  // survive a locked screen for hours; the previous implementation did
  // chapter-file + JS-driven `seekTo + play()` mid-track every loop, which
  // iOS suspended after ~5 cycles in the background.
  //
  // When the per-verse URL cannot be resolved we DO NOT silently fall back to
  // chapter-mode timestamp seek — that path is the exact 4–5-repeat-and-die
  // bug reported on locked screens. Instead we hard-disable repeatVerse in
  // settings, surface a clear Swedish notification, and resume normal chapter
  // playback. Per-verse audio is the only background-stable path; if it's
  // unavailable for the current reciter the user is told so and can pick a
  // different reciter.
  const loadAndLoopVerse = useCallback(
    async (surahId: number, verseId: number, count: number | null, pageNumber: number) => {
      if (!mountedRef.current) return;
      ++loadGenerationRef.current;
      pauseYoutubePlayer();
      clearUserPageOverride();
      currentSurahIdRef.current = surahId;

      QuranAudioEngine.setReciter(settings.reciterId);
      QuranAudioEngine.setRepeatSettings(repeatSettings);

      const verseKey = verseId === 0 ? `BSMLLH_${surahId}` : `${surahId}:${verseId}`;
      // Immediate highlight hint — engine snapshot will overwrite within ~250 ms
      // via the foreground polling, but this avoids a brief flash of the wrong
      // (or no) verse highlight.
      setPlaybackVerseRef.current(verseKey, pageNumber);

      verseLoopActiveRef.current = {
        surahId,
        verseId,
        verseKey,
        count,
        plays: 1,
        pageNumber,
      };

      try {
        await QuranAudioEngine.loadAndLoopVerse(surahId, verseId, count);
        // Engine drives all snapshot updates from here.
      } catch (err) {
        // Engine throws VerseUrlUnavailableError when the per-verse CDN URL
        // cannot be resolved for this reciter. Disable repeatVerse + fall
        // back to chapter playback (preserves existing UX). The chapter-mode
        // mid-track-seek loop path is gone — engine never offers it because
        // it was the buggy path that this migration is replacing.
        if (!(err instanceof VerseUrlUnavailableError)) {
          // Unknown engine error — surface generic state and let the user retry.
          if (mountedRef.current) {
            setPlayerState({ mode: 'error', surahId, message: 'Kunde inte ladda ljud' });
          }
          return;
        }

        const reciterId = err.reciterId;
        verseLoopUnavailableReciterRef.current.add(reciterId);

        // Disable repeatVerse synchronously in the ref so the resume call below
        // doesn't tail-recurse straight back into loadAndLoopVerse via
        // loadAndPlayFromVerse's verse-loop routing branch (setRepeatSettings is
        // async — the ref mirror only catches up after the next render).
        repeatSettingsRef.current = {
          ...repeatSettingsRef.current,
          repeatVerse: false,
        };
        setRepeatSettings((prev) =>
          prev.repeatVerse ? { ...prev, repeatVerse: false } : prev,
        );
        bypassVerseLoopRoutingRef.current = true;

        const reciterName = RECITERS.find((r) => r.id === reciterId)?.name ?? '';
        showNotificationRef.current?.(
          'Vers-upprepning ej tillgänglig',
          reciterName
            ? `${reciterName} stöder inte stabil vers-upprepning. Välj en annan recitatör.`
            : 'Den valda recitatören stöder inte stabil vers-upprepning. Välj en annan recitatör.',
        );

        // Resume normal chapter playback at the same verse so the user is not
        // stranded on a torn-down player. loadAndPlay/loadAndPlayFromVerse
        // route through the engine internally (Step 2/Step 5).
        try {
          if (verseId === 0) {
            await loadAndPlayRef.current?.(surahId);
          } else {
            await loadAndPlayFromVerseRef.current?.(surahId, verseKey, null);
          }
        } finally {
          bypassVerseLoopRoutingRef.current = false;
        }
      }
    },
    [settings.reciterId, repeatSettings, clearUserPageOverride],
  );
  const loadAndLoopVerseRef = useRef(loadAndLoopVerse);
  loadAndLoopVerseRef.current = loadAndLoopVerse;

  useEffect(() => {
    audioCommandsRef.current = { loadAndPlay, loadAndPlayFromVerse, pause, resume, stop };
    return () => { audioCommandsRef.current = null; };
  }, [audioCommandsRef, loadAndPlay, loadAndPlayFromVerse, pause, resume, stop]);

  // ── Reciter change during active playback ──────────────────────────────────
  // When the user picks a new reciter while audio is playing/loading/downloading,
  // tear down the current player and restart the same surah with the new reciter.
  // currentSurahIdRef is always fresh (ref, not state) so no stale-closure risk.
  const prevReciterIdRef = useRef(settings.reciterId);
  useEffect(() => {
    if (settings.reciterId === prevReciterIdRef.current) return;
    prevReciterIdRef.current = settings.reciterId;

    const surahId = currentSurahIdRef.current;
    if (surahId === null) return; // nothing active — no restart needed

    // If verse-loop is active, restart it with the new reciter — otherwise
    // the user would lose their loop and drop into chapter playback.
    const vl = verseLoopActiveRef.current;
    if (vl !== null) {
      loadAndLoopVerse(vl.surahId, vl.verseId, vl.count, vl.pageNumber);
      return;
    }

    // Resume from the active verse if one exists; otherwise restart surah from beginning.
    const verseKey = activeVerseKeyRef.current;
    if (verseKey) {
      loadAndPlayFromVerse(surahId, verseKey, null);
    } else {
      loadAndPlay(surahId);
    }
  }, [settings.reciterId, loadAndPlay, loadAndPlayFromVerse, loadAndLoopVerse]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const isIdle = playerState.mode === 'hidden';
  const displaySurahId = isIdle ? currentSurahId : playerState.surahId;
  const surahName = SURAH_INDEX.find((s) => s.id === displaySurahId)?.nameSimple ?? '';
  const reciterName = RECITERS.find((r) => r.id === settings.reciterId)?.name ?? '';
  const isPlaying = playerState.mode === 'playing';
  const isLoading = playerState.mode === 'loading';
  const isDownloading = playerState.mode === 'downloading';
  const downloadProgress = isDownloading ? playerState.progress : 0;
  const positionMs =
    playerState.mode === 'playing' || playerState.mode === 'paused'
      ? playerState.positionMs
      : playerState.mode === 'loading' ? (playerState.positionMs ?? 0) : 0;
  const durationMs =
    playerState.mode === 'playing' || playerState.mode === 'paused'
      ? playerState.durationMs
      : playerState.mode === 'loading' ? (playerState.durationMs ?? 0) : 0;
  const progress = durationMs > 0 ? positionMs / durationMs : 0;

  const parsedVerse = parseVerseKey(activeVerseKey);
  const verseLabel = parsedVerse
    ? `${parsedVerse.surahName}: ${parsedVerse.verseNum}`
    : surahName;

  const elapsedStr = formatMs(positionMs);
  const remainingStr = durationMs > 0 ? `-${formatMs(durationMs - positionMs)}` : '-0:00';
  const rateLabel = `${RATE_STEPS[rateIndex]}×`;

  // Any repeat mode active (for icon highlight)
  const isRepeatActive = repeatSettings.repeatInterval || repeatSettings.repeatVerse;

  // Handlers for repeat settings modal
  const handleOpenRepeatModal = useCallback(() => {
    // Only set defaults if no interval has been configured yet (both toggles off).
    setRepeatSettings((prev) => {
      if (prev.repeatInterval || prev.repeatVerse) return prev; // keep existing settings
      const surah = SURAH_INDEX.find((s) => s.id === currentSurahId);
      return {
        ...prev,
        fromSurahId: currentSurahId,
        fromVerse: 1,
        toSurahId: currentSurahId,
        toVerse: surah?.versesCount ?? prev.toVerse,
      };
    });
    setShowRepeatModal(true);
  }, [currentSurahId]);

  const handleCloseRepeatModal = useCallback(() => {
    setShowRepeatModal(false);
  }, []);

  const handleUpdateRepeatSettings = useCallback((newSettings: RepeatSettings) => {
    const prev = repeatSettingsRef.current;

    // ── Verse-loop transitions ────────────────────────────────────────────
    // The chapter-file verse-repeat path (legacy seek+play in
    // onPlaybackStatusUpdate) ran into iOS suspending the audio session
    // after ~5 mid-track seeks on a locked screen. The new path swaps the
    // player source to a single-verse audio file so iOS can loop it via
    // AVPlayer.loop (infinite count) or via a clean end-of-file rewind
    // (finite count) — both forms of which iOS treats as well-behaved
    // background audio.
    const verseLoopActive = verseLoopActiveRef.current !== null;
    const activeSurahIdNow = currentSurahIdRef.current;
    const activeVerse = activeVerseKeyRef.current;

    // Enter verse-loop: toggle was off, is now on, and we have an active verse.
    if (
      !prev.repeatVerse &&
      newSettings.repeatVerse &&
      activeSurahIdNow !== null &&
      activeVerse
    ) {
      let surahId: number;
      let verseId: number;
      if (activeVerse.startsWith('BSMLLH_')) {
        surahId = parseInt(activeVerse.split('_')[1], 10);
        verseId = 0; // sentinel for bismillah
      } else {
        const parts = activeVerse.split(':').map(Number);
        surahId = parts[0];
        verseId = parts[1];
      }
      // currentPage is captured via closure (deps include it). For a
      // bismillah loop, the bismillah belongs to this surah's first page.
      const firstPage = SURAH_INDEX.find((s) => s.id === surahId)?.firstPage ?? currentPage;
      const targetPage = verseId === 0 ? firstPage : currentPage;
      loadAndLoopVerseRef.current?.(surahId, verseId, newSettings.repeatVerseCount, targetPage);
    }

    // Exit verse-loop: toggle was on (and active), is now off — resume
    // chapter playback at the same verse so the user can continue listening
    // from where they were rather than starting over.
    if (prev.repeatVerse && !newSettings.repeatVerse && verseLoopActive) {
      const vl = verseLoopActiveRef.current!;
      verseLoopActiveRef.current = null;
      if (vl.verseId === 0) {
        loadAndPlayRef.current?.(vl.surahId);
      } else {
        loadAndPlayFromVerseRef.current?.(vl.surahId, vl.verseKey, null);
      }
    }

    // Count changed while already in verse-loop: re-enter so the new
    // AVPlayer.loop flag is applied (toggling between native infinite loop
    // and finite-count didJustFinish handling requires recreating the
    // player with the new flag).
    if (
      prev.repeatVerse &&
      newSettings.repeatVerse &&
      verseLoopActive &&
      prev.repeatVerseCount !== newSettings.repeatVerseCount
    ) {
      const vl = verseLoopActiveRef.current!;
      loadAndLoopVerseRef.current?.(vl.surahId, vl.verseId, newSettings.repeatVerseCount, vl.pageNumber);
    }

    // Cross-surah "Till" without interval repeat:
    // When the user picks a "Till" verse in a future surah and repeatInterval is
    // off, activate pendingStopVerseKeyRef so the existing "Spela till" mechanism
    // in didJustFinish advances through intermediate surahs and stops at the
    // target verse — exactly the same path as the verse-menu "Spela till" action.
    //
    // When repeatInterval is ON, that mechanism handles advancement instead —
    // pendingStopVerseKeyRef must be cleared so it doesn't interfere.
    const activeSurahId = currentSurahIdRef.current ?? 0;
    if (!newSettings.repeatInterval && newSettings.toSurahId > activeSurahId) {
      pendingStopVerseKeyRef.current = `${newSettings.toSurahId}:${newSettings.toVerse}`;
    } else {
      // repeatInterval handles the advance, or "Till" is not ahead of current surah.
      pendingStopVerseKeyRef.current = null;
    }

    // Update the ref synchronously BEFORE setRepeatSettings schedules its async
    // state update. loadAndPlayFromVerse (called below) reads repeatSettingsRef
    // to push settings to the engine. If we only call setRepeatSettings here,
    // the ref still holds the OLD value when loadAndPlayFromVerse runs (React
    // state updates are batched; the useEffect that syncs the ref fires after
    // the next render, too late). Without this, the engine receives the old
    // settings (repeatInterval: false) and does not set up _intervalLoop,
    // causing the repeat range to be ignored on the first play after enabling.
    repeatSettingsRef.current = newSettings;
    setRepeatSettings(newSettings);

    // Interval repeat turned OFF mid-playback: cancel the active loop immediately
    // so the surah continues to its natural end instead of looping.
    if (prev.repeatInterval && !newSettings.repeatInterval) {
      QuranAudioEngine.cancelIntervalRepeat();
    }

    // When interval repeat is newly enabled or the interval range changes while
    // active, restart playback from the from-verse so the engine picks up the
    // new settings. Three triggers:
    //   1. intervalNewlyEnabled: toggle was OFF → ON.
    //   2. fromPositionChanged:  fromSurahId or fromVerse changed.
    //   3. toPositionChanged:    toSurahId or toVerse changed.
    //
    // Case 3 is critical: when the user toggles ON (which fires an immediate
    // restart with the default toVerse = surah.versesCount and canUseNativeLoop
    // = true → RepeatMode.Track, no _intervalLoop), then picks a toVerse < last
    // (e.g. verse 5), the engine must restart with the new range. Without this,
    // the engine stays in native-loop-full-surah mode and never monitors the
    // verse-5 boundary, so interval repeat appears to do nothing on the first try.
    const intervalNewlyEnabled = !prev.repeatInterval && newSettings.repeatInterval;
    const fromPositionChanged =
      newSettings.repeatInterval &&
      (prev.fromSurahId !== newSettings.fromSurahId || prev.fromVerse !== newSettings.fromVerse);
    const toPositionChanged =
      newSettings.repeatInterval &&
      (prev.toSurahId !== newSettings.toSurahId || prev.toVerse !== newSettings.toVerse);

    if ((intervalNewlyEnabled || fromPositionChanged || toPositionChanged) && currentSurahIdRef.current !== null) {
      const fromKey = `${newSettings.fromSurahId}:${newSettings.fromVerse}`;
      loadAndPlayFromVerseRef.current?.(newSettings.fromSurahId, fromKey, null);
    }
  }, [currentPage]);

  // ── Seek bar handlers ──────────────────────────────────────────────────────

  const handleSeekBarPress = useCallback(
    (e: GestureResponderEvent) => {
      if (durationMs <= 0) return;
      const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / seekBarWidth));
      seekTo(Math.round(ratio * durationMs));
    },
    [seekBarWidth, durationMs, seekTo],
  );

  const handleSeekBarLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      if (w > 0) setSeekBarWidth(w);
    },
    [],
  );

  // ── Page-based play handler ────────────────────────────────────────────────
  //
  // Plays from the first verse on `currentPage`, continuing to end of surah.
  // Starts playback at the highlighted verse (if any) or the first verse on the page.
  // activeVerseKeyRef is read instead of the closure value to avoid stale-capture
  // bugs in this async callback (CLAUDE.md: refs for async access).
  const loadAndPlayFromPage = useCallback(async () => {
    const surahId = currentSurahId;
    if (!mountedRef.current) return;

    // If a highlighted verse exists, start from it immediately using its own
    // surahId — before any async work so no try-catch can swallow the intent.
    // We intentionally use the verse's surahId (not currentSurahId) because
    // on pages with multiple surahs (e.g. page 604: 112/113/114), currentSurahId
    // may resolve to a different surah than the one the user navigated to.
    const activeVerse = activeVerseKeyRef.current;
    const highlightedSurahId = activeVerse
      ? parseInt(activeVerse.split(':')[0], 10)
      : NaN;
    if (!isNaN(highlightedSurahId)) {
      await loadAndPlayFromVerse(highlightedSurahId, activeVerse!, null);
      return;
    }

    // Fallback: find the first verse on the current page.
    try {
      const timings = await fetchVerseTimings(settings.reciterId, surahId);
      if (!mountedRef.current) return;
      const firstOnPage = timings.find((t) => t.pageNumber === currentPage);
      if (firstOnPage) {
        await loadAndPlayFromVerse(surahId, firstOnPage.verseKey, null);
      } else {
        await loadAndPlay(surahId);
      }
    } catch {
      if (!mountedRef.current) return;
      await loadAndPlay(surahId);
    }
  }, [currentSurahId, currentPage, settings.reciterId, loadAndPlay, loadAndPlayFromVerse]);

  // ── Off-screen / modal-covered: hide UI but keep audio engine running ───
  // The hooks above continue to execute (status listener, repeat logic, lock
  // screen integration), so playback survives navigation away from /quran or
  // opening a Quran modal. When the user returns / closes the modal, the UI
  // re-renders with current state.
  if (!showPlayerUi) {
    return null;
  }

  // ── Idle mode — compact bar ────────────────────────────────────────────────

  if (isIdle) {
    return (
      <Animated.View
        style={[styles.idleChipContainer, { left: landscapeInset, right: landscapeInset, opacity: chromeAnim }]}
        pointerEvents={chromeVisible ? 'auto' : 'none'}
      >
        {/* Shadow wrapper — overflow:visible so shadow renders outside */}
        <View style={styles.idleChipShadow}>
          {/* Clip wrapper — rounded corners + BlurView */}
          <View style={[
            styles.idleChip,
            isDark && { borderColor: 'rgba(0,255,150,0.10)' },
            !isDark && { borderColor: T.border },
          ]}>
            <BlurView
              intensity={isDark ? 72 : 90}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(15,31,26,0.88)' : 'rgba(252,252,255,0.72)' },
            ]} />
            <View style={styles.idleInfoZone}>
              <Text style={[styles.idleSurahName, { color: isDark ? '#FFFFFF' : T.text }]} numberOfLines={1}>
                {surahName}
              </Text>
              <TouchableOpacity
                style={styles.idleReciterRow}
                onPress={openReciterSelector}
                activeOpacity={0.8}
              >
                <Text style={[styles.idleReciterText, { color: isDark ? 'rgba(255,255,255,0.55)' : T.textMuted }]} numberOfLines={1}>
                  {reciterName}
                </Text>
                <SvgIcon name="chevron-down" size={11} color={isDark ? 'rgba(255,255,255,0.55)' : T.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={[styles.idleChipDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : T.border }]} />
            <TouchableOpacity
              style={[styles.idlePlayBtn, { backgroundColor: T.accent }]}
              onPress={loadAndPlayFromPage}
              activeOpacity={0.8}
            >
              <SvgIcon name="play" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    );
  }

  // ── Active mode — full Ayah-style card ────────────────────────────────────

  return (
    <Animated.View
      pointerEvents={chromeVisible ? 'auto' : 'none'}
      style={[
        styles.container,
        styles.containerActive,
        { left: landscapeInset, right: landscapeInset, opacity: chromeAnim },
        isDark && {
          shadowColor: 'rgba(0,255,150,0.06)',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 1,
          shadowRadius: 8,
          elevation: 8,
        },
      ]}
    >
      {/* Speed menu rendered OUTSIDE the clipping wrapper so it isn't clipped */}
      {showSpeedMenu && (
        <>
          <TouchableOpacity
            style={styles.speedMenuBackdrop}
            activeOpacity={1}
            onPress={() => { setShowSpeedMenu(false); setDragIndex(null); }}
          />
          <View
            style={[styles.speedMenu, {
              backgroundColor: isDark ? 'rgba(20,38,32,0.98)' : 'rgba(255,255,255,0.96)',
              borderColor: T.border,
            }]}
            {...speedPanResponder.panHandlers}
          >
            {RATE_STEPS.map((rate, i) => {
              const isActive = i === rateIndex;
              const isDragged = dragIndex === i;
              return (
                <TouchableOpacity
                  key={rate}
                  style={[
                    styles.speedMenuItem,
                    i < RATE_STEPS.length - 1 && [styles.speedMenuSep, { borderBottomColor: T.border }],
                    isDragged && { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' },
                  ]}
                  onPress={() => selectRate(i)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.speedMenuText, { color: T.text }]}>
                    {`${rate}×`}
                  </Text>
                  {isActive && !isDragged && dragIndex === null && (
                    <View style={[styles.speedMenuCheck, { backgroundColor: T.accent }]}>
                      <Text style={styles.speedMenuCheckText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* Clipping wrapper — keeps blur + content inside rounded corners */}
      <View style={[
        styles.containerClip,
        isDark && { borderWidth: 1, borderColor: 'rgba(0,255,150,0.10)' },
      ]}>
        <BlurView
          intensity={isDark ? 70 : 90}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? 'rgba(15,31,26,0.88)' : 'rgba(252,252,255,0.72)' },
          ]}
        />

        {/* Row 1: reciter selector + close */}
        <View style={styles.topRow}>
          {/* AirPlay / output device picker (iOS only) */}
          {Platform.OS === 'ios' ? (
            <TouchableOpacity
              style={styles.airplaySlot}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                showRoutePicker();
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <SvgIcon name="airplay" size={22} color={T.textMuted} />
            </TouchableOpacity>
          ) : (
            <View style={styles.airplaySlot} />
          )}
          <TouchableOpacity style={styles.reciterBtn} onPress={openReciterSelector} activeOpacity={0.8}>
            <Text style={[styles.reciterBtnText, { color: T.text }]} numberOfLines={1}>
              {reciterName}
            </Text>
            <SvgIcon name="chevron-down" size={13} color={T.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconSlot}
            onPress={stop}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <SvgIcon name="close" size={16} color={T.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Row 2: verse / surah label OR download progress */}
        {isDownloading ? (
          <View style={styles.downloadLabelRow}>
            <Text style={[styles.verseLabel, styles.downloadLabelStatic, { color: T.text }]}>
              Laddar ner...{' '}
            </Text>
            <Text style={[styles.verseLabel, styles.downloadLabelPct, { color: T.text }]}>
              {Math.round(downloadProgress * 100)}%
            </Text>
          </View>
        ) : (
          <Text style={[styles.verseLabel, { color: T.text }]} numberOfLines={1}>
            {verseLabel}
          </Text>
        )}

        {/* Row 3: seek bar OR download progress bar */}
        {isDownloading ? (
          <View style={styles.progressSection}>
            <View style={styles.downloadBarWrapper}>
              <View
                style={[
                  styles.seekTrack,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' },
                ]}
              >
                <View
                  style={[
                    styles.seekFill,
                    { backgroundColor: T.accent, width: `${downloadProgress * 100}%` },
                  ]}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.progressSection}>
            <Text style={[styles.timeText, { color: T.textMuted }]}>{elapsedStr}</Text>
            <TouchableOpacity
              activeOpacity={1}
              style={styles.seekBarTouchable}
              onPress={handleSeekBarPress}
              onLayout={handleSeekBarLayout}
            >
              <View
                style={[
                  styles.seekTrack,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' },
                ]}
              >
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    styles.seekFill,
                    { backgroundColor: T.accent, width: `${progress * 100}%` },
                  ]}
                />
                <View
                  style={[styles.seekThumb, { backgroundColor: T.accent, left: `${progress * 100}%` }]}
                />
              </View>
            </TouchableOpacity>
            <Text style={[styles.timeText, { color: T.textMuted }]}>{remainingStr}</Text>
          </View>
        )}

        {/* Row 4: controls */}
        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.sideBtn} onPress={() => setShowSpeedMenu((v) => !v)} activeOpacity={0.7}>
            <Text style={[styles.rateBtnText, { color: rateIndex === DEFAULT_RATE_INDEX ? T.textMuted : T.accent }]}>
              {rateLabel}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlBtn} onPress={() => skipVerse(-1)} activeOpacity={0.7}>
            <SvgIcon name="skip-back" size={22} color={T.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bigPlayBtn, { backgroundColor: T.accent }]}
            onPress={isDownloading ? undefined : isPlaying ? pause : resume}
            activeOpacity={isDownloading ? 1 : 0.8}
          >
            {isDownloading ? (
              <AnimatedDownloadIcon />
            ) : isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <SvgIcon name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlBtn} onPress={() => skipVerse(1)} activeOpacity={0.7}>
            <SvgIcon name="skip-fwd" size={22} color={T.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sideBtn}
            onPress={handleOpenRepeatModal}
            activeOpacity={0.7}
          >
            <SvgIcon name="repeat" size={20} color={isRepeatActive ? T.accent : T.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Repeat settings modal */}
      <RepeatSettingsModal
        visible={showRepeatModal}
        onClose={handleCloseRepeatModal}
        settings={repeatSettings}
        onUpdate={handleUpdateRepeatSettings}
        currentSurahId={currentSurahId}
      />
    </Animated.View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Idle chip — floats above the tab bar
  idleChipContainer: {
    position: 'absolute',
    bottom: PICKER_CLEARANCE,
    left: 12,
    right: 12,
    alignItems: 'center',
    zIndex: 145,
  },
  // Shadow wrapper — overflow:visible so shadow isn't clipped
  idleChipShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  idleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 5,
    paddingVertical: 5,
    gap: 8,
  },
  idleInfoZone: {
    maxWidth: 190,
    flexShrink: 1,
  },
  idleSurahName: {
    fontSize: 13,
    fontWeight: '600',
  },
  idleReciterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  idleReciterText: {
    fontSize: 11,
    fontWeight: '500',
  },
  idleChipDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
  },
  idlePlayBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  container: {
    position: 'absolute',
    bottom: PICKER_CLEARANCE,
    left: 12,
    right: 12,
    borderRadius: 16,
    overflow: 'visible',
    zIndex: 145,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  containerClip: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  containerActive: {},

  // Active mode
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  iconSlot: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  airplaySlot: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reciterBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  reciterBtnText: { fontSize: 13, fontWeight: '600' },
  verseLabel: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  downloadLabelRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  downloadLabelStatic: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  downloadLabelPct: {
    paddingHorizontal: 0,
    paddingBottom: 0,
    minWidth: 44,   // wide enough for "100%" — percentage slot never shrinks
    textAlign: 'left',
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 6,
  },
  timeText: {
    fontSize: 11,
    minWidth: 34,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  seekBarTouchable: {
    flex: 1,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  downloadBarWrapper: {
    flex: 1,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  seekTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'visible',
  },
  seekFill: {
    height: 3,
    borderRadius: 2,
  },
  seekThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    top: -4.5,
    marginLeft: -6,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  sideBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateBtnText: { fontSize: 13, fontWeight: '700' },
  speedMenuBackdrop: {
    position: 'absolute',
    bottom: -300,
    left: -500,
    right: -500,
    top: -500,
    zIndex: 9,
  },
  speedMenu: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: 8,
    zIndex: 10,
    width: 130,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  speedMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 44,
  },
  speedMenuSep: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  speedMenuText: {
    fontSize: 15,
    fontWeight: '500',
  },
  speedMenuCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedMenuCheckText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  bigPlayBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default memo(QuranAudioPlayer);
