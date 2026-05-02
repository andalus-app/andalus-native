/**
 * quranAudioEngine.ts
 *
 * Singleton engine that owns ALL Quran audio playback via react-native-track-player.
 *
 * Replaces the expo-audio createAudioPlayer / status-callback / setActiveForLockScreen
 * stack that used to live inside QuranAudioPlayer.tsx. The component now subscribes
 * to engine snapshots and only renders UI; it never touches the native player.
 *
 * Why TrackPlayer:
 *   - Native AVQueuePlayer keeps producing audio with zero JS bridge work.
 *     iOS only suspends the app when audio actually goes silent — JS being idle
 *     is fine in audio-background mode.
 *   - Bismillah → surah is a queue advance inside the native layer. No JS timer
 *     swap that can be delayed under background throttling.
 *   - Lock-screen play/pause/skip/seek are wired through the playback service
 *     (services/quranAudioPlaybackService.ts) registered at JS bundle entry.
 *   - Native repeat (RepeatMode.Track) handles looping without JS bookkeeping.
 *
 * Public surface mirrors what audioCommandsRef in QuranContext exposes today,
 * so call sites in VerseActionsMenu / QuranPagePicker do not need to change.
 *
 * STEP 2: loadAndPlay (no bismillah, no repeat) implemented.
 *         Bismillah / verse-loop / verse-range come in Steps 3–5.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { Asset } from 'expo-asset';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  RepeatMode,
  State as TpState,
} from 'react-native-track-player';
import type { RepeatSettings } from '../components/quran/RepeatSettingsModal';
import {
  getAudioUri,
  isSurahDownloaded,
  downloadSurahAudio,
  ensureAudioDir,
  getBismillahAudioUri,
  getVerseAudioUri,
  RECITERS,
  DownloadCancelledError,
} from './quranAudioService';

/**
 * Thrown by loadAndLoopVerse when the per-verse audio URL cannot be resolved
 * for the active reciter (CDN pattern mismatch, 404, download failure).
 *
 * The engine deliberately does NOT fall back to the chapter-file mid-track-seek
 * loop — that path was suspended by iOS after ~5 cycles on a locked screen and
 * is exactly the bug this migration is replacing. Caller (QuranAudioPlayer)
 * catches this error and disables repeatVerse + resumes chapter playback.
 */
export class VerseUrlUnavailableError extends Error {
  constructor(
    public readonly reciterId: number,
    public readonly surahId: number,
    public readonly verseId: number,
  ) {
    super(`Verse audio URL unavailable: reciter=${reciterId} surah=${surahId} verse=${verseId}`);
    this.name = 'VerseUrlUnavailableError';
  }
}

// Surahs that do NOT get a standalone bismillah pre-play queue item:
//   1  (Al-Fatihah) — verse 1:1 IS the bismillah recitation, no separate clip.
//   9  (At-Tawbah)  — has no bismillah at all.
// All other surahs (2–8, 10–114) get a [bismillah, surah] two-track queue and
// rely on TrackPlayer's native queue advance to switch — no JS swap.
const NO_STANDALONE_BISMILLAH = new Set<number>([1, 9]);
import { fetchVerseTimings, findCurrentVerse, type VerseTimestamp } from './mushafTimingService';
import { SURAH_INDEX } from '../data/surahIndex';

// Re-export so the engine has a single import surface for cache helpers.
export {
  RECITERS,
  DEFAULT_RECITER_ID,
  type Reciter,
} from './quranAudioService';

// ── Types ────────────────────────────────────────────────────────────────────

export type EngineState =
  | 'idle'
  | 'downloading'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'error';

export type EngineSnapshot = {
  state: EngineState;
  surahId: number | null;
  positionMs: number;
  durationMs: number;
  rate: number;
  activeVerseKey: string | null;
  pageNumber: number | null;
  errorMessage?: string;
  downloadProgress?: number; // 0..1, only when state === 'downloading'
};

type Listener = (snapshot: EngineSnapshot) => void;

const LOCK_SCREEN_ALBUM = 'Hidayah Quran';

// Capabilities passed to every TrackPlayer.updateOptions call.
// CRITICAL: updateOptions REPLACES player.remoteCommands on the native side —
// it does NOT merge. Passing updateOptions without capabilities sets
// remoteCommands = [] which disables all MPRemoteCommandCenter handlers
// (lock-screen play/pause/skip stop responding). Always spread _TP_OPTIONS
// into every updateOptions call so capabilities are never lost.
const _TP_OPTIONS = {
  capabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.Stop,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
    Capability.SeekTo,
  ],
  compactCapabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
  ],
  android: {
    appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
  },
};

// ── Module state ─────────────────────────────────────────────────────────────

let _initialized = false;
let _initializing: Promise<void> | null = null;

const _listeners = new Set<Listener>();

let _snapshot: EngineSnapshot = {
  state: 'idle',
  surahId: null,
  positionMs: 0,
  durationMs: 0,
  rate: 1,
  activeVerseKey: null,
  pageNumber: null,
};

// Reciter / repeat settings pushed in by the React component.
let _currentReciterId: number | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _repeatSettings: RepeatSettings | null = null;

// Currently-loaded surah + its verse timings. Both reset by stop() / loadAndPlay.
let _currentSurahId: number | null = null;
let _currentTimings: VerseTimestamp[] | null = null;

// ID of the currently active TrackPlayer queue item. Set by the
// PlaybackActiveTrackChanged listener and used by recomputeFromPosition to
// route the active-verse calculation:
//   `bismillah-${N}`         → activeVerseKey = `BSMLLH_${N}`, page = surah.firstPage
//   `surah-${N}`             → activeVerseKey resolved via findCurrentVerse(timings, ms)
//   `verse-${surahId}-${id}` → activeVerseKey = the looped verse (via _verseLoopActive)
//
// Reset by stop() / loadAndPlay. We also seed it inside loadAndPlay before
// play() returns so the first foreground poll has the right routing even if
// PlaybackActiveTrackChanged hasn't fired yet on slow devices.
let _activeTrackId: string | null = null;

// "Spela till" target (Step 5). When non-null, the engine monitors position
// during chapter playback and pauses (or advances to next surah for cross-
// surah ranges) when positionMs reaches `timestampMs`. Cleared by stop() /
// loadAndPlay / when reached.
let _stopAtTimestampMs: number | null = null;
// For cross-surah "Spela till" — when surah X finishes naturally during a
// sequence ending in surah Y:V, hold this key so the next loadAndPlay knows
// to set stopAt for the new surah's audio.
let _pendingStopVerseKey: string | null = null;

// Continuous mode (Spela vidare): when active, the engine pre-queues the
// next surah's tracks ~8 s before the current surah ends. AVQueuePlayer then
// naturally advances to the new surah without any JS-side reset/play that
// would empty the queue and trigger SwiftAudioEx's session deactivation
// (which iOS treats as "audio went silent" → revokes background-audio grant
// → next play attempt is silently denied → lock-screen card disappears).
//
// Cleared by stop() and by user-initiated skip.
let _continuousMode = false;

// Tracks which surah ID has already been pre-queued for continuous-mode
// advance. null = no preload yet for this surah cycle. Reset to null when a
// new ActiveTrackChanged moves us into a new surah (so we can pre-queue the
// surah after that one). Also reset on stop / loadAndPlay (fresh start).
let _preloadedNextSurahId: number | null = null;

// True while a JS-initiated skipToNext is in flight (proactive advance ~200ms
// before natural end-of-track to avoid the AVPlayer rate=0 window that
// causes iOS to mark the new track as "NOT Now Playing eligible"). Reset by
// ActiveTrackChanged after the advance lands.
let _proactiveSkipInitiated = false;

// Interval-repeat session (Step 5). When non-null:
//   • Audio is a chapter file with seek to fromKey position
//   • progressUpdateEventInterval is enabled at 1 Hz so the engine can detect
//     the boundary (positionMs >= toKey.timestampTo) and seek back to fromKey
//   • For the full-surah infinite case (fromVerse=1, toVerse=last, count=null)
//     we instead set RepeatMode.Track and leave intervalLoop null — native
//     AVPlayer rewinds at end-of-file with zero JS involvement (same trick
//     as the Step 4 verse-loop infinite case)
let _intervalLoop: {
  fromKey: string;       // e.g. "2:255"
  toKey: string;         // e.g. "2:286"
  count: number | null;  // null = infinite, finite via JS count
  plays: number;         // completed loop iterations
  // True while a seekTo(fromMs) is in flight after a boundary hit; suppresses
  // duplicate increments from progress events that fire before the seek
  // resolves (the position briefly stays past toMs for a few ticks).
  seeking: boolean;
} | null = null;

// Active verse-loop session (Step 4). When non-null:
//   • the queue contains a single per-verse mp3 track (`verse-${surahId}-${verseId}`)
//   • TrackPlayer.repeatMode is RepeatMode.Track for infinite (count === null)
//     or RepeatMode.Off for finite (count > 0)
//   • recomputeFromPosition forces the highlight to verseKey + pageNumber
//     regardless of position (position relative to single-verse file is
//     uninteresting for highlight)
//   • For finite counts: PlaybackQueueEnded handler increments `plays` and
//     issues seekTo(0) + play() until plays >= count, then stops.
//
// Reset by stop() / loadAndPlay / when the finite count completes.
let _verseLoopActive: {
  surahId: number;
  verseId: number;     // 0 for bismillah of the surah
  verseKey: string;    // `BSMLLH_${surahId}` or `${surahId}:${verseId}`
  pageNumber: number;  // updated async if a more precise number is available
  count: number | null; // null = infinite (RepeatMode.Track)
  plays: number;       // number of completed end-to-end plays so far
} | null = null;

// Generation counter — bumped at the start of every load. Async chains capture
// their generation and bail out on mismatch. Prevents rapid retaps from
// creating concurrent loads that race the underlying TrackPlayer queue.
let _loadGeneration = 0;

// Foreground-only progress polling. The 0.5s native progress event is enough
// to drive verse highlight + page advance, but we also poll at 250ms while the
// app is active for a snappier seek bar / position read. In background the
// timer is cleared — no JS work happens, audio just plays.
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _appStateSub: { remove: () => void } | null = null;

// In-progress download cancel handle. Set by loadAndPlay when downloading;
// invoked by stop() / new loadAndPlay to abort the network fetch.
const _downloadCancelRef: { current: (() => void) | null } = { current: null };

// Cached app icon URI (lock-screen artwork). Resolved once via expo-asset.
let _artworkUri: string | null = null;
let _artworkResolving: Promise<string | null> | null = null;

function resolveArtworkUri(): Promise<string | null> {
  if (_artworkUri !== null) return Promise.resolve(_artworkUri);
  if (_artworkResolving) return _artworkResolving;
  _artworkResolving = (async () => {
    try {
      const asset = Asset.fromModule(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../assets/images/icon.png'),
      );
      await asset.downloadAsync();
      _artworkUri = asset.localUri ?? null;
    } catch {
      _artworkUri = null;
    }
    _artworkResolving = null;
    return _artworkUri;
  })();
  return _artworkResolving;
}

// ── Snapshot helpers ─────────────────────────────────────────────────────────

// CRITICAL: emit() is the bridge from engine state to React UI updates.
// In background, the UI is not visible — re-rendering the QuranAudioPlayer pill
// + the Mushaf renderer (which subscribes to activeVerseKey via QuranContext)
// 4×/sec is exactly the kind of work iOS classifies as a "cpulimit violation"
// for an audio-background app. We were getting killed at ~1 min for this reason.
//
// Rule: emit() is a no-op when the app is not in the 'active' state. Internal
// state (`_snapshot`) keeps updating so that when the app returns to foreground,
// handleAppStateChange triggers one explicit emit and the UI snaps to the
// current truth in a single frame.
function emit(): void {
  if (AppState.currentState !== 'active') return;
  const snap = _snapshot;
  // Iterate over a copy so listeners that unsubscribe during emit don't
  // mutate the set mid-loop.
  for (const fn of [..._listeners]) {
    try {
      fn(snap);
    } catch {
      // Listeners must never throw out of the engine. A broken listener
      // shouldn't take down playback.
    }
  }
}

// Force-emit bypassing the AppState gate. Used by handleAppStateChange when
// transitioning to foreground so listeners catch up in one batch.
function forceEmit(): void {
  const snap = _snapshot;
  for (const fn of [..._listeners]) {
    try { fn(snap); } catch {}
  }
}

function setSnapshot(patch: Partial<EngineSnapshot>): void {
  let changed = false;
  for (const k in patch) {
    const key = k as keyof EngineSnapshot;
    if ((_snapshot as Record<string, unknown>)[key] !== (patch as Record<string, unknown>)[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  _snapshot = { ..._snapshot, ...patch };
  emit();
}

// ── Position → verse + page ──────────────────────────────────────────────────

function recomputeFromPosition(positionMs: number, durationMs: number): void {
  let activeVerseKey: string | null = _snapshot.activeVerseKey;
  let pageNumber: number | null = _snapshot.pageNumber;

  // Route the active-verse calculation. Priority order:
  //   1. Verse-loop active → forced highlight on the looped verse
  //   2. Bismillah pre-play track active → BSMLLH_N on surah's first page
  //   3. Normal surah playback → findCurrentVerse(timings, positionMs)
  if (_verseLoopActive) {
    activeVerseKey = _verseLoopActive.verseKey;
    pageNumber = _verseLoopActive.pageNumber;
  } else if (_activeTrackId && _activeTrackId.startsWith('bismillah-')) {
    const surahIdStr = _activeTrackId.slice('bismillah-'.length);
    const bsmSurahId = parseInt(surahIdStr, 10);
    if (!isNaN(bsmSurahId)) {
      activeVerseKey = `BSMLLH_${bsmSurahId}`;
      pageNumber = SURAH_INDEX.find((s) => s.id === bsmSurahId)?.firstPage ?? pageNumber;
    }
  } else {
    const timings = _currentTimings;
    if (timings && timings.length > 0) {
      const v = findCurrentVerse(timings, positionMs);
      if (v) {
        activeVerseKey = v.verseKey;
        pageNumber = v.pageNumber > 0 ? v.pageNumber : pageNumber;
      }
    }
  }

  // durationMs from the native poll can briefly come back as 0 right after
  // load — preserve the last positive value rather than zero out the seek bar.
  const safeDuration = durationMs > 0 ? durationMs : _snapshot.durationMs;
  setSnapshot({ positionMs, durationMs: safeDuration, activeVerseKey, pageNumber });
}

// ── Foreground polling ───────────────────────────────────────────────────────

function startPolling(): void {
  if (_pollTimer !== null) return;
  _pollTimer = setInterval(async () => {
    try {
      const progress = await TrackPlayer.getProgress();
      recomputeFromPosition(
        Math.round(progress.position * 1000),
        Math.round(progress.duration * 1000),
      );
    } catch {
      // Ignore — TrackPlayer may not be ready or queue empty.
    }
  }, 250);
}

function stopPolling(): void {
  if (_pollTimer === null) return;
  clearInterval(_pollTimer);
  _pollTimer = null;
}

// Toggle the native PlaybackProgressUpdated event. Default off (no JS work
// in background). Enabled at 1 Hz only when stop-at, interval-repeat, or
// continuous mode actively need to monitor position. Re-disabled when those
// modes turn off — keeps background CPU cost out of cpulimit territory.
async function setProgressEventsEnabled(enabled: boolean): Promise<void> {
  try {
    await TrackPlayer.updateOptions({
      ..._TP_OPTIONS,
      progressUpdateEventInterval: enabled ? 1.0 : 0,
    });
  } catch {
    // updateOptions can fail before init() completes — engine.init() sets
    // the default of 0 again, so this is safe to ignore.
  }
}

// True if any playback mode requires JS to monitor position. Keep in sync
// with the conditions in the modes below — they're the only callers.
function needsProgressEvents(): boolean {
  return _stopAtTimestampMs !== null || _intervalLoop !== null || _continuousMode;
}

// Materialise _stopAtTimestampMs from _pendingStopVerseKey once we have
// timings for the surah that contains the pending stop verse. Called from
// the timings-fetched callback in loadAndPlay and from the continuous
// auto-advance branch in PlaybackQueueEnded.
function resolvePendingStopAfterTimings(): void {
  if (_pendingStopVerseKey === null || _currentTimings === null) return;
  const stop = _currentTimings.find((t) => t.verseKey === _pendingStopVerseKey);
  if (stop) {
    _stopAtTimestampMs = stop.timestampTo;
    _pendingStopVerseKey = null;
    if (needsProgressEvents()) setProgressEventsEnabled(true);
    if (__DEV__) console.warn(`[QuranEngine] stopAt resolved → ${stop.timestampTo}ms`);
  }
}

// canUseNativeLoop: true when interval-repeat conditions allow us to use
// AVPlayer's native end-of-file rewind (RepeatMode.Track on the chapter
// file) instead of JS-driven seek-back. Same semantics as the legacy
// canUseNativeLoop in QuranAudioPlayer — the win is zero JS work in the
// loop body, which is what makes locked-screen background-audio survive.
//
// Conditions:
//   • repeatInterval is on
//   • repeatCount is null (infinite — finite count needs JS bookkeeping)
//   • The interval IS the entire current surah (verse 1 to last)
//   • from/to surah both equal the playing surah (no cross-surah loops)
function canUseNativeLoop(rs: RepeatSettings | null, surahId: number | null): boolean {
  if (!rs || surahId === null) return false;
  if (!rs.repeatInterval) return false;
  if (rs.repeatCount !== null) return false;
  if (rs.fromSurahId !== rs.toSurahId) return false;
  if (rs.fromSurahId !== surahId) return false;
  if (rs.fromVerse !== 1) return false;
  const surah = SURAH_INDEX.find((s) => s.id === rs.fromSurahId);
  if (!surah) return false;
  return rs.toVerse === surah.versesCount;
}

// Pre-queue the next surah's tracks (bismillah + chapter for surahs 2-8/10-114,
// chapter only for 1 and 9). Appends to the current TrackPlayer queue without
// resetting — AVQueuePlayer naturally advances when the current track ends.
//
// Only resolves URIs from CACHE in the bismillah path (getBismillahAudioUri
// downloads on miss — typically <2 s and well within the 8 s lead time). If
// the surah chapter file isn't cached, kicks off a fire-and-forget download
// while still appending the track — TrackPlayer can stream remote URLs too,
// so worst case we get a brief buffering pause on advance instead of a gap.
async function preloadNextSurah(surahId: number): Promise<void> {
  const reciterId = _currentReciterId;
  if (reciterId === null) return;

  let chapterUri: string;
  try {
    // getAudioUri returns the cached file:// URI if downloaded, otherwise the
    // remote https:// URL. TrackPlayer accepts both.
    chapterUri = await getAudioUri(reciterId, surahId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[QuranEngine] preload surah ${surahId} chapter URL failed: ${msg}`);
    throw e;
  }

  let bismillahUri: string | null = null;
  const needsBismillah = !NO_STANDALONE_BISMILLAH.has(surahId);
  if (needsBismillah) {
    try {
      bismillahUri = await getBismillahAudioUri(reciterId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[QuranEngine] preload bismillah for surah ${surahId} failed: ${msg}`);
      // Best-effort — proceed without bismillah pre-track.
    }
  }

  // If continuous mode was disabled or surah changed during await, abort.
  if (!_continuousMode || _preloadedNextSurahId !== surahId) {
    if (__DEV__) console.warn(`[QuranEngine] preload surah ${surahId} aborted (state changed)`);
    return;
  }

  const surahInfo = SURAH_INDEX.find((s) => s.id === surahId);
  const surahName = surahInfo?.nameSimple ?? `Surah ${surahId}`;
  const reciterName = RECITERS.find((r) => r.id === reciterId)?.name ?? '';
  const artworkUri = await resolveArtworkUri();

  const tracks = [];
  if (bismillahUri) {
    tracks.push({
      id: `bismillah-${surahId}`,
      url: bismillahUri,
      title: surahName,
      artist: reciterName,
      album: LOCK_SCREEN_ALBUM,
      artwork: artworkUri ?? undefined,
    });
  }
  tracks.push({
    id: `surah-${surahId}`,
    url: chapterUri,
    title: surahName,
    artist: reciterName,
    album: LOCK_SCREEN_ALBUM,
    artwork: artworkUri ?? undefined,
  });

  // Final state check before mutating the queue.
  if (!_continuousMode || _preloadedNextSurahId !== surahId) {
    return;
  }

  await TrackPlayer.add(tracks);
  if (__DEV__) console.error(`[QuranEngine] preloaded surah ${surahId} (${tracks.length} tracks appended)`);
}

function handleAppStateChange(state: AppStateStatus): void {
  if (__DEV__) console.warn(`[QuranEngine] AppState → ${state}`);
  if (state === 'active') {
    startPolling();
    // Re-sync the snapshot from the native player (which kept playing while
    // we were away), then force-emit so subscribers catch up in one batch.
    // forceEmit() bypasses the foreground gate in emit() — without this the
    // first emit wouldn't fire until the next setSnapshot() since AppState
    // may not have changed by the time emit() is called from inside the
    // promise callback.
    TrackPlayer.getProgress()
      .then((p) => {
        recomputeFromPosition(
          Math.round(p.position * 1000),
          Math.round(p.duration * 1000),
        );
        forceEmit();
      })
      .catch(() => forceEmit());
  } else {
    stopPolling();
  }
}

// ── Native event → snapshot mapping ──────────────────────────────────────────

function mapTpStateToEngine(state: TpState): EngineState | null {
  // Only react to definitive states. Transitional ones (Loading, Buffering,
  // Ready, Stopped, Ended, None) are skipped because:
  //   - Loading/Buffering would cause UI flicker between the initial 'loading'
  //     set by loadAndPlay() and 'playing' set when play() resolves.
  //   - Ready is the "loaded but not yet started playing" state — Playing
  //     follows immediately when play() takes effect.
  //   - Stopped fires from our own TrackPlayer.reset() in stop()/loadAndPlay,
  //     where we've already set the snapshot explicitly.
  //   - Ended is handled by Event.PlaybackQueueEnded.
  switch (state) {
    case TpState.Playing:
      return 'playing';
    case TpState.Paused:
      return 'paused';
    case TpState.Error:
      return 'error';
    default:
      return null;
  }
}

// ── Public engine surface ────────────────────────────────────────────────────

export const QuranAudioEngine = {
  /**
   * Idempotent. Safe to call from multiple useEffects — second+ calls are no-ops.
   *
   * Sets up TrackPlayer with the iOS audio session configured for background
   * spoken-audio playback, declares lock-screen capabilities, attaches the
   * native event listeners, and starts the foreground polling timer.
   */
  async init(): Promise<void> {
    if (_initialized) return;
    if (_initializing) return _initializing;
    _initializing = (async () => {
      if (__DEV__) console.error('[QuranEngine] init() starting');
      try {
        await TrackPlayer.setupPlayer({
          // .playback = audio plays even with the silent switch on, and audio
          // can keep playing when locked / backgrounded (combined with the
          // UIBackgroundModes:audio entry already in app.json's iOS infoPlist).
          //
          // No iosCategoryMode (default = .default), no iosCategoryOptions,
          // no autoHandleInterruptions. These were dropped after a CPU-budget
          // kill in TestFlight (see comment on emit() above) — the simpler
          // configuration narrows the set of internal RNTP listeners + iOS
          // session callbacks that fire while the screen is locked.
          iosCategory: IOSCategory.Playback,
          // waitForBuffer: false → AVPlayer.automaticallyWaitsToMinimizeStalling
          // is set to false. Without this, AVPlayer transitions through rate=0
          // for ~500 ms when a queue item naturally ends and the next one
          // loads — iOS's "Now Playing eligible" check happens during that
          // window and disqualifies us, then revokes the background-audio
          // grant 5 s later. Confirmed via iPhone log: rate=0 at queue
          // advance, "AQIONode.cpp:731 ... NOT Now Playing eligible" 48 ms
          // later, "cmsExtendBackgroundAppAssertionTimeDidFinish" 5 s later.
          waitForBuffer: false,
        });
      } catch (err: unknown) {
        // setupPlayer throws "The player has already been initialized" on
        // hot-reload or fast refresh. Treat that as success.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already been initialized/i.test(msg)) {
          throw err;
        }
      }

      await TrackPlayer.updateOptions({
        // _TP_OPTIONS is spread here and in every setProgressEventsEnabled call.
        // updateOptions REPLACES player.remoteCommands natively — never pass
        // a partial object without capabilities or lock-screen controls break.
        ..._TP_OPTIONS,
        // CRITICAL: native progress events DISABLED.
        //
        // Setting this to any positive value causes RNTP to fire
        // PlaybackProgressUpdated events at that interval — IN BACKGROUND TOO.
        // Each event crosses the JS bridge → engine handler → setSnapshot →
        // emit → React re-render of QuranAudioPlayer + Mushaf renderer +
        // QuranContext consumers. iOS bills all of that against the
        // audio-background CPU budget and kills the app at ~1 minute.
        //
        // Foreground UI is driven entirely by the 250 ms polling timer in
        // startPolling(), which is started/stopped on AppState transitions.
        // Result: zero engine-induced JS work in background.
        progressUpdateEventInterval: 0,
      });

      await TrackPlayer.setRepeatMode(RepeatMode.Off);

      if (__DEV__) console.error('[QuranEngine] init() completed — capabilities registered');

      // Native event wiring. Each handler is intentionally minimal — we want
      // the smallest possible JS footprint per event so iOS doesn't bill us
      // for non-audio work in background. Event.PlaybackProgressUpdated is
      // NOT registered here — it's disabled at the source via
      // progressUpdateEventInterval: 0 above.
      //
      // PlaybackState fires only on actual transitions (Playing/Paused/Error
      // — see mapTpStateToEngine). Rare events, safe to handle in background.
      TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
        const next = mapTpStateToEngine(event.state);
        if (__DEV__) console.warn(`[QuranEngine] PlaybackState ${event.state} → ${next ?? 'ignored'}`);
        if (next) setSnapshot({ state: next });
      });

      TrackPlayer.addEventListener(Event.PlaybackError, (event) => {
        const message =
          (event && typeof event === 'object' && 'message' in event && typeof event.message === 'string')
            ? event.message
            : 'Playback error';
        console.warn(`[QuranEngine] PlaybackError: ${message}`);
        setSnapshot({ state: 'error', errorMessage: message });
      });

      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
        if (__DEV__) console.error(`[QuranEngine] PlaybackQueueEnded — surah=${_currentSurahId} continuous=${_continuousMode} verseLoop=${_verseLoopActive ? `${_verseLoopActive.plays}/${_verseLoopActive.count ?? '∞'}` : 'null'}`);

        // Step 4: finite verse-loop count handling. plays counts COMPLETED
        // end-to-end plays. After each QueueEnded we increment, and if we
        // haven't reached count, seekTo(0) + play() to start the next loop.
        // For infinite loops (count === null), RepeatMode.Track is set on
        // the queue and PlaybackQueueEnded never fires — AVPlayer rewinds
        // natively without telling JS.
        if (_verseLoopActive && _verseLoopActive.count !== null) {
          _verseLoopActive.plays += 1;
          if (_verseLoopActive.plays < _verseLoopActive.count) {
            if (__DEV__) console.warn(
              `[QuranEngine] verse-loop replay ${_verseLoopActive.plays + 1}/${_verseLoopActive.count}`,
            );
            TrackPlayer.seekTo(0)
              .then(() => TrackPlayer.play())
              .catch(() => undefined);
            return;
          }
          if (__DEV__) console.warn(
            `[QuranEngine] verse-loop finished after ${_verseLoopActive.count} plays`,
          );
        }

        // Step 5: continuous mode (Spela vidare) — auto-advance to next surah.
        // Also handles cross-surah "Spela till": when surah X finishes during
        // a sequence ending in Y:V, advance to Y and re-arm stopAt for V.
        const finishedSurahId = _currentSurahId;
        if (_continuousMode && finishedSurahId !== null) {
          const next = finishedSurahId + 1;
          if (next <= 114) {
            if (__DEV__) console.error(`[QuranEngine] continuous → surah ${next}`);
            // Carry over continuous flag through the new load.
            const carryStop = _pendingStopVerseKey;
            const carryContinuous = _continuousMode;
            (async () => {
              try {
                await QuranAudioEngine.loadAndPlay(next);
                if (__DEV__) console.error(`[QuranEngine] continuous loadAndPlay(${next}) resolved`);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[QuranEngine] continuous loadAndPlay(${next}) THREW: ${msg}`);
              }
              // Re-arm continuous + stopAt that loadAndPlay clears.
              _continuousMode = carryContinuous;
              if (carryStop) {
                _pendingStopVerseKey = carryStop;
                // If the pending stop is in the new surah, materialise its
                // timestamp once timings load. Handled by the timings.then()
                // chain inside loadAndPlay — we do a one-shot resolve here.
                resolvePendingStopAfterTimings();
              }
              if (needsProgressEvents()) setProgressEventsEnabled(true);
            })();
            return;
          }
          // No next surah (we just finished surah 114).
        }

        // Default path: queue ended → idle.
        setSnapshot({
          state: 'idle',
          positionMs: 0,
          activeVerseKey: null,
          pageNumber: null,
        });
        _currentSurahId = null;
        _currentTimings = null;
        _activeTrackId = null;
        _verseLoopActive = null;
        _stopAtTimestampMs = null;
        _pendingStopVerseKey = null;
        _continuousMode = false;
        _intervalLoop = null;
        _preloadedNextSurahId = null;
        _proactiveSkipInitiated = false;
        setProgressEventsEnabled(false);
      });

      // Position-monitoring events (Step 5). These fire ONLY when something
      // explicitly enabled them via setProgressEventsEnabled(true) — i.e.
      // when stop-at, interval-repeat, or continuous mode is active. For plain
      // surah/verse playback the event is disabled at the source so we stay
      // under the audio-background CPU budget.
      TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (event) => {
        const positionMs = Math.round(event.position * 1000);
        const durationMs = Math.round(event.duration * 1000);

        // ── Continuous-mode pre-queue ─────────────────────────────────────
        // ~8 s before the current surah ends, append the next surah's tracks
        // to the queue. The actual track transition is done proactively below
        // via skipToNext at duration-200ms — that avoids the AVPlayer rate=0
        // window that natural end-of-track produces and that iOS uses to
        // judge a track NOT Now Playing eligible.
        if (
          _continuousMode &&
          _currentSurahId !== null &&
          _preloadedNextSurahId === null &&
          durationMs > 0 &&
          positionMs >= durationMs - 8000
        ) {
          const next = _currentSurahId + 1;
          if (next <= 114) {
            _preloadedNextSurahId = next;
            if (__DEV__) console.error(`[QuranEngine] preloading next surah ${next} (current at ${positionMs}/${durationMs}ms)`);
            void preloadNextSurah(next).catch(() => {
              // Reset so we can retry on the next progress tick.
              if (_preloadedNextSurahId === next) _preloadedNextSurahId = null;
            });
          }
        }

        // ── Proactive skipToNext at end-of-track ──────────────────────────
        // The previous approach relied on AVPlayer's natural end-of-track
        // advance, but AVPlayer drops rate to 0 for ~500 ms during that
        // transition — long enough for iOS's eligibility check to mark the
        // new track NOT Now Playing eligible (lock-screen card vanishes,
        // background-audio grant revoked 5 s later).
        //
        // JS-initiated skipToNext while the player is still actively at
        // rate=1 advances the queue without going through the rate=0
        // window. The user loses the trailing ~200 ms of the current
        // surah's audio (typically silence/fade-out anyway).
        if (
          _continuousMode &&
          _currentSurahId !== null &&
          _preloadedNextSurahId !== null &&  // next is in queue
          !_proactiveSkipInitiated &&
          durationMs > 0 &&
          positionMs >= durationMs - 200
        ) {
          _proactiveSkipInitiated = true;
          if (__DEV__) console.error(`[QuranEngine] proactive skipToNext at ${positionMs}/${durationMs}`);
          TrackPlayer.skipToNext().catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[QuranEngine] proactive skipToNext failed: ${msg}`);
            _proactiveSkipInitiated = false;
          });
        }

        // ── Interval-repeat boundary ──────────────────────────────────────
        // Detect when position crosses the toKey's end timestamp; seek back
        // to fromKey start. seeking flag prevents duplicate increments
        // because position may stay past toMs for a few ticks while the seek
        // resolves.
        if (
          _intervalLoop &&
          _currentTimings &&
          !_intervalLoop.seeking
        ) {
          const toTiming = _currentTimings.find((t) => t.verseKey === _intervalLoop!.toKey);
          if (toTiming && positionMs >= toTiming.timestampTo) {
            const fromTiming = _currentTimings.find((t) => t.verseKey === _intervalLoop!.fromKey);
            const fromMs = fromTiming?.timestampFrom ?? 0;
            _intervalLoop.plays += 1;

            const isInfinite = _intervalLoop.count === null;
            const moreLoops = !isInfinite && _intervalLoop.plays < _intervalLoop.count!;
            if (isInfinite || moreLoops) {
              _intervalLoop.seeking = true;
              if (__DEV__) console.warn(`[QuranEngine] interval-loop ${_intervalLoop.plays + 1}/${_intervalLoop.count ?? '∞'}`);
              TrackPlayer.seekTo(fromMs / 1000)
                .then(() => TrackPlayer.play())
                .finally(() => {
                  if (_intervalLoop) _intervalLoop.seeking = false;
                });
            } else {
              // Finite count reached → stop at toKey end.
              if (__DEV__) console.warn(`[QuranEngine] interval-loop finished after ${_intervalLoop.count} plays`);
              _intervalLoop = null;
              TrackPlayer.pause().catch(() => undefined);
              setProgressEventsEnabled(false);
            }
            return;
          }
          // Reset seeking flag once position has dropped back into the range.
          if (
            _intervalLoop.seeking &&
            toTiming &&
            positionMs < toTiming.timestampTo - 500
          ) {
            _intervalLoop.seeking = false;
          }
        }

        // ── stopAtTimestamp ("Spela till") ────────────────────────────────
        // Pause (or advance to next surah for cross-surah ranges) when the
        // monitored position is reached.
        if (_stopAtTimestampMs !== null && positionMs >= _stopAtTimestampMs) {
          if (__DEV__) console.warn('[QuranEngine] stopAt boundary reached');
          _stopAtTimestampMs = null;
          // If a cross-surah pending stop is set, the next-surah branch in
          // PlaybackQueueEnded handles advancement. Here we just pause for
          // single-surah "Spela till".
          if (_pendingStopVerseKey === null) {
            TrackPlayer.pause().catch(() => undefined);
          }
          if (!needsProgressEvents()) setProgressEventsEnabled(false);
        }
      });

      // Native queue advance — fires when:
      //   • bismillah-X ends → queue moves to surah-X (Step 3)
      //   • surah-X ends → continuous-mode pre-queue moves to bismillah-X+1 (Step 5)
      //   • bismillah-X+1 ends → queue moves to surah-X+1
      //
      // event.track is the new active track object (with our string `id` field).
      TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
        const newId = event?.track?.id != null ? String(event.track.id) : null;
        if (__DEV__) console.error(`[QuranEngine] ActiveTrackChanged → ${newId ?? 'null'}`);
        _activeTrackId = newId;

        // Detect continuous-mode surah advance: track id matches surah-N or
        // bismillah-N for a different N than _currentSurahId. Update engine
        // state so verse highlight, snapshot.surahId, and timings track the
        // new surah, and explicitly resume playback — SwiftAudioEx's queue
        // advance loads the next item but doesn't always auto-play it (the
        // AVPlayer rate stays at 0 after end-of-track unless we kick it).
        if (newId) {
          const m = newId.match(/^(?:bismillah|surah)-(\d+)$/);
          if (m) {
            const trackSurahId = parseInt(m[1], 10);
            const isAdvance = trackSurahId !== _currentSurahId;
            if (isAdvance) {
              if (__DEV__) console.error(`[QuranEngine] queue advanced surah ${_currentSurahId} → ${trackSurahId}`);
              _currentSurahId = trackSurahId;
              _currentTimings = null;
              _preloadedNextSurahId = null; // ready to pre-queue surah after this one
              _proactiveSkipInitiated = false; // ready to skip the surah after this one
              setSnapshot({ surahId: trackSurahId, state: 'playing' });

              // Fetch timings for the new surah so verse highlight + auto-page
              // advance work, and so any pendingStopVerseKey can be resolved.
              const reciterId = _currentReciterId;
              if (reciterId !== null) {
                void fetchVerseTimings(reciterId, trackSurahId)
                  .then((timings) => {
                    if (_currentSurahId !== trackSurahId) return;
                    _currentTimings = timings;
                    resolvePendingStopAfterTimings();
                  })
                  .catch(() => undefined);
              }
            }

            // After ANY track change in continuous mode, two things must
            // happen IMMEDIATELY (synchronously, no async delay):
            //
            //   1. updateNowPlayingMetadata — iOS evaluates "Now Playing
            //      eligibility" the moment the new currentItem activates.
            //      SwiftAudioEx's auto-update of MPNowPlayingInfoCenter
            //      happens on a delayed callback that loses the race against
            //      iOS's eligibility check. If the check sees stale or empty
            //      metadata at that instant, the new track is marked NOT
            //      Now Playing eligible, and iOS revokes the background-audio
            //      grant 5 s later (we observed this exact sequence in the
            //      iPhone log: "AQIONode.cpp:731 ... NOT Now Playing eligible"
            //      followed by "cmsExtendBackgroundAppAssertionTimeDidFinish").
            //      Lock-screen card disappears, audio paused, app suspended.
            //
            //   2. play() — SwiftAudioEx loads the new currentItem but
            //      AVPlayer's rate stays 0 after natural end-of-track unless
            //      we kick it. Without this the track sits paused forever
            //      (matches the "bismillah highlighted but no audio" symptom).
            if (_continuousMode) {
              const surahInfo = SURAH_INDEX.find((s) => s.id === trackSurahId);
              const surahName = surahInfo?.nameSimple ?? `Surah ${trackSurahId}`;
              const reciterId = _currentReciterId;
              const reciterName = reciterId !== null
                ? (RECITERS.find((r) => r.id === reciterId)?.name ?? '')
                : '';
              if (__DEV__) console.error(`[QuranEngine] updateNowPlayingMetadata + play() for ${newId}`);
              TrackPlayer.updateNowPlayingMetadata({
                title: surahName,
                artist: reciterName,
                album: LOCK_SCREEN_ALBUM,
                artwork: _artworkUri ?? undefined,
              }).catch(() => undefined);
              TrackPlayer.play().catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[QuranEngine] explicit play() failed: ${msg}`);
              });
            }
          }
        }

        // Force-recompute so the verse highlight + page advance update on the
        // exact tick the queue advances, without waiting for the next poll.
        if (newId) {
          TrackPlayer.getProgress()
            .then((p) =>
              recomputeFromPosition(
                Math.round(p.position * 1000),
                Math.round(p.duration * 1000),
              ),
            )
            .catch(() => undefined);
        }
      });

      // Foreground-only polling. Set up after listeners so the first
      // change handler can immediately run startPolling.
      _appStateSub?.remove();
      _appStateSub = AppState.addEventListener('change', handleAppStateChange);
      if (AppState.currentState === 'active') startPolling();

      _initialized = true;
    })();
    try {
      await _initializing;
    } finally {
      _initializing = null;
    }
  },

  /**
   * Subscribe to snapshot updates. Returns an unsubscribe function.
   * The listener is called immediately with the current snapshot so
   * components can hydrate their initial render synchronously.
   */
  subscribe(listener: Listener): () => void {
    _listeners.add(listener);
    try {
      listener(_snapshot);
    } catch {}
    return () => {
      _listeners.delete(listener);
    };
  },

  /** Read the current snapshot synchronously (for non-React callers). */
  getSnapshot(): EngineSnapshot {
    return _snapshot;
  },

  /**
   * Repeat-settings registration. The engine reads this on every loadAndPlay/
   * loadAndPlayFromVerse. Stored as a module-level ref so changes outside an
   * active load take effect on the next load.
   *
   * Step 2: setter only. Actual application of repeat settings happens in
   * Step 4 (verse repeat) and Step 5 (interval / range repeat).
   */
  setRepeatSettings(rs: RepeatSettings): void {
    _repeatSettings = rs;
  },

  /**
   * Push the current reciter ID into the engine. Must be called before any
   * loadAndPlay invocation. The component sets this on mount + whenever the
   * user changes the reciter in the settings panel.
   */
  setReciter(reciterId: number): void {
    _currentReciterId = reciterId;
  },

  /**
   * Step 2: load a surah and play it from start. No bismillah pre-play, no
   * repeat handling — Steps 3–5 layer those on top. If the audio file is not
   * already cached locally, this downloads it (with progress reported via
   * snapshot.downloadProgress) before playback begins.
   *
   * Concurrency: a generation counter is bumped at entry; every await checks
   * that no newer load has started. Rapid retaps therefore short-circuit
   * earlier loads cleanly without leaving orphan tracks in the queue.
   */
  async loadAndPlay(surahId: number): Promise<void> {
    if (__DEV__) console.error(`[QuranEngine] loadAndPlay(${surahId})`);
    await this.init();

    const reciterId = _currentReciterId;
    if (reciterId === null) {
      setSnapshot({ state: 'error', errorMessage: 'No reciter selected' });
      return;
    }

    const generation = ++_loadGeneration;

    // Cancel any in-flight download from a previous load before resetting state.
    _downloadCancelRef.current?.();
    _downloadCancelRef.current = null;

    setSnapshot({
      state: 'loading',
      surahId,
      positionMs: 0,
      durationMs: 0,
      activeVerseKey: null,
      pageNumber: null,
      errorMessage: undefined,
      downloadProgress: undefined,
    });

    // Reset native queue immediately so the lock-screen card transitions to the
    // new surah's metadata as soon as add()+play() runs below.
    try { await TrackPlayer.reset(); } catch {}
    if (generation !== _loadGeneration) return;

    _currentSurahId = surahId;
    _currentTimings = null;
    _activeTrackId = null;
    _verseLoopActive = null;
    _stopAtTimestampMs = null;
    _intervalLoop = null;
    _preloadedNextSurahId = null;
    _proactiveSkipInitiated = false;
    // NOTE: do NOT clear _continuousMode or _pendingStopVerseKey here. The
    // continuous-advance branch in PlaybackQueueEnded saves+restores those
    // around its loadAndPlay() call; user-facing loadAndPlay invocations
    // (skipSurah, surah picker tap) clear them in their own dispatch path.
    // RepeatMode may have been set to Track by a previous loadAndLoopVerse;
    // reset to Off here so chapter playback ends naturally at end-of-surah.
    try { await TrackPlayer.setRepeatMode(RepeatMode.Off); } catch {}
    // Plain surah playback doesn't need progress events — disable until a
    // mode (continuous/stopAt/intervalLoop) re-enables them.
    if (!needsProgressEvents()) await setProgressEventsEnabled(false);

    // Resolve the bismillah clip URI in parallel with the surah download.
    // First call may take ~1-2s to download the small (~5s) clip; subsequent
    // loads are instant from cache. Surahs 1 and 9 skip this entirely.
    const needsBismillah = !NO_STANDALONE_BISMILLAH.has(surahId);
    const bismillahPromise: Promise<string | null> = needsBismillah
      ? getBismillahAudioUri(reciterId).catch((err: unknown) => {
          // Best-effort: if bismillah download fails (network, CDN), skip the
          // pre-track and just play the surah. Lock-screen card still shows
          // the right metadata; the user just doesn't hear the bismillah.
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[QuranEngine] bismillah resolve failed: ${msg}`);
          return null;
        })
      : Promise.resolve(null);

    // Fire timings fetch in parallel; assign into module ref when it resolves
    // (and only if the load is still current).
    void fetchVerseTimings(reciterId, surahId)
      .then((timings) => {
        if (generation !== _loadGeneration) return;
        _currentTimings = timings;
        // If a cross-surah "Spela till" or continuous-mode advance is waiting
        // for this surah's timings to materialise its stop point, do it now.
        resolvePendingStopAfterTimings();
        // Also recompute immediately in case position has already advanced.
        TrackPlayer.getProgress().then((p) => {
          if (generation !== _loadGeneration) return;
          recomputeFromPosition(
            Math.round(p.position * 1000),
            Math.round(p.duration * 1000),
          );
        }).catch(() => undefined);
      })
      .catch(() => {
        // Timings unavailable — verse highlight + page advance will be inactive
        // for this session, but playback itself proceeds normally.
      });

    try {
      // Resolve the audio URI — cached file or download.
      let uri: string;
      const cached = await isSurahDownloaded(reciterId, surahId);
      if (generation !== _loadGeneration) return;

      if (cached) {
        uri = await getAudioUri(reciterId, surahId);
        if (generation !== _loadGeneration) return;
      } else {
        setSnapshot({ state: 'downloading', surahId, downloadProgress: 0 });
        await ensureAudioDir();
        uri = await downloadSurahAudio(
          reciterId,
          surahId,
          (downloaded, total) => {
            if (generation !== _loadGeneration) return;
            setSnapshot({
              downloadProgress: total > 0 ? downloaded / total : 0,
            });
          },
          _downloadCancelRef,
        );
        _downloadCancelRef.current = null;
        if (generation !== _loadGeneration) return;
        setSnapshot({ state: 'loading', downloadProgress: undefined });
      }

      const surahInfo = SURAH_INDEX.find((s) => s.id === surahId);
      const surahName = surahInfo?.nameSimple ?? `Surah ${surahId}`;
      const reciterName = RECITERS.find((r) => r.id === reciterId)?.name ?? '';
      const artworkUri = await resolveArtworkUri();
      if (generation !== _loadGeneration) return;

      // Wait for the bismillah resolve to finish (started in parallel earlier).
      // Returns null when we don't need one (surah 1/9) or when the resolve
      // failed — in either case we just queue the surah track alone.
      const bismillahUri = await bismillahPromise;
      if (generation !== _loadGeneration) return;

      // Build the queue. When a bismillah track is present, both items share
      // identical title/artist/album/artwork so the lock-screen card stays
      // unchanged across the native queue advance — exactly like Apple Music
      // between two tracks of the same album. The synthetic
      // `BSMLLH_${surahId}` verse highlight is driven by the active-track
      // ID lookup in recomputeFromPosition above.
      const tracks = [];
      if (bismillahUri) {
        tracks.push({
          id: `bismillah-${surahId}`,
          url: bismillahUri,
          title: surahName,
          artist: reciterName,
          album: LOCK_SCREEN_ALBUM,
          artwork: artworkUri ?? undefined,
        });
      }
      tracks.push({
        id: `surah-${surahId}`,
        url: uri,
        title: surahName,
        artist: reciterName,
        album: LOCK_SCREEN_ALBUM,
        // RNTP accepts string URIs for artwork including file:// from expo-asset.
        artwork: artworkUri ?? undefined,
      });

      await TrackPlayer.add(tracks);
      if (generation !== _loadGeneration) return;

      // Seed the active-track id immediately so the first foreground poll
      // after play() routes activeVerseKey correctly without waiting for the
      // PlaybackActiveTrackChanged event (which may take a few ms after add).
      _activeTrackId = bismillahUri ? `bismillah-${surahId}` : `surah-${surahId}`;

      await TrackPlayer.play();
      // Snapshot.state will flip to 'playing' via the PlaybackState event;
      // setting it here as well guards against early-tap race where the user
      // pauses before the first state event arrives.
      if (generation === _loadGeneration) {
        setSnapshot({ state: 'playing' });
      }
    } catch (err) {
      _downloadCancelRef.current = null;
      if (generation !== _loadGeneration) return;
      // Explicit user cancel (stop() called) — already in 'idle' state.
      if (err instanceof DownloadCancelledError) return;
      const msg = err instanceof Error ? err.message : 'Failed to load audio';
      setSnapshot({ state: 'error', errorMessage: msg, surahId });
    }
  },

  // ── STEP 3+ surface (declared so call sites compile; bodies are
  //    no-ops in this checkpoint). ─────────────────────────────────────────

  /**
   * Step 5: load a chapter file, seek to a starting verse, optionally stop
   * at a target verse, optionally enable continuous mode (auto-advance to
   * next surah on chapter end). Also sets up interval-repeat machinery
   * based on the current repeatSettings if applicable.
   *
   * Mode selection (in priority order):
   *   1. startVerseKey === BSMLLH_${surahId} → delegate to loadAndPlay
   *      (same surah-with-bismillah-pre-play queue as Step 3)
   *   2. repeatInterval && canUseNativeLoop → RepeatMode.Track on chapter
   *      file. Native AVPlayer rewinds at end-of-file with zero JS work.
   *      Best path for "loop the whole surah forever".
   *   3. repeatInterval (partial range or finite count) → JS-driven loop
   *      via PlaybackProgressUpdated boundary monitor at 1 Hz.
   *   4. continuous + cross-surah stopAt → continuous mode + pendingStopVerseKey
   *   5. stopAtVerseKey within same surah → set _stopAtTimestampMs
   *   6. stopAtVerseKey in a future surah → set continuous + pendingStopVerseKey
   *
   * Concurrency: same generation-counter pattern as loadAndPlay.
   */
  async loadAndPlayFromVerse(
    surahId: number,
    startVerseKey: string,
    stopAtVerseKey: string | null,
    continuous?: boolean,
  ): Promise<void> {
    if (__DEV__) console.error(`[QuranEngine] loadAndPlayFromVerse(${surahId}, start=${startVerseKey}, stop=${stopAtVerseKey ?? 'null'}, continuous=${!!continuous})`);
    await this.init();

    // BSMLLH_X start key → use the standard surah load (which queues
    // bismillah → surah). The user is asking to start at the bismillah of
    // this surah, which is exactly what loadAndPlay does for surahs 2-114.
    // Set up stopAt / continuous afterwards via module state.
    if (startVerseKey.startsWith('BSMLLH_')) {
      // Pre-set continuous so loadAndPlay's reset doesn't wipe it.
      _continuousMode = !!continuous;
      _pendingStopVerseKey = stopAtVerseKey;
      await this.loadAndPlay(surahId);
      return;
    }

    await this.init();

    const reciterId = _currentReciterId;
    if (reciterId === null) {
      setSnapshot({ state: 'error', errorMessage: 'No reciter selected' });
      return;
    }

    const generation = ++_loadGeneration;

    _downloadCancelRef.current?.();
    _downloadCancelRef.current = null;

    setSnapshot({
      state: 'loading',
      surahId,
      positionMs: 0,
      durationMs: 0,
      activeVerseKey: null,
      pageNumber: null,
      errorMessage: undefined,
      downloadProgress: undefined,
    });

    try { await TrackPlayer.reset(); } catch {}
    if (generation !== _loadGeneration) return;

    _currentSurahId = surahId;
    _currentTimings = null;
    _activeTrackId = null;
    _verseLoopActive = null;
    _intervalLoop = null;
    _stopAtTimestampMs = null;
    _preloadedNextSurahId = null;
    _proactiveSkipInitiated = false;
    _continuousMode = !!continuous;
    // Decide stopAt strategy: same-surah → set _pendingStopVerseKey for
    // resolution after timings load; cross-surah → also set, plus enable
    // continuous so we advance through intermediate surahs.
    if (stopAtVerseKey) {
      _pendingStopVerseKey = stopAtVerseKey;
      const stopSurahMatch = stopAtVerseKey.match(/^(\d+):/);
      if (stopSurahMatch && parseInt(stopSurahMatch[1], 10) !== surahId) {
        _continuousMode = true; // need to advance through intermediate surahs
      }
    } else {
      _pendingStopVerseKey = null;
    }

    // Resolve chapter URI (cached or download).
    let uri: string;
    try {
      const cached = await isSurahDownloaded(reciterId, surahId);
      if (generation !== _loadGeneration) return;
      if (cached) {
        uri = await getAudioUri(reciterId, surahId);
      } else {
        setSnapshot({ state: 'downloading', surahId, downloadProgress: 0 });
        await ensureAudioDir();
        uri = await downloadSurahAudio(
          reciterId,
          surahId,
          (downloaded, total) => {
            if (generation !== _loadGeneration) return;
            setSnapshot({ downloadProgress: total > 0 ? downloaded / total : 0 });
          },
          _downloadCancelRef,
        );
        _downloadCancelRef.current = null;
        if (generation !== _loadGeneration) return;
        setSnapshot({ state: 'loading', downloadProgress: undefined });
      }
    } catch (err) {
      _downloadCancelRef.current = null;
      if (generation !== _loadGeneration) return;
      if (err instanceof DownloadCancelledError) return;
      const msg = err instanceof Error ? err.message : 'Failed to load audio';
      setSnapshot({ state: 'error', errorMessage: msg, surahId });
      return;
    }

    // Fetch timings synchronously here — needed for the seek position AND
    // for the interval-repeat boundary check. Without timings, interval
    // repeat can't work and the seek-to-verse silently starts from 0.
    let timings: VerseTimestamp[] | null = null;
    try {
      timings = await fetchVerseTimings(reciterId, surahId);
      if (generation !== _loadGeneration) return;
      _currentTimings = timings;
    } catch {
      // Timings unavailable — proceed without seek/interval.
    }

    const surahInfo = SURAH_INDEX.find((s) => s.id === surahId);
    const surahName = surahInfo?.nameSimple ?? `Surah ${surahId}`;
    const reciterName = RECITERS.find((r) => r.id === reciterId)?.name ?? '';
    const artworkUri = await resolveArtworkUri();
    if (generation !== _loadGeneration) return;

    await TrackPlayer.add({
      id: `surah-${surahId}`,
      url: uri,
      title: surahName,
      artist: reciterName,
      album: LOCK_SCREEN_ALBUM,
      artwork: artworkUri ?? undefined,
    });
    if (generation !== _loadGeneration) return;
    _activeTrackId = `surah-${surahId}`;

    // Compute start position from timings.
    const startTiming = timings?.find((t) => t.verseKey === startVerseKey);
    const startMs = startTiming?.timestampFrom ?? 0;

    // Mode setup based on repeatSettings + stopAt + continuous.
    const rs = _repeatSettings;
    let nativeLoop = false;
    if (rs?.repeatInterval && canUseNativeLoop(rs, surahId)) {
      // Full-surah infinite interval-repeat — use native AVPlayer loop.
      // No JS in the loop body. Same survival-trick as Step 4 verse-loop.
      nativeLoop = true;
    } else if (rs?.repeatInterval && timings) {
      // Partial range or finite count — set up JS-driven boundary monitor.
      const fromKey = `${rs.fromSurahId}:${rs.fromVerse}`;
      const toKey = `${rs.toSurahId}:${rs.toVerse}`;
      _intervalLoop = {
        fromKey,
        toKey,
        count: rs.repeatCount,
        plays: 0,
        seeking: false,
      };
    }

    // Resolve same-surah stopAt now that timings are loaded.
    if (_pendingStopVerseKey) {
      resolvePendingStopAfterTimings();
    }

    await TrackPlayer.setRepeatMode(nativeLoop ? RepeatMode.Track : RepeatMode.Off);
    if (generation !== _loadGeneration) return;

    // Enable progress events if anything needs them.
    if (needsProgressEvents()) {
      await setProgressEventsEnabled(true);
    } else {
      await setProgressEventsEnabled(false);
    }

    // Seek to the start position BEFORE play() so the user doesn't briefly
    // hear the chapter intro.
    if (startMs > 0) {
      try { await TrackPlayer.seekTo(startMs / 1000); } catch {}
    }
    if (generation !== _loadGeneration) return;

    await TrackPlayer.play();
    if (generation === _loadGeneration) {
      setSnapshot({ state: 'playing' });
    }
  },

  /**
   * Step 4: load a single verse and loop it. For infinite count (count === null)
   * uses RepeatMode.Track so AVPlayer rewinds at end-of-file natively, with
   * zero JS bridge involvement — the failure mode that broke the legacy
   * expo-audio chapter-mode-seek-loop path on locked screens after ~5 cycles.
   *
   * For finite count, RepeatMode.Off + PlaybackQueueEnded handler counts
   * completed plays and re-seeks until the target is reached.
   *
   * verseId === 0 means "the bismillah of this surah" (BSMLLH_${surahId}) and
   * uses the dedicated short bismillah clip we already cache for surah-start
   * playback.
   *
   * Throws VerseUrlUnavailableError when the per-verse audio URL cannot be
   * resolved for the active reciter (CDN pattern mismatch). Caller is
   * responsible for the fallback (typically: disable repeatVerse, surface a
   * notification, resume chapter playback).
   */
  async loadAndLoopVerse(
    surahId: number,
    verseId: number,
    count: number | null,
  ): Promise<void> {
    if (__DEV__) console.error(`[QuranEngine] loadAndLoopVerse(${surahId}, ${verseId}, count=${count ?? '∞'})`);
    await this.init();

    const reciterId = _currentReciterId;
    if (reciterId === null) {
      setSnapshot({ state: 'error', errorMessage: 'No reciter selected' });
      return;
    }

    const generation = ++_loadGeneration;

    // Cancel any in-flight download from a previous load before resetting state.
    _downloadCancelRef.current?.();
    _downloadCancelRef.current = null;

    setSnapshot({
      state: 'loading',
      surahId,
      positionMs: 0,
      durationMs: 0,
      activeVerseKey: null,
      pageNumber: null,
      errorMessage: undefined,
      downloadProgress: undefined,
    });

    // Reset native queue so the lock-screen card transitions cleanly to the
    // verse-loop's metadata when add()+play() runs below.
    try { await TrackPlayer.reset(); } catch {}
    if (generation !== _loadGeneration) return;

    _currentSurahId = surahId;
    _currentTimings = null;
    _activeTrackId = null;
    _verseLoopActive = null;

    // Resolve the per-verse audio URI.
    let uri: string | null = null;
    try {
      if (verseId === 0) {
        uri = await getBismillahAudioUri(reciterId);
      } else {
        uri = await getVerseAudioUri(reciterId, surahId, verseId);
      }
    } catch (resolveErr) {
      // Surface the actual reason — getVerseAudioUri / getBismillahAudioUri
      // both swallow network errors and return null, but they can also throw
      // (e.g. AsyncStorage unavailable, FileSystem permission). Logging this
      // is essential for diagnosing "verse-repeat unavailable" reports.
      const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
      console.warn(`[QuranEngine] verse URI resolve threw: reciter=${reciterId} surah=${surahId} verse=${verseId} err=${msg}`);
      uri = null;
    }
    if (generation !== _loadGeneration) return;

    if (!uri) {
      // Per-verse URL unavailable for this reciter. Most common causes:
      //   • CDN URL pattern mismatch (chapter URL doesn't fit /slug/NNN.mp3)
      //   • Per-verse file 404 on QuranCDN for this reciter+surah+verse
      //   • Network error during the small per-verse download
      //   • Downloaded body < 1KB (HTML error page from CDN)
      // The caller (QuranAudioPlayer) catches this typed error and surfaces
      // a Swedish notification + falls back to chapter playback.
      console.warn(`[QuranEngine] verse URL null → throw VerseUrlUnavailableError: reciter=${reciterId} surah=${surahId} verse=${verseId}`);
      setSnapshot({
        state: 'error',
        errorMessage: 'verse_url_unavailable',
        surahId,
      });
      throw new VerseUrlUnavailableError(reciterId, surahId, verseId);
    }

    // Derive the verse highlight key + initial page number.
    const surahInfo = SURAH_INDEX.find((s) => s.id === surahId);
    const verseKey = verseId === 0 ? `BSMLLH_${surahId}` : `${surahId}:${verseId}`;
    let initialPage = surahInfo?.firstPage ?? 1;

    // For non-bismillah verses, fetch timings async to derive a precise page
    // number. If we already have timings cached for this surah, use them
    // immediately. Either way the verse highlight is correct from the start;
    // only the page may move to the more accurate value when timings resolve.
    if (verseId !== 0) {
      void fetchVerseTimings(reciterId, surahId)
        .then((timings) => {
          if (generation !== _loadGeneration) return;
          const t = timings.find((tt) => tt.verseKey === verseKey);
          if (t && t.pageNumber > 0 && _verseLoopActive?.verseKey === verseKey) {
            _verseLoopActive.pageNumber = t.pageNumber;
            // Push the corrected page through the snapshot so the UI re-syncs.
            setSnapshot({ pageNumber: t.pageNumber });
          }
        })
        .catch(() => undefined);
    }

    const surahName = surahInfo?.nameSimple ?? `Surah ${surahId}`;
    const reciterName = RECITERS.find((r) => r.id === reciterId)?.name ?? '';
    // Lock-screen title shows "Al-Baqarah: 255" for verse loops, just the
    // surah name for bismillah loops (verseId=0).
    const trackTitle = verseId === 0 ? surahName : `${surahName}: ${verseId}`;
    const artworkUri = await resolveArtworkUri();
    if (generation !== _loadGeneration) return;

    await TrackPlayer.add({
      id: `verse-${surahId}-${verseId}`,
      url: uri,
      title: trackTitle,
      artist: reciterName,
      album: LOCK_SCREEN_ALBUM,
      artwork: artworkUri ?? undefined,
    });
    if (generation !== _loadGeneration) return;

    // Seed verse-loop state + active-track id BEFORE play() so the first
    // foreground poll routes the highlight correctly without waiting for
    // PlaybackActiveTrackChanged.
    _verseLoopActive = {
      surahId,
      verseId,
      verseKey,
      pageNumber: initialPage,
      count,
      plays: 0,
    };
    _activeTrackId = `verse-${surahId}-${verseId}`;

    // CRITICAL ORDERING: set repeat mode BEFORE play().
    //   • count === null → RepeatMode.Track. AVQueuePlayer treats end-of-file
    //     as a rewind-to-zero, all inside the audio engine. JS is never woken.
    //     This is what makes 30+ loops on a locked screen survive.
    //   • count > 0     → RepeatMode.Off. PlaybackQueueEnded fires after each
    //     play and our handler counts + re-seeks until target reached.
    // Setting the mode BEFORE play() means iOS sees a stable looping session
    // from the very first audio frame.
    await TrackPlayer.setRepeatMode(count === null ? RepeatMode.Track : RepeatMode.Off);
    if (generation !== _loadGeneration) return;

    await TrackPlayer.play();
    if (generation === _loadGeneration) {
      setSnapshot({ state: 'playing' });
    }
  },

  async pause(): Promise<void> {
    if (!_initialized) return;
    try { await TrackPlayer.pause(); } catch {}
  },

  async resume(): Promise<void> {
    if (!_initialized) return;
    try { await TrackPlayer.play(); } catch {}
  },

  async stop(): Promise<void> {
    // Bump generation so any in-flight load aborts cleanly before its add()/play().
    _loadGeneration++;
    _downloadCancelRef.current?.();
    _downloadCancelRef.current = null;
    if (_initialized) {
      try { await TrackPlayer.reset(); } catch {}
    }
    _currentSurahId = null;
    _currentTimings = null;
    _activeTrackId = null;
    _verseLoopActive = null;
    _stopAtTimestampMs = null;
    _pendingStopVerseKey = null;
    _continuousMode = false;
    _intervalLoop = null;
    _preloadedNextSurahId = null;
    _proactiveSkipInitiated = false;
    // Restore default repeat mode + disable progress events so the next
    // loadAndPlay isn't surprised by leftover state from a verse-loop or
    // interval-repeat session.
    if (_initialized) {
      try { await TrackPlayer.setRepeatMode(RepeatMode.Off); } catch {}
      await setProgressEventsEnabled(false);
    }
    setSnapshot({
      state: 'idle',
      surahId: null,
      positionMs: 0,
      durationMs: 0,
      activeVerseKey: null,
      pageNumber: null,
      errorMessage: undefined,
      downloadProgress: undefined,
    });
  },

  async seekTo(ms: number): Promise<void> {
    if (!_initialized) return;
    try { await TrackPlayer.seekTo(ms / 1000); } catch {}
  },

  async setRate(rate: number): Promise<void> {
    if (!_initialized) return;
    try { await TrackPlayer.setRate(rate); } catch {}
    setSnapshot({ rate });
  },

  /**
   * Skip to next/previous surah. Manual skip exits continuous mode and clears
   * any cross-surah pendingStopVerseKey — the user is taking over navigation.
   */
  async skipSurah(direction: 1 | -1): Promise<void> {
    const surahId = _currentSurahId;
    if (surahId === null) return;
    const next = Math.min(114, Math.max(1, surahId + direction));
    if (next === surahId) return;
    _continuousMode = false;
    _pendingStopVerseKey = null;
    await this.loadAndPlay(next);
  },

  /**
   * Skip to next/previous verse within the current surah. Uses the current
   * timings to find the target verse and seeks the chapter audio there.
   * For verse-loop mode, jumps to looping the next/previous verse instead.
   *
   * Called from the lock-screen remote handler in quranAudioPlaybackService.ts.
   * Must derive the current verse from the LIVE native position rather than
   * _snapshot.activeVerseKey — the snapshot is only updated during foreground
   * polling (which stops when the screen locks), so it can be arbitrarily stale
   * by the time a remote command arrives.
   */
  async skipVerse(direction: 1 | -1): Promise<void> {
    const surahId = _currentSurahId;
    if (surahId === null) return;

    // ── Case 1: verse-loop active → jump to looping the adjacent verse. ──────
    if (_verseLoopActive) {
      const vl = _verseLoopActive;
      const surahInfo = SURAH_INDEX.find((s) => s.id === vl.surahId);
      const lastVerse = surahInfo?.versesCount ?? 1;
      const nextVerse = Math.min(lastVerse, Math.max(1, vl.verseId + direction));
      if (nextVerse === vl.verseId) {
        // At the boundary — cross to the adjacent surah rather than no-op.
        if (direction > 0 && vl.surahId < 114) {
          await this.loadAndLoopVerse(vl.surahId + 1, 1, vl.count);
        } else if (direction < 0 && vl.surahId > 1) {
          const prevSurah = SURAH_INDEX.find((s) => s.id === vl.surahId - 1);
          await this.loadAndLoopVerse(vl.surahId - 1, prevSurah?.versesCount ?? 1, vl.count);
        }
        return;
      }
      await this.loadAndLoopVerse(vl.surahId, nextVerse, vl.count);
      return;
    }

    // ── Case 2: bismillah pre-play track active. ──────────────────────────────
    // Use _activeTrackId (always current, updated by native PlaybackActiveTrackChanged)
    // rather than _snapshot.activeVerseKey (stale when polled from background).
    if (_activeTrackId?.startsWith('bismillah-')) {
      if (direction > 0) {
        await this.loadAndPlayFromVerse(surahId, `${surahId}:1`, null);
      } else if (surahId > 1) {
        await this.loadAndPlay(surahId - 1);
      }
      return;
    }

    // ── Case 3: normal chapter playback. ──────────────────────────────────────
    const timings = _currentTimings;
    if (!timings || timings.length === 0) {
      try { await TrackPlayer.seekTo(0); } catch {}
      return;
    }

    // Fetch the LIVE position from the native player.
    // _snapshot.positionMs (and .activeVerseKey) are only updated by the 250ms
    // foreground poll that stops the moment the screen locks. A lock-screen remote
    // command arrives with a snapshot that may be minutes out of date — seeking
    // from a stale verse would skip to a completely wrong position in the audio.
    let livePositionMs = _snapshot.positionMs;
    try {
      const progress = await TrackPlayer.getProgress();
      livePositionMs = Math.round(progress.position * 1000);
    } catch {
      // getProgress failed — fall back to last snapshot value
    }

    const currentVerse = findCurrentVerse(timings, livePositionMs);
    if (!currentVerse) {
      try { await TrackPlayer.seekTo(0); } catch {}
      return;
    }

    // RemotePrevious restart-verse threshold: if more than 3 s into the current
    // verse, restart it rather than going to the previous one. Matches the
    // behaviour of Apple Music, Spotify, and the on-screen ‹ button.
    if (direction < 0 && !currentVerse.verseKey.startsWith('BSMLLH_')) {
      const intoVerseMs = livePositionMs - currentVerse.timestampFrom;
      if (intoVerseMs > 3000) {
        try { await TrackPlayer.seekTo(currentVerse.timestampFrom / 1000); } catch {}
        return;
      }
    }

    const idx = timings.findIndex((t) => t.verseKey === currentVerse.verseKey);
    if (idx < 0) {
      try { await TrackPlayer.seekTo(0); } catch {}
      return;
    }

    const target = timings[idx + direction];
    if (!target) {
      // Past the edge of this surah.
      if (direction > 0 && surahId < 114) await this.loadAndPlay(surahId + 1);
      else if (direction < 0 && surahId > 1) await this.loadAndPlay(surahId - 1);
      return;
    }

    // BSMLLH_ target: bismillah is a separate short audio clip queued ahead of
    // the chapter file. seekTo(0) on the chapter file is NOT the bismillah —
    // it is verse 1. Reload via loadAndPlay to re-queue [bismillah, surah].
    if (target.verseKey.startsWith('BSMLLH_')) {
      const bsmSurahId = parseInt(target.verseKey.slice('BSMLLH_'.length), 10);
      if (!isNaN(bsmSurahId)) await this.loadAndPlay(bsmSurahId);
      return;
    }

    try { await TrackPlayer.seekTo(target.timestampFrom / 1000); } catch {}
  },
};
