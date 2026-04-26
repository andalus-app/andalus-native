/**
 * QuranAudioPlayer.tsx
 *
 * Ayah-style audio player using expo-audio (not the deprecated expo-av).
 * expo-audio provides proper background audio + lock screen controls via
 * player.setActiveForLockScreen() — this is what keeps audio alive when
 * the screen is locked.
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
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { Asset } from 'expo-asset';
import { BlurView } from 'expo-blur';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import { pauseYoutubePlayer } from '../../context/YoutubePlayerContext';
import {
  getAudioUri,
  downloadSurahAudio,
  ensureAudioDir,
  isSurahDownloaded,
  getBismillahAudioUri,
  isBismillahDownloaded,
  RECITERS,
  DownloadCancelledError,
} from '../../services/quranAudioService';
import {
  fetchVerseTimings,
  findCurrentVerse,
  type VerseTimestamp,
} from '../../services/mushafTimingService';
import { SURAH_INDEX } from '../../data/surahIndex';
import RepeatSettingsModal, { type RepeatSettings } from './RepeatSettingsModal';
import { showRoutePicker } from 'airplay-route-picker';

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

// ── Lock-screen artwork ────────────────────────────────────────────────────────
//
// The iOS Now Playing widget requires artwork to show the player prominently on
// the lock screen. We use the app icon (bundled asset) as the artwork image.
//
// expo-asset resolves the require() to a local file:// URI after downloading
// the asset from the JS bundle cache. URLSession on the Swift side can load
// file:// URIs via dataTask, so this works without any extra native code.
//
// Module-level cache: resolved once per app session, shared across all players.
// If resolution fails (e.g., simulator file-system edge case), artworkUrl stays
// null and the lock screen shows with a gray placeholder instead of crashing.
//
let _artworkUri: string | null = null;
let _artworkResolving = false;
let _artworkCallbacks: Array<(uri: string | null) => void> = [];

function resolveArtworkUri(): Promise<string | null> {
  if (_artworkUri !== null) return Promise.resolve(_artworkUri);
  return new Promise((resolve) => {
    _artworkCallbacks.push(resolve);
    if (_artworkResolving) return; // already in progress — just enqueue the callback
    _artworkResolving = true;
    (async () => {
      try {
        const asset = Asset.fromModule(
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../assets/images/icon.png'),
        );
        await asset.downloadAsync();
        _artworkUri = asset.localUri ?? null;
      } catch {
        _artworkUri = null;
      }
      const uri = _artworkUri;
      const cbs = _artworkCallbacks.splice(0);
      _artworkResolving = false;
      cbs.forEach((cb) => cb(uri));
    })();
  });
}

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
    activeVerseKey,
  } = useQuranContext();

  const [playerState, setPlayerState] = useState<PlayerState>({ mode: 'hidden' });
  const [isRepeat, setIsRepeat] = useState(false);
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

  const playerRef = useRef<AudioPlayer | null>(null);
  const playerSubRef = useRef<{ remove: () => void } | null>(null);
  // Tracks the 750ms play-retry timer so teardown can cancel it explicitly.
  const startRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const currentSurahIdRef = useRef<number | null>(null);
  const isRepeatRef = useRef(isRepeat);
  isRepeatRef.current = isRepeat;
  const rateIndexRef = useRef(DEFAULT_RATE_INDEX);

  // Repeat settings refs — accessed inside the stable onPlaybackStatusUpdate callback.
  const repeatSettingsRef = useRef(repeatSettings);
  repeatSettingsRef.current = repeatSettings;

  // Tracks how many times the interval has looped so far.
  // 1 = the interval is playing for the first time (not yet looped).
  // Reset to 1 whenever repeatInterval is toggled on or a new interval starts.
  const intervalLoopCountRef = useRef(1);

  // Tracks per-verse repeat state: which verse is being looped and how many times it has played.
  // { key: verseKey, plays: number } — null when no verse repeat is active.
  const verseRepeatLoopRef = useRef<{ key: string; plays: number } | null>(null);

  // Set to true immediately after a verse-repeat seek is issued.
  // Blocks the verse-transition check on subsequent ticks until the seek
  // is confirmed (position is back inside lastVerseKeyRef's verse range),
  // preventing multiple rapid ticks from counting a single transition N times.
  const verseRepeatSeekingRef = useRef(false);

  // Set to true immediately after an interval-repeat seek is issued.
  // Prevents multiple async position ticks (fired before the seek takes effect)
  // from incrementing intervalLoopCountRef more than once per actual loop.
  // Cleared when positionMs drops back below toTiming.timestampTo.
  const intervalRepeatSeekingRef = useRef(false);

  // pendingPlay: true while the player is transitioning from created → first playing
  // status tick. Prevents a brief 'paused' flash on the UI during buffering.
  const pendingPlayRef = useRef(false);

  // true once the current player has reached 'playing' at least once.
  // Used to suppress the loading spinner during mid-playback rebuffering —
  // the button should always show play/pause after the first playing tick.
  const hasPlayedRef = useRef(false);

  // When loadAndPlayFromVerse sets a range, holds the stop timestamp in ms.
  // onPlaybackStatusUpdate pauses when positionMs >= this value.
  const stopAtTimestampRef = useRef<number | null>(null);

  // Cross-surah "Spela till" target — set when stopAtVerseKey belongs to a future surah.
  // Persists across intermediate loadAndPlay calls so each surah advance can check it.
  // Cleared by stop(), skipSurah(), and at the start of loadAndPlayFromVerse (new session).
  const pendingStopVerseKeyRef = useRef<string | null>(null);

  // continuous: true = "Spela vidare" mode — auto-advance through surahs on finish.
  // Ref-mirrored loadAndPlay so onPlaybackStatusUpdate can trigger it without
  // capturing a stale closure (onPlaybackStatusUpdate has empty deps).
  const continuousPlayRef = useRef(false);
  const loadAndPlayRef = useRef<((surahId: number) => void) | null>(null);
  const loadAndPlayFromVerseRef = useRef<((surahId: number, startVerseKey: string, stopAtVerseKey: string | null) => Promise<void>) | null>(null);

  // Verse sync refs
  const verseTimingsRef = useRef<VerseTimestamp[] | null>(null);
  const lastVerseKeyRef = useRef<string | null>(null);
  const setPlaybackVerseRef = useRef(setPlaybackVerse);
  setPlaybackVerseRef.current = setPlaybackVerse;

  // Mirror activeVerseKey in a ref so async callbacks always read the latest value.
  const activeVerseKeyRef = useRef(activeVerseKey);
  activeVerseKeyRef.current = activeVerseKey;

  // Bismillah lock: positionMs must reach this value before findCurrentVerse is
  // consulted. Prevents verse 1 from overriding BSMLLH_ at positionMs=0 (both
  // share timestampFrom=0 for some reciters; binary search returns verse 1 last).
  // Set to max(BSMLLH_.timestampTo, 3000) on surah start; 0 otherwise.
  const bismillahLockUntilMsRef = useRef<number>(0);

  // Player generation counter: incremented each time startPlayer creates a new
  // AudioPlayer instance. Each subscription captures its creation-time generation
  // value and silently drops any events where playerGenerationRef.current no longer
  // matches — this prevents stale Al-Fatiha events (queued in the JS bridge before
  // subscription.remove() was called) from corrupting the new surah player's state.
  const playerGenerationRef = useRef<number>(0);

  // Load generation counter: incremented at the start of every loadAndPlay /
  // loadAndPlayFromVerse call. Each async call captures its own generation value
  // and bails out after every await if the value has advanced — this prevents
  // stale async chains (e.g. from rapid next-surah taps) from reaching startPlayer
  // and creating multiple simultaneous AudioPlayer instances.
  const loadGenerationRef = useRef<number>(0);

  // Bismillah pre-play: QuranCDN audio files do NOT contain Bismillah.
  // We play Al-Fatiha's verse 1:1 (which IS the Bismillah) before the surah audio.
  // This timer fires after the Bismillah portion ends, swapping to surah audio.
  const bismillahTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the surah audio URI + timings to resume after Bismillah finishes.
  type BismillahPending = { uri: string; surahId: number; timings: VerseTimestamp[] | null };
  const bismillahPendingRef = useRef<BismillahPending | null>(null);

  // Cancel hook for an in-progress download — set by downloadSurahAudio, cleared on finish/cancel.
  const downloadCancelRef = useRef<(() => void) | null>(null);

  // Stable reciter/surah refs — used inside the status callback to avoid
  // re-creating the callback on every settings change.
  const reciterIdRef = useRef(settings.reciterId);
  reciterIdRef.current = settings.reciterId;

  // Stable ref for the playback status callback — allows startPlayer to
  // subscribe with a wrapper that never changes identity, avoiding the
  // forward-reference (TDZ) error that would occur if startPlayer listed
  // onPlaybackStatusUpdate in its dependency array while the callback is
  // declared later in the same component body.
  const onPlaybackStatusUpdateRef = useRef<((status: AudioStatus) => void) | null>(null);

  // file:// URI of the bundled app icon, used as lock-screen artwork.
  // Resolved once at mount via expo-asset; stays null until resolution completes.
  // All setActiveForLockScreen and updateLockScreenMetadata calls read this ref
  // so they always include the artwork URL (prevents Swift from clearing it when
  // metadata is partially overwritten by updateLockScreenMetadata).
  const artworkUriRef = useRef<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Tears down the current player instance. All state is in refs so no deps needed.
  const teardown = useCallback(() => {
    // Cancel any in-progress download immediately.
    downloadCancelRef.current?.();
    downloadCancelRef.current = null;

    pendingPlayRef.current = false;
    hasPlayedRef.current = false;
    intervalLoopCountRef.current = 1;
    verseRepeatLoopRef.current = null;
    verseRepeatSeekingRef.current = false;
    intervalRepeatSeekingRef.current = false;
    stopAtTimestampRef.current = null;
    bismillahLockUntilMsRef.current = 0;
    // Cancel the 750ms play-retry timer (startPlayer) if it's still pending.
    if (startRetryTimerRef.current) {
      clearTimeout(startRetryTimerRef.current);
      startRetryTimerRef.current = null;
    }
    // Cancel pending bismillah → surah transition
    if (bismillahTimerRef.current) {
      clearTimeout(bismillahTimerRef.current);
      bismillahTimerRef.current = null;
    }
    bismillahPendingRef.current = null;
    playerSubRef.current?.remove();
    playerSubRef.current = null;
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch {}
      try { playerRef.current.clearLockScreenControls(); } catch {}
      try { playerRef.current.remove(); } catch {}
      playerRef.current = null;
    }
    verseTimingsRef.current = null;
    lastVerseKeyRef.current = null;
    setPlaybackVerseRef.current(null, null);
  }, []);

  // Creates the audio player and starts playback from `startMs`.
  // Transitions state: downloading/loading → loading → playing (via status callback).
  const startPlayer = useCallback(
    async (uri: string, surahId: number, startMs: number) => {
      if (!mountedRef.current) return;
      setPlayerState({ mode: 'loading', surahId });

      // keepAudioSessionActive: true — prevents the iOS AVAudioSession from
      // being deactivated when this player is paused or destroyed. This is
      // critical during the bismillah → surah transition: the Al-Fatiha player
      // is paused/removed and a new surah player is immediately created. Without
      // this flag, pause() triggers deactivateSession(), which can kill the
      // background audio session before the new player's play() reactivates it.
      const player = createAudioPlayer({ uri }, { updateInterval: 250, keepAudioSessionActive: true });
      // Capture the generation at creation time. If playerGenerationRef.current has
      // advanced beyond this value when a status event fires, the event belongs to a
      // stale player (e.g. Al-Fatiha events queued in the JS bridge after its
      // subscription.remove() was called) and must be dropped silently.
      const myGeneration = ++playerGenerationRef.current;
      const subscription = player.addListener('playbackStatusUpdate', (s) => {
        if (playerGenerationRef.current !== myGeneration) return; // stale event — discard
        onPlaybackStatusUpdateRef.current?.(s);
      });

      if (!mountedRef.current) {
        subscription.remove();
        try { player.remove(); } catch {}
        return;
      }

      playerRef.current = player;
      playerSubRef.current = subscription;
      player.setPlaybackRate(RATE_STEPS[rateIndexRef.current]);

      if (startMs > 0) player.seekTo(startMs / 1000);

      pendingPlayRef.current = true;
      player.play();

      // Safety retry: on iOS, if a new player is created immediately after
      // destroying another (e.g. bismillah → surah transition), the audio session
      // may not be fully ready and play() is silently ignored. The first status
      // update arrives as 'paused', the pendingPlay guard returns early, and no
      // further updates arrive — leaving the UI stuck on the loading spinner.
      // Retrying play() after 750 ms covers this without affecting normal
      // playback (pendingPlayRef is cleared by isNowPlaying well before 750 ms).
      const retryTarget = player;
      if (startRetryTimerRef.current) clearTimeout(startRetryTimerRef.current);
      startRetryTimerRef.current = setTimeout(() => {
        startRetryTimerRef.current = null;
        if (!mountedRef.current) return;
        if (playerRef.current === retryTarget && pendingPlayRef.current) {
          retryTarget.play();
        }
      }, 750);

      const surahName = SURAH_INDEX.find((s) => s.id === surahId)?.nameSimple ?? '';
      const reciterName = RECITERS.find((r) => r.id === reciterIdRef.current)?.name ?? '';
      try {
        // Register the lock screen player IMMEDIATELY — before any async work.
        // Calling setActiveForLockScreen after an await (even a resolved Promise)
        // creates an event-loop gap where the player may have been replaced or
        // torn down, which would leave the lock screen never registered.
        player.setActiveForLockScreen(
          true,
          {
            title: surahName,
            artist: reciterName,
            artworkUrl: artworkUriRef.current ?? undefined, // use cached URI if already resolved
          },
        );
      } catch {}

      // Resolve artwork URI and update lock screen metadata once available.
      // This is a fire-and-forget update — lock screen is already registered above.
      resolveArtworkUri().then((iconUri) => {
        if (!mountedRef.current) return;
        if (playerRef.current !== player) return; // player was replaced — skip stale update
        artworkUriRef.current = iconUri;
        if (iconUri) {
          try {
            player.updateLockScreenMetadata({
              title: surahName,
              artist: reciterName,
              artworkUrl: iconUri,
            });
          } catch {}
        }
      }).catch(() => {});
    },
    [], // stable: uses onPlaybackStatusUpdateRef wrapper — no deps needed
  );

  // ── Audio mode setup ───────────────────────────────────────────────────────

  useEffect(() => {
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    }).catch(() => undefined);
  }, []);

  // Pre-warm the lock-screen artwork URI at mount.
  // resolveArtworkUri() is idempotent (module-level cache) — safe to call here
  // even though _layout.tsx may have already kicked off resolution.
  useEffect(() => {
    resolveArtworkUri().then((uri) => {
      artworkUriRef.current = uri;
    }).catch(() => {});
  }, []);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      playerSubRef.current?.remove();
      if (playerRef.current) {
        try { playerRef.current.pause(); } catch {}
        try { playerRef.current.clearLockScreenControls(); } catch {}
        try { playerRef.current.remove(); } catch {}
      }
    };
  }, []);

  // ── Playback status ────────────────────────────────────────────────────────
  // expo-audio times are in seconds; we convert to ms for internal consistency.

  const onPlaybackStatusUpdate = useCallback((status: AudioStatus) => {
    if (!mountedRef.current) return;
    const surahId = currentSurahIdRef.current;
    if (surahId === null) return;

    if (status.didJustFinish) {
      // Bismillah clip finished naturally (short verse-level audio).
      // Transition to surah immediately and cancel the safety timer.
      // If the timer already fired first, bismillahPendingRef is null — no-op.
      if (bismillahPendingRef.current !== null) {
        const pending = bismillahPendingRef.current;
        bismillahPendingRef.current = null;
        if (bismillahTimerRef.current) {
          clearTimeout(bismillahTimerRef.current);
          bismillahTimerRef.current = null;
        }
        _transitionBismillahToSurahRef.current?.(pending);
        return;
      }

      const rs = repeatSettingsRef.current;

      if (__DEV__) console.log('[QuranRepeat] didJustFinish surah=' + surahId
        + ' repeatInterval=' + rs.repeatInterval
        + ' from=' + rs.fromSurahId + ':' + rs.fromVerse
        + ' to=' + rs.toSurahId + ':' + rs.toVerse
        + ' pendingStop=' + pendingStopVerseKeyRef.current
        + ' continuous=' + continuousPlayRef.current
        + ' isRepeat=' + isRepeatRef.current);

      // ── Verse repeat — last verse of surah ───────────────────────────────
      // The verse-transition logic in the position callback never fires for the
      // last verse because there is no following verse to cross into. Handle it
      // here: if repeatVerse is on and the count hasn't been reached yet, seek
      // back to the last verse's start instead of finishing/advancing.
      if (rs.repeatVerse && lastVerseKeyRef.current !== null && verseTimingsRef.current) {
        const prevKey = lastVerseKeyRef.current;
        const prevVerseTiming = verseTimingsRef.current.find((t) => t.verseKey === prevKey);
        if (prevVerseTiming) {
          if (verseRepeatLoopRef.current?.key !== prevKey) {
            verseRepeatLoopRef.current = { key: prevKey, plays: 1 };
          } else {
            verseRepeatLoopRef.current.plays += 1;
          }
          const plays = verseRepeatLoopRef.current.plays;
          const shouldLoop = rs.repeatVerseCount === null || plays < rs.repeatVerseCount;
          if (shouldLoop) {
            verseRepeatSeekingRef.current = true;
            playerRef.current?.seekTo(prevVerseTiming.timestampFrom / 1000);
            playerRef.current?.play();
            return;
          }
          // Count reached — reset and fall through to normal surah-end handling.
          verseRepeatLoopRef.current = null;
          verseRepeatSeekingRef.current = false;
        }
      }

      // Interval repeat: advance through the interval or loop back to start.
      if (rs.repeatInterval) {
        const fromKey = `${rs.fromSurahId}:${rs.fromVerse}`;
        if (surahId < rs.fromSurahId) {
          // Current surah is before the interval — jump directly to the from-verse
          // instead of advancing one-by-one through all intermediate surahs.
          loadAndPlayFromVerseRef.current?.(rs.fromSurahId, fromKey, null);
        } else if (surahId < rs.toSurahId) {
          // Still inside the interval — advance to the next surah.
          loadAndPlayRef.current?.(surahId + 1);
        } else {
          // Reached (or passed) the end surah — check repeat count before looping.
          const canLoop = rs.repeatCount === null || intervalLoopCountRef.current < rs.repeatCount;
          if (canLoop) {
            intervalLoopCountRef.current += 1;
            if (rs.fromSurahId === surahId && verseTimingsRef.current) {
              // Single-surah interval — seek within the same audio.
              const fromTiming = verseTimingsRef.current.find((t) => t.verseKey === fromKey);
              const seekMs = fromTiming?.timestampFrom ?? 0;
              playerRef.current?.seekTo(seekMs / 1000);
              playerRef.current?.play();
            } else {
              loadAndPlayFromVerseRef.current?.(rs.fromSurahId, fromKey, null);
            }
          }
          // canLoop === false: fall through to normal finish (pauses at end)
        }
        return;
      }

      if (isRepeatRef.current) {
        playerRef.current?.seekTo(0);
        playerRef.current?.play();
        return;
      }

      // Continuous mode ("Spela vidare"): auto-advance to the next surah.
      if (continuousPlayRef.current) {
        const nextSurahId = surahId + 1;
        if (nextSurahId <= 114) {
          // continuousPlayRef stays true — loadAndPlayRef does not touch it.
          loadAndPlayRef.current?.(nextSurahId);
          return;
        }
        // Reached end of the Quran — fall through to normal paused handling.
        continuousPlayRef.current = false;
      }

      // Cross-surah "Spela till" advance — fired when the user chose a stop surah
      // from the action menu (e.g. "Spela till Al-Imran"). pendingStopVerseKeyRef
      // carries the target across intermediate loadAndPlay calls (teardown does NOT
      // clear it, only stop/skipSurah/loadAndPlayFromVerse do).
      const pendingStop = pendingStopVerseKeyRef.current;
      if (pendingStop) {
        const stopSurahId = parseInt(pendingStop.split(':')[0], 10);
        const nextSurahId = surahId + 1;
        if (__DEV__) console.log('[CrossSurah] didJustFinish surah=' + surahId + ' nextSurah=' + nextSurahId + ' stopSurah=' + stopSurahId + ' pendingStop=' + pendingStop + ' lafvRef=' + (loadAndPlayFromVerseRef.current !== null ? 'SET' : 'NULL') + ' lapRef=' + (loadAndPlayRef.current !== null ? 'SET' : 'NULL'));
        if (!isNaN(stopSurahId) && nextSurahId <= stopSurahId && nextSurahId <= 114) {
          if (nextSurahId === stopSurahId) {
            // Reached the target surah — start with bismillah and apply stop timestamp.
            // loadAndPlayFromVerse resets pendingStopVerseKeyRef at its start and then
            // correctly looks up the stop timestamp in the target surah's timings.
            pendingStopVerseKeyRef.current = null;
            if (__DEV__) console.log('[CrossSurah] calling LAFV for surah=' + stopSurahId + ' stop=' + pendingStop);
            loadAndPlayFromVerseRef.current?.(stopSurahId, `BSMLLH_${stopSurahId}`, pendingStop);
          } else {
            // Intermediate surah — advance normally; bismillah is handled by loadAndPlay.
            // pendingStopVerseKeyRef is NOT cleared here so the next didJustFinish sees it.
            if (__DEV__) console.log('[CrossSurah] calling loadAndPlay for intermediate surah=' + nextSurahId);
            loadAndPlayRef.current?.(nextSurahId);
          }
          return;
        }
        // Past target (shouldn't happen) — clean up.
        pendingStopVerseKeyRef.current = null;
      }

      // Normal finish: clear active verse, pause, and seek to 0 so the play
      // button works correctly on resume (player was at end-of-file, not start).
      pendingPlayRef.current = false;
      stopAtTimestampRef.current = null;
      lastVerseKeyRef.current = null;
      setPlaybackVerseRef.current(null, null);
      try { playerRef.current?.clearLockScreenControls(); } catch {}
      const durationMs = (playerRef.current?.duration ?? 0) * 1000;
      try { playerRef.current?.seekTo(0); } catch {}
      setPlayerState({ mode: 'paused', surahId, positionMs: 0, durationMs });
      return;
    }

    const isNowPlaying = status.timeControlStatus === 'playing';
    const isBuffering  = status.timeControlStatus === 'waitingToPlayAtSpecifiedRate';

    // During bismillah pre-play, the player is running Al-Fatiha audio (not the
    // target surah). Suppress position/duration updates to avoid showing Al-Fatiha's
    // seek bar. Show 'playing' with 0/0 so the UI knows audio is active.
    if (bismillahPendingRef.current !== null) {
      if (isNowPlaying) {
        pendingPlayRef.current = false;
        setPlayerState({ mode: 'playing', surahId, positionMs: 0, durationMs: 0 });
      }
      return;
    }

    // Any buffering update → show loading and return, regardless of pendingPlay.
    // Large surahs (Al-Baqarah etc.) send many 'waitingToPlayAtSpecifiedRate'
    // updates over several seconds. The previous fix only handled the FIRST one
    // (inside the pendingPlay guard); subsequent ones fell through to
    // setPlayerState({ mode: 'paused', positionMs: 0 }), showing a broken UI.
    if (isBuffering) {
      pendingPlayRef.current = false;
      // Preserve last-known position so the seek thumb doesn't jump to 0
      // during a mid-playback rebuffer event.
      setPlayerState((prev) => ({
        mode: 'loading',
        surahId,
        positionMs: (prev.mode === 'playing' || prev.mode === 'paused') ? prev.positionMs : undefined,
        durationMs: (prev.mode === 'playing' || prev.mode === 'paused') ? prev.durationMs : undefined,
      }));
      return;
    }

    // During initial play request, ignore transient 'paused' status callbacks
    // that arrive before expo-audio has finished its setup.
    if (pendingPlayRef.current && !isNowPlaying) {
      return;
    }

    if (isNowPlaying) {
      pendingPlayRef.current = false;
      hasPlayedRef.current = true;
    }

    const positionMs = (status.currentTime ?? 0) * 1000;
    const durationMs = (playerRef.current?.duration ?? 0) * 1000;

    // ── Stop-at range check ────────────────────────────────────────────────
    // loadAndPlayFromVerse may set a stop timestamp for "Till sidans/surans slut".
    // Pause and clear active verse when the position reaches that timestamp.
    if (isNowPlaying && stopAtTimestampRef.current !== null && positionMs >= stopAtTimestampRef.current) {
      stopAtTimestampRef.current = null;
      pendingPlayRef.current = false;
      lastVerseKeyRef.current = null;
      setPlaybackVerseRef.current(null, null);
      playerRef.current?.pause();
      setPlayerState({ mode: 'paused', surahId, positionMs, durationMs });
      return;
    }

    // ── Repeat interval boundary check ───────────────────────────────────
    // If repeat interval is active and we've passed the "to" verse, seek back to "from".
    const rs = repeatSettingsRef.current;
    if (isNowPlaying && rs.repeatInterval && verseTimingsRef.current && surahId === rs.toSurahId) {
      const toKey = `${rs.toSurahId}:${rs.toVerse}`;
      const toTiming = verseTimingsRef.current.find((t) => t.verseKey === toKey);
      if (toTiming) {
        // Guard: if a seek-back is already in flight, wait until position drops
        // below timestampTo before allowing another increment. This prevents
        // multiple async position ticks (before the seek lands) from each
        // incrementing intervalLoopCountRef and burning through the repeat count.
        if (intervalRepeatSeekingRef.current) {
          if (positionMs < toTiming.timestampTo) {
            intervalRepeatSeekingRef.current = false; // seek confirmed
          }
          // Skip loop logic on this tick regardless — seek is still in flight.
        } else if (positionMs >= toTiming.timestampTo) {
          const canLoop = rs.repeatCount === null || intervalLoopCountRef.current < rs.repeatCount;
          if (canLoop) {
            intervalLoopCountRef.current += 1;
            intervalRepeatSeekingRef.current = true;
            const fromKey = `${rs.fromSurahId}:${rs.fromVerse}`;
            if (rs.fromSurahId === surahId) {
              // Same surah — seek to from-verse timestamp.
              const fromTiming = verseTimingsRef.current.find((t) => t.verseKey === fromKey);
              const seekMs = fromTiming?.timestampFrom ?? 0;
              playerRef.current?.seekTo(seekMs / 1000);
            } else {
              // Cross-surah — load the from-surah and start at from-verse.
              intervalRepeatSeekingRef.current = false; // new player instance clears state
              loadAndPlayFromVerseRef.current?.(rs.fromSurahId, fromKey, null);
            }
            return;
          }
          // canLoop === false (count exhausted): stop at the to-verse boundary.
          // Do NOT let the audio play past — seek back to the to-verse start and pause.
          playerRef.current?.pause();
          try { playerRef.current?.seekTo(toTiming.timestampFrom / 1000); } catch {}
          stopAtTimestampRef.current = null;
          pendingPlayRef.current = false;
          lastVerseKeyRef.current = null;
          setPlaybackVerseRef.current(null, null);
          const durationMsAtStop = (playerRef.current?.duration ?? 0) * 1000;
          setPlayerState({ mode: 'paused', surahId, positionMs: toTiming.timestampFrom, durationMs: durationMsAtStop });
          return;
        }
      }
    }

    // ── Verse sync ─────────────────────────────────────────────────────────
    if (isNowPlaying && verseTimingsRef.current) {
      // Bismillah lock: while positionMs is before the lock boundary, keep
      // BSMLLH_ as the active verse. Without this, findCurrentVerse returns
      // verse 1 (not BSMLLH_) when both share timestampFrom=0, because the
      // binary search resolves ties by returning the last match.
      const inBismillahLock =
        bismillahLockUntilMsRef.current > 0 &&
        positionMs < bismillahLockUntilMsRef.current &&
        lastVerseKeyRef.current?.startsWith('BSMLLH_');

      if (!inBismillahLock) {
        if (bismillahLockUntilMsRef.current > 0) {
          bismillahLockUntilMsRef.current = 0; // lock expired — clear it
        }
        const verse = findCurrentVerse(verseTimingsRef.current, positionMs);

        // ── Verse-repeat seek confirmation ────────────────────────────────
        // While a seek-back is in-flight, ticks still report the old (new-verse)
        // position. Once the position is back inside lastVerseKeyRef's range the
        // seek has taken effect — clear the lock so normal logic resumes.
        if (verseRepeatSeekingRef.current) {
          if (verse && verse.verseKey === lastVerseKeyRef.current) {
            verseRepeatSeekingRef.current = false;
          }
          // Still mid-seek: skip all transition logic for this tick.
          // Fall through to setPlayerState so the seek-bar stays accurate.
        } else if (verse && verse.verseKey !== lastVerseKeyRef.current) {
          // ── Repeat verse: seek back to start of the previous verse ────
          // When repeatVerse is on, each verse plays N times (repeatVerseCount)
          // before the player is allowed to advance. null = infinite.
          if (rs.repeatVerse && lastVerseKeyRef.current !== null) {
            const prevKey = lastVerseKeyRef.current;
            const prevVerseTiming = verseTimingsRef.current.find(
              (t) => t.verseKey === prevKey,
            );
            if (prevVerseTiming) {
              // Update (or initialise) the per-verse play counter.
              if (verseRepeatLoopRef.current?.key !== prevKey) {
                verseRepeatLoopRef.current = { key: prevKey, plays: 1 };
              } else {
                verseRepeatLoopRef.current.plays += 1;
              }
              const plays = verseRepeatLoopRef.current.plays;
              const shouldLoop = rs.repeatVerseCount === null || plays < rs.repeatVerseCount;
              if (shouldLoop) {
                verseRepeatSeekingRef.current = true; // lock until seek confirmed
                playerRef.current?.seekTo(prevVerseTiming.timestampFrom / 1000);
                return; // stay on this verse — don't update lastVerseKeyRef
              }
              // Count reached — reset and fall through to advance to next verse.
              verseRepeatLoopRef.current = null;
            }
          }

          lastVerseKeyRef.current = verse.verseKey;
          setPlaybackVerseRef.current(verse.verseKey, verse.pageNumber);
          // Update lock screen title to show current verse.
          // IMPORTANT: updateLockScreenMetadata replaces player.metadata entirely
          // in Swift. Always include artworkUrl here — omitting it causes Swift to
          // set artworkUrl=nil, which clears the artwork from the lock screen on
          // every verse transition.
          const parsed = parseVerseKey(verse.verseKey);
          if (parsed) {
            const reciterName = RECITERS.find((r) => r.id === reciterIdRef.current)?.name ?? '';
            try {
              playerRef.current?.updateLockScreenMetadata({
                title: `${parsed.surahName}: ${parsed.verseNum}`,
                artist: reciterName,
                artworkUrl: artworkUriRef.current ?? undefined,
              });
            } catch {}
          }
        }
      }
    }

    setPlayerState({
      mode: isNowPlaying ? 'playing' : 'paused',
      surahId,
      positionMs,
      durationMs,
    });
  }, []);

  // Keep the ref in sync so the stable wrapper in startPlayer always calls the
  // latest version of the callback without needing it in startPlayer's dep array.
  onPlaybackStatusUpdateRef.current = onPlaybackStatusUpdate;

  // ── Commands ───────────────────────────────────────────────────────────────

  // ── Bismillah transition helper ─────────────────────────────────────────────
  // Shared logic called from BOTH the safety timer and onPlaybackStatusUpdate's
  // didJustFinish path. Whichever fires first executes the transition; the second
  // caller finds bismillahPendingRef.current === null and is a no-op.

  // Stored in a ref so onPlaybackStatusUpdate (deps=[]) can call it without
  // capturing a stale closure. Updated every render to pick up the latest startPlayer.
  const _transitionBismillahToSurahRef = useRef<((p: BismillahPending) => Promise<void>) | null>(null);
  _transitionBismillahToSurahRef.current = async (pending: BismillahPending) => {
    // Kill bismillah player — clear lock screen so the old session doesn't linger.
    playerSubRef.current?.remove();
    playerSubRef.current = null;
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch {}
      try { playerRef.current.clearLockScreenControls(); } catch {}
      try { playerRef.current.remove(); } catch {}
      playerRef.current = null;
    }

    // Restore surah timings and set bismillah lock.
    // The lock prevents findCurrentVerse returning verse 1 at positionMs=0 when
    // both BSMLLH_ and verse 1 share timestampFrom=0 (common across reciters).
    verseTimingsRef.current = pending.timings;
    const bsmllhEntry = pending.timings?.find((t) => t.verseKey === `BSMLLH_${pending.surahId}`);
    bismillahLockUntilMsRef.current = bsmllhEntry
      ? Math.max(bsmllhEntry.timestampTo, 3000)
      : 3000;
    await startPlayer(pending.uri, pending.surahId, 0);
  };

  // ── Bismillah pre-play helper ───────────────────────────────────────────────
  //
  // QuranCDN chapter audio files do NOT contain Bismillah at the start.
  // For surahs 2-8, 10-114 we play the bismillah clip (Al-Fatiha verse 1:1)
  // before the surah audio. Al-Fatiha (1) and At-Tawbah (9) are exempt.
  //
  // New flow (vs. old):
  //   OLD: download all of Al-Fatiha → fetch timings → play with setTimeout
  //   NEW: download/cache a dedicated short clip (~5 s) → play to didJustFinish
  //
  // The clip is fetched from the same QuranCDN as chapter audio but at the
  // verse-level URL derived from the chapter URL (no hardcoded slug table).
  // The timer stays as a safety net in case the clip is a full chapter fallback
  // (deriveVerseAudioUrl returned null because the CDN pattern didn't match).
  // Whichever fires first — didJustFinish or the timer — performs the transition;
  // the second one is a no-op because bismillahPendingRef is already null.

  const startWithBismillah = useCallback(
    async (surahUri: string, surahId: number, surahTimings: VerseTimestamp[] | null) => {
      if (!mountedRef.current) return;
      const myGen = loadGenerationRef.current;
      const reciterId = reciterIdRef.current;

      // Get (or download) the dedicated bismillah clip.
      // getBismillahAudioUri caches at r{id}_bsml.mp3 — a short verse-level file
      // when the QuranCDN pattern matches, or the full Al-Fatiha chapter as a fallback.
      let bsmUri: string;
      try {
        bsmUri = await getBismillahAudioUri(reciterId);
      } catch {
        // Network failure — try the existing surah-1 path as a last resort
        const cached = await isBismillahDownloaded(reciterId);
        if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
        if (cached) {
          bsmUri = await getAudioUri(reciterId, 1);
        } else {
          await ensureAudioDir();
          bsmUri = await downloadSurahAudio(reciterId, 1);
        }
      }
      if (!mountedRef.current || loadGenerationRef.current !== myGen) return;

      // For the timer fallback: get verse 1:1 duration from Al-Fatiha timings.
      // Only needed when bsmUri is a full chapter file (short clip finishes naturally).
      let bsmDurationMs = 5000; // fallback
      try {
        const fatihaTimings = await fetchVerseTimings(reciterId, 1);
        const v1 = fatihaTimings.find((t) => t.verseKey === '1:1');
        if (v1 && v1.timestampTo > 0) bsmDurationMs = v1.timestampTo;
      } catch { /* use fallback */ }
      if (!mountedRef.current || loadGenerationRef.current !== myGen) return;

      // Null out verse timings during bismillah — prevents verse sync on clip positions
      verseTimingsRef.current = null;

      // Set BSMLLH highlight immediately
      const firstPage = SURAH_INDEX.find((s) => s.id === surahId)?.firstPage ?? 1;
      lastVerseKeyRef.current = `BSMLLH_${surahId}`;
      setPlaybackVerseRef.current(`BSMLLH_${surahId}`, firstPage);

      // Store pending surah info — consumed by both the timer and didJustFinish.
      bismillahPendingRef.current = { uri: surahUri, surahId, timings: surahTimings };

      // Start bismillah clip
      await startPlayer(bsmUri, surahId, 0);

      // Safety timer: fires after verse 1:1 duration in case didJustFinish doesn't
      // fire first (i.e. bsmUri is a full Al-Fatiha chapter, not a short clip).
      // Rate-adjusted so 2× speed fires at the correct real-world time.
      // didJustFinish beats it to the punch when the clip ends naturally.
      const currentRate = RATE_STEPS[rateIndexRef.current] ?? 1;
      const bsmTimerMs  = Math.round(bsmDurationMs / currentRate);
      bismillahTimerRef.current = setTimeout(async () => {
        bismillahTimerRef.current = null;
        const pending = bismillahPendingRef.current;
        if (!pending) return; // didJustFinish already handled the transition
        bismillahPendingRef.current = null;
        if (!mountedRef.current) return;
        // Use the ref so we always call the latest version of the transition
        // function, avoiding a forward-reference/stale-closure problem since
        // _transitionBismillahToSurahRef is defined after startWithBismillah.
        await _transitionBismillahToSurahRef.current?.(pending);
      }, bsmTimerMs);
    },
    [startPlayer],
  );

  const loadAndPlay = useCallback(
    async (surahId: number) => {
      if (!mountedRef.current) return;
      // Increment load generation so any in-flight concurrent call becomes stale
      // and aborts at its next await. This prevents rapid next-surah taps from
      // creating multiple simultaneous AudioPlayer instances.
      const myGen = ++loadGenerationRef.current;
      // Pause YouTube live stream if it's playing — Quran audio takes priority.
      pauseYoutubePlayer();
      teardown();
      currentSurahIdRef.current = surahId;
      // Show spinner immediately while we check cache
      setPlayerState({ mode: 'loading', surahId });

      const needsBismillah = surahId !== 1 && surahId !== 9;

      // Fetch timings concurrently
      const timingsPromise = fetchVerseTimings(settings.reciterId, surahId)
        .then((timings) => { verseTimingsRef.current = timings; return timings; })
        .catch((): null => { verseTimingsRef.current = null; return null; });

      try {
        const cached = await isSurahDownloaded(settings.reciterId, surahId);
        if (!mountedRef.current || loadGenerationRef.current !== myGen) return;

        let uri: string;
        if (cached) {
          uri = await getAudioUri(settings.reciterId, surahId);
          if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
        } else {
          // Download with progress bar
          setPlayerState({ mode: 'downloading', surahId, progress: 0 });
          await ensureAudioDir();
          uri = await downloadSurahAudio(
            settings.reciterId,
            surahId,
            (downloaded, total) => {
              if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
              setPlayerState({
                mode: 'downloading',
                surahId,
                progress: total > 0 ? downloaded / total : 0,
              });
            },
            downloadCancelRef,
          );
          if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
          audioCacheRefreshRef.current?.();
        }

        if (needsBismillah) {
          const surahTimings = await timingsPromise;
          if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
          await startWithBismillah(uri, surahId, surahTimings);
        } else {
          if (loadGenerationRef.current !== myGen) return;
          await startPlayer(uri, surahId, 0);
        }
      } catch (e) {
        if (!mountedRef.current) return;
        // Explicit cancel (user pressed X) or stop() was called — don't show error.
        if (e instanceof DownloadCancelledError || currentSurahIdRef.current === null) return;
        if (loadGenerationRef.current !== myGen) return;
        setPlayerState({ mode: 'error', surahId, message: 'Kunde inte ladda ljud' });
      }
    },
    [settings.reciterId, teardown, startPlayer, startWithBismillah, audioCacheRefreshRef],
  );

  // Keep ref in sync so onPlaybackStatusUpdate can call loadAndPlay without a
  // stale closure. Pattern mirrors setPlaybackVerseRef / isRepeatRef above.
  // NOTE: loadAndPlayFromVerseRef is assigned AFTER its useCallback definition below
  // (line ~965) — assigning it here would capture undefined due to const TDZ / hoisting.
  loadAndPlayRef.current = loadAndPlay;

  const pause = useCallback(() => {
    playerRef.current?.pause();
    // Immediate UI feedback — don't wait for the 250ms status callback.
    setPlayerState((prev) =>
      prev.mode === 'playing'
        ? { mode: 'paused', surahId: prev.surahId, positionMs: prev.positionMs, durationMs: prev.durationMs }
        : prev,
    );
  }, []);

  const resume = useCallback(() => {
    pendingPlayRef.current = true;
    playerRef.current?.play();
    // Immediate UI feedback — flip to playing so the icon changes instantly.
    setPlayerState((prev) =>
      prev.mode === 'paused'
        ? { mode: 'playing', surahId: prev.surahId, positionMs: prev.positionMs, durationMs: prev.durationMs }
        : prev,
    );
  }, []);

  const stop = useCallback(() => {
    continuousPlayRef.current = false;
    pendingStopVerseKeyRef.current = null;
    teardown();
    currentSurahIdRef.current = null;
    if (mountedRef.current) setPlayerState({ mode: 'hidden' });
  }, [teardown]);

  const skipSurah = useCallback(
    (delta: 1 | -1) => {
      continuousPlayRef.current = false; // manual skip exits continuous mode
      pendingStopVerseKeyRef.current = null;
      const surahId = currentSurahIdRef.current;
      if (surahId === null) return;
      const next = Math.min(114, Math.max(1, surahId + delta));
      if (next !== surahId) loadAndPlay(next);
    },
    [loadAndPlay],
  );

  const skipVerse = useCallback(
    (delta: 1 | -1) => {
      const surahId = currentSurahIdRef.current;
      if (surahId === null) return;

      const currentKey = activeVerseKeyRef.current;

      // ── Case 1: currently on bismillah pre-play ────────────────────────────
      // verseTimingsRef is null during bismillah (set to null in startWithBismillah).
      // Read surahId from the active key and handle directly.
      if (currentKey?.startsWith('BSMLLH_')) {
        if (delta > 0) {
          // Skip bismillah → start surah from verse 1 (no bismillah re-play)
          loadAndPlayFromVerse(surahId, `${surahId}:1`, null);
        } else {
          // Previous from bismillah → last verse of previous surah
          const prevSurah = Math.max(1, surahId - 1);
          if (prevSurah !== surahId) {
            continuousPlayRef.current = false;
            pendingStopVerseKeyRef.current = null;
            loadAndPlay(prevSurah);
          }
        }
        return;
      }

      // ── Case 2: normal verse playback ─────────────────────────────────────
      // Include BSMLLH_ entries so pressing ← on verse 1 reaches the bismillah.
      const timings = verseTimingsRef.current;

      if (!timings || timings.length === 0) {
        // No timings available — fall back to surah skip
        skipSurah(delta);
        return;
      }

      const currentIndex = currentKey
        ? timings.findIndex((t) => t.verseKey === currentKey)
        : -1;

      const nextIndex = currentIndex + delta;

      if (nextIndex >= 0 && nextIndex < timings.length) {
        const target = timings[nextIndex];
        if (target.verseKey.startsWith('BSMLLH_')) {
          // Target is bismillah — must reload via loadAndPlayFromVerse to trigger
          // the Al-Fatiha pre-play sequence (seeking alone won't play it).
          const targetSurahId = parseInt(target.verseKey.split('_')[1], 10);
          loadAndPlayFromVerse(targetSurahId, target.verseKey, null);
        } else {
          // Normal verse within same surah — just seek, no audio reload
          playerRef.current?.seekTo(target.timestampFrom / 1000);
        }
      } else if (delta > 0) {
        // Past last verse — go to next surah (bismillah included via loadAndPlay)
        const nextSurah = Math.min(114, surahId + 1);
        if (nextSurah !== surahId) {
          continuousPlayRef.current = false;
          pendingStopVerseKeyRef.current = null;
          loadAndPlay(nextSurah);
        }
      } else {
        // Before first verse (surah 1/9 or no BSMLLH_ entry) — previous surah
        const prevSurah = Math.max(1, surahId - 1);
        if (prevSurah !== surahId) {
          continuousPlayRef.current = false;
          pendingStopVerseKeyRef.current = null;
          loadAndPlay(prevSurah);
        }
      }
    },
    // loadAndPlayFromVerse is declared below; use its stable ref to avoid
    // forward-reference TDZ errors while still calling the latest version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skipSurah, loadAndPlay],
  );

  const seekTo = useCallback((positionMs: number) => {
    playerRef.current?.seekTo(positionMs / 1000); // expo-audio seeks in seconds
  }, []);

  const selectRate = useCallback((index: number) => {
    rateIndexRef.current = index;
    setRateIndex(index);
    setShowSpeedMenu(false);
    setDragIndex(null);
    if (playerRef.current) {
      playerRef.current.setPlaybackRate(RATE_STEPS[index]);
    }
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
          if (playerRef.current) {
            playerRef.current.setPlaybackRate(RATE_STEPS[idx]);
          }
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
      if (__DEV__) console.log('[LAFV] called surah=' + surahId + ' start=' + startVerseKey + ' stop=' + stopAtVerseKey);
      // Increment load generation so any in-flight concurrent call becomes stale.
      const myGen = ++loadGenerationRef.current;
      // Pause YouTube live stream — Quran audio takes priority.
      pauseYoutubePlayer();
      continuousPlayRef.current = continuous ?? false;

      // Reset any previous cross-surah stop (new session replaces it).
      pendingStopVerseKeyRef.current = null;

      // If stopAtVerseKey belongs to a different (future) surah, store it for
      // didJustFinish to carry forward — it can't be looked up in this surah's timings.
      const stopSurahId = stopAtVerseKey ? parseInt(stopAtVerseKey.split(':')[0], 10) : NaN;
      const isCrossSurahStop = !isNaN(stopSurahId) && stopSurahId !== surahId;
      if (isCrossSurahStop) {
        pendingStopVerseKeyRef.current = stopAtVerseKey!;
      } else if (stopAtVerseKey === null) {
        // No stop at all — if repeat settings define a cross-surah "Till" target
        // (interval off), restore pendingStop so didJustFinish can drive
        // cross-surah advancement to reach the target.
        // NOTE: do NOT enter here when stopAtVerseKey is a same-surah verse key
        // (isCrossSurahStop=false but stopAtVerseKey≠null, e.g. "Slutet av suran").
        // Restoring from repeat settings in that case would override the caller's
        // intended same-surah stop and cause playback to continue past surah end.
        const rs = repeatSettingsRef.current;
        if (!rs.repeatInterval && rs.toSurahId > surahId) {
          pendingStopVerseKeyRef.current = `${rs.toSurahId}:${rs.toVerse}`;
        }
      }

      if (!mountedRef.current) return;
      teardown();
      currentSurahIdRef.current = surahId;
      setPlayerState({ mode: 'loading', surahId });

      try {
        const cached = await isSurahDownloaded(reciterIdRef.current, surahId);
        if (!mountedRef.current || loadGenerationRef.current !== myGen) return;

        let uri: string;
        let timings: VerseTimestamp[] | null;

        if (cached) {
          // Already downloaded — fetch URI and timings in parallel
          [uri, timings] = await Promise.all([
            getAudioUri(reciterIdRef.current, surahId),
            fetchVerseTimings(reciterIdRef.current, surahId).catch((): null => null),
          ]);
          if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
        } else {
          // Download with progress; fetch timings concurrently
          setPlayerState({ mode: 'downloading', surahId, progress: 0 });
          const timingsPromise = fetchVerseTimings(reciterIdRef.current, surahId).catch((): null => null);
          await ensureAudioDir();
          uri = await downloadSurahAudio(
            reciterIdRef.current,
            surahId,
            (downloaded, total) => {
              if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
              setPlayerState({
                mode: 'downloading',
                surahId,
                progress: total > 0 ? downloaded / total : 0,
              });
            },
            downloadCancelRef,
          );
          timings = await timingsPromise;
          if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
          audioCacheRefreshRef.current?.();
        }

        if (!mountedRef.current || loadGenerationRef.current !== myGen) return;
        verseTimingsRef.current = timings;

        // If starting from BSMLLH_, play Al-Fatiha bismillah first then surah from 0
        if (startVerseKey.startsWith('BSMLLH_') && surahId !== 1 && surahId !== 9) {
          if (!isCrossSurahStop && stopAtVerseKey && timings) {
            const stopTiming = timings.find((t) => t.verseKey === stopAtVerseKey);
            stopAtTimestampRef.current = stopTiming?.timestampTo ?? null;
            if (__DEV__) console.log('[LAFV] BSMLLH_ branch: stopTiming=' + JSON.stringify(stopTiming) + ' stopAtTs=' + stopAtTimestampRef.current);
          } else {
            if (__DEV__) console.log('[LAFV] BSMLLH_ branch: no stop set (isCross=' + isCrossSurahStop + ' stopKey=' + stopAtVerseKey + ' timings=' + (timings ? timings.length : 'null') + ')');
          }
          if (__DEV__) console.log('[LAFV] calling startWithBismillah for surah=' + surahId);
          await startWithBismillah(uri, surahId, timings);
          if (__DEV__) console.log('[LAFV] startWithBismillah returned for surah=' + surahId);
          return;
        }

        const startTiming = timings?.find((t) => t.verseKey === startVerseKey) ?? null;
        const startMs = startTiming?.timestampFrom ?? 0;

        if (!isCrossSurahStop && stopAtVerseKey && timings) {
          const stopTiming = timings.find((t) => t.verseKey === stopAtVerseKey);
          stopAtTimestampRef.current = stopTiming?.timestampTo ?? null;
        }

        bismillahLockUntilMsRef.current = 0;

        if (loadGenerationRef.current !== myGen) return;
        await startPlayer(uri, surahId, startMs);
        if (!mountedRef.current || loadGenerationRef.current !== myGen) return;

        // Immediately set the start verse as active so the highlight appears
        if (startTiming) {
          lastVerseKeyRef.current = startVerseKey;
          setPlaybackVerseRef.current(startVerseKey, startTiming.pageNumber);
          // Update lock screen with verse-level title
          const parsed = parseVerseKey(startVerseKey);
          if (parsed) {
            const reciterName = RECITERS.find((r) => r.id === reciterIdRef.current)?.name ?? '';
            try {
              playerRef.current?.updateLockScreenMetadata({
                title: `${parsed.surahName}: ${parsed.verseNum}`,
                artist: reciterName,
                artworkUrl: artworkUriRef.current ?? undefined,
              });
            } catch {}
          }
        }
      } catch (e) {
        if (__DEV__) console.log('[LAFV] CAUGHT ERROR surah=' + surahId + ' mounted=' + mountedRef.current + ' currentSurah=' + currentSurahIdRef.current + ' err=' + String(e));
        if (!mountedRef.current) return;
        // Explicit cancel (user pressed X) or stop() was called — don't show error.
        if (e instanceof DownloadCancelledError || currentSurahIdRef.current === null) return;
        if (loadGenerationRef.current !== myGen) return;
        setPlayerState({ mode: 'error', surahId, message: 'Kunde inte ladda ljud' });
      }
    },
    [teardown, startPlayer, startWithBismillah, audioCacheRefreshRef],
  );
  // Assign ref here, after the useCallback — assigning it before the declaration
  // (line ~843) would set it to undefined on every render due to const hoisting.
  loadAndPlayFromVerseRef.current = loadAndPlayFromVerse;

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

    // Resume from the active verse if one exists; otherwise restart surah from beginning.
    const verseKey = activeVerseKeyRef.current;
    if (verseKey) {
      loadAndPlayFromVerse(surahId, verseKey, null);
    } else {
      loadAndPlay(surahId);
    }
  }, [settings.reciterId, loadAndPlay, loadAndPlayFromVerse]);

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
    // Reset loop counter when interval is newly enabled or boundaries change.
    const prev = repeatSettingsRef.current;
    if (
      (!prev.repeatInterval && newSettings.repeatInterval) ||
      prev.fromSurahId !== newSettings.fromSurahId ||
      prev.fromVerse !== newSettings.fromVerse ||
      prev.toSurahId !== newSettings.toSurahId ||
      prev.toVerse !== newSettings.toVerse
    ) {
      intervalLoopCountRef.current = 1;
      intervalRepeatSeekingRef.current = false;
    }
    // Reset per-verse counter when verse repeat is toggled.
    if (prev.repeatVerse !== newSettings.repeatVerse) {
      verseRepeatLoopRef.current = null;
      verseRepeatSeekingRef.current = false;
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

    setRepeatSettings(newSettings);
    // Sync legacy isRepeat flag for the didJustFinish full-surah repeat fallback
    setIsRepeat(false);

    // When interval repeat is newly enabled or the from-position changes while
    // interval is active, immediately start playing from the from-verse. This
    // ensures "Från Al-Ikhlas: 1" actually begins playback at verse 1 right away
    // rather than waiting for the current position to drift there naturally.
    const intervalNewlyEnabled = !prev.repeatInterval && newSettings.repeatInterval;
    const fromPositionChanged =
      newSettings.repeatInterval &&
      (prev.fromSurahId !== newSettings.fromSurahId || prev.fromVerse !== newSettings.fromVerse);

    if ((intervalNewlyEnabled || fromPositionChanged) && currentSurahIdRef.current !== null) {
      const fromKey = `${newSettings.fromSurahId}:${newSettings.fromVerse}`;
      if (
        currentSurahIdRef.current === newSettings.fromSurahId &&
        verseTimingsRef.current
      ) {
        // Same surah already loaded — seek to from-verse without reloading audio.
        const fromTiming = verseTimingsRef.current.find((t) => t.verseKey === fromKey);
        const seekMs = fromTiming?.timestampFrom ?? 0;
        playerRef.current?.seekTo(seekMs / 1000);
        playerRef.current?.play();
      } else {
        // Different surah or timings unavailable — load from-surah from from-verse.
        loadAndPlayFromVerseRef.current?.(newSettings.fromSurahId, fromKey, null);
      }
    }
  }, []);

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

  // ── Idle mode — compact bar ────────────────────────────────────────────────

  if (isIdle) {
    return (
      <View style={[styles.idleChipContainer, { left: landscapeInset, right: landscapeInset }]}>
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
            <TouchableOpacity
              style={styles.reciterChipBtn}
              onPress={openReciterSelector}
              activeOpacity={0.8}
            >
              <Text style={[styles.reciterChipText, { color: isDark ? '#FFFFFF' : T.text }]} numberOfLines={1}>
                {reciterName}
              </Text>
              <SvgIcon name="chevron-down" size={13} color={isDark ? 'rgba(255,255,255,0.55)' : T.textMuted} />
            </TouchableOpacity>
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
      </View>
    );
  }

  // ── Active mode — full Ayah-style card ────────────────────────────────────

  return (
    <View style={[
      styles.container,
      styles.containerActive,
      { left: landscapeInset, right: landscapeInset },
      isDark && {
        shadowColor: 'rgba(0,255,150,0.06)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 8,
      },
    ]}>
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
            ) : (isLoading && !hasPlayedRef.current) ? (
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
    </View>
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
  reciterChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  reciterChipText: {
    fontSize: 13,
    fontWeight: '600',
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
