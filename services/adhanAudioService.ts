/**
 * adhanAudioService.ts
 *
 * Local-asset adhan playback for the **settings preview** only.
 *
 * Production playback path (when a prayer notification fires):
 *   The notification carries a bundled iOS sound (CAF in
 *   `ios/Hidayah/Sounds/`, registered in `ios/Hidayah.xcodeproj/project.pbxproj`).
 *   iOS plays it natively — works even when the app is killed and when the
 *   device is locked. This file is NOT involved in that path.
 *
 * Why this still exists:
 *   The settings UI lets the user preview a reciter clip before committing to
 *   the mode. That preview plays an mp3 from the JS bundle via expo-audio. The
 *   underlying mp3s are also kept around even though only the first 30 s are
 *   used in iOS notifications — the longer JS-side clip gives a nicer preview.
 *
 * Everything is bundled — there is NO network fetch. Files live in
 * assets/audio/adhan/ and are referenced via `require()` so Metro bakes them
 * into the JS bundle.
 *
 * Architecture:
 *   - Single shared player (`activePlayer`). A new `playAdhan(...)` call stops
 *     the previous one before starting a new track.
 *   - We do NOT call `setAudioModeAsync` here — the app configures the audio
 *     session once at startup in app/_layout.tsx with
 *     `shouldPlayInBackground: true` and `playsInSilentMode: true`.
 *   - `stopAdhan()` is idempotent and cleans up the player + the finished
 *     listener so the next call starts from a clean slate.
 *   - Adding a new reciter is one line in `ADHAN_AUDIO_ASSETS`.
 */

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import {
  type AdhanReciter,
} from '../types/prayerNotificationTypes';

// ── Bundled asset map (preview only) ─────────────────────────────────────────
// Only the short clips are still bundled in the JS bundle for preview. The
// long clips have been removed from the mode list — see prayerNotificationTypes.ts.
const ADHAN_AUDIO_ASSETS: Record<AdhanReciter, number> = {
  medina:   require('../assets/audio/adhan/medina_short.mp3'),
  mecca:    require('../assets/audio/adhan/mecca_short.mp3'),
  egyptian: require('../assets/audio/adhan/egyptian_short.mp3'),
  turkish:  require('../assets/audio/adhan/turkish_short.mp3'),
};

/** Returns the require() asset id for a reciter's preview clip. */
export function getAdhanAssetSource(reciter: AdhanReciter): number {
  return ADHAN_AUDIO_ASSETS[reciter];
}

// ── Single active player ─────────────────────────────────────────────────────
type ActivePlayback = {
  player:   AudioPlayer;
  reciter:  AdhanReciter;
  /** Optional tag the caller can attach to identify which UI element owns this
   *  playback (e.g. "preview:Fajr"). Surfaced via `getActiveAdhanTag()` so the
   *  settings UI can render a stop button on the right row. */
  tag:      string | null;
  startedAt: number;
};

let active: ActivePlayback | null = null;

const playbackListeners = new Set<(tag: string | null) => void>();

function notifyPlaybackListeners(): void {
  const tag = active?.tag ?? null;
  playbackListeners.forEach(fn => {
    try { fn(tag); } catch {}
  });
}

/** Subscribe to playback state changes. The callback receives the active tag
 *  (or `null` when no adhan is playing). Returns an unsubscribe function. */
export function subscribeAdhanPlayback(fn: (tag: string | null) => void): () => void {
  playbackListeners.add(fn);
  return () => { playbackListeners.delete(fn); };
}

/** Returns the tag of the currently playing adhan, or `null` if none. */
export function getActiveAdhanTag(): string | null {
  return active?.tag ?? null;
}

function teardownActive(): void {
  if (!active) return;
  const { player } = active;
  active = null;
  try { player.pause(); } catch {}
  try { player.remove(); } catch {}
  notifyPlaybackListeners();
}

/** Stops any currently playing adhan and releases the player. Idempotent. */
export function stopAdhan(): void {
  teardownActive();
}

/** True if an adhan is currently playing (or paused but still loaded). */
export function isAdhanPlaying(): boolean {
  return active !== null;
}

/**
 * Plays a local adhan preview clip for the given reciter.
 *
 * Stops any previous playback first — two previews triggered close together
 * will never overlap. The previous track is paused and released cleanly before
 * the new one starts so iOS audio session never holds two active players.
 *
 * Used by the settings UI only. Production prayer notifications play the
 * bundled iOS sound directly via the notification payload — see
 * `services/notifications.ts` and `types/prayerNotificationTypes.ts`.
 */
export function playAdhan(reciter: AdhanReciter, tag: string | null = null): void {
  const source = ADHAN_AUDIO_ASSETS[reciter];
  if (source === undefined) return;

  // Stop the previous track cleanly before starting the new one.
  teardownActive();

  const player = createAudioPlayer(source);
  const playback: ActivePlayback = { player, reciter, tag, startedAt: Date.now() };
  active = playback;

  player.addListener('playbackStatusUpdate', status => {
    // didJustFinish fires once when the track reaches the end. Release the
    // player so the next preview doesn't share state with this one.
    if (status.didJustFinish && active === playback) {
      teardownActive();
    }
  });

  try {
    player.play();
    notifyPlaybackListeners();
  } catch {
    // If play() throws (rare — bad asset, corrupted bundle), drop the player
    // so the next call doesn't trip the "previous still loaded" guard.
    teardownActive();
  }
}
