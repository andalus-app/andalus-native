/**
 * quranAudioPlaybackService.ts
 *
 * react-native-track-player's required playback service callback.
 *
 * This function is registered from index.js BEFORE the React tree mounts.
 * It runs in the same JS context as the rest of the app on iOS (RNTP does
 * not spawn a separate context on iOS — the comment about "headless task"
 * in the docs applies to Android only).
 *
 * Its sole responsibility is to attach event listeners for remote-control
 * events (lock-screen / Control Center / CarPlay / AirPods buttons) and
 * forward them to TrackPlayer commands. iOS surfaces these through
 * MPRemoteCommandCenter; RNTP wires the Capability.* enums declared in
 * QuranAudioEngine.init() into MPRemoteCommandCenter and re-emits them
 * here as Event.Remote* JS events.
 *
 * RULES:
 *   - No React, no JSX, no UI imports. This file is loaded before the
 *     React tree exists.
 *   - For Quran-specific routing (next/previous = next/previous SURAH, not
 *     next/previous TRACK in the queue), import from QuranAudioEngine.
 *   - Each handler must `await` the TrackPlayer/engine call so the JS
 *     thread yields back to the event loop quickly. Long-running work in
 *     remote handlers can cause iOS to think the command failed.
 */

import TrackPlayer, { Event } from 'react-native-track-player';
import { QuranAudioEngine } from './quranAudioEngine';

export async function PlaybackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    if (__DEV__) console.error('[QuranEngine] remote: play');
    await TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    if (__DEV__) console.error('[QuranEngine] remote: pause');
    await TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    if (__DEV__) console.error('[QuranEngine] remote: stop');
    await QuranAudioEngine.stop();
  });

  // Lock-screen "next track" → next VERSE (Quran-reader semantic).
  // Engine.skipVerse(1) seeks the chapter audio to the next verse's
  // timestamp; for verse-loop mode it jumps to looping the next verse.
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    if (__DEV__) console.error('[QuranEngine] remote: next verse');
    try {
      await QuranAudioEngine.skipVerse(1);
    } catch {}
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    if (__DEV__) console.error('[QuranEngine] remote: previous verse');
    try {
      await QuranAudioEngine.skipVerse(-1);
    } catch {}
  });

  // Lock-screen scrub bar drag.
  TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
    if (__DEV__) console.error(`[QuranEngine] remote: seek to ${event?.position}s`);
    if (typeof event?.position === 'number') {
      await TrackPlayer.seekTo(event.position);
    }
  });

  // Jump-15s buttons are NOT declared in capabilities, so iOS doesn't show
  // them — but RNTP still emits these events from CarPlay/AirPods/external
  // accessories. Wire to skipVerse so behavior is consistent regardless of
  // which physical button the user uses.
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async () => {
    if (__DEV__) console.error('[QuranEngine] remote: jump fwd → next verse');
    try {
      await QuranAudioEngine.skipVerse(1);
    } catch {}
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async () => {
    if (__DEV__) console.error('[QuranEngine] remote: jump back → previous verse');
    try {
      await QuranAudioEngine.skipVerse(-1);
    } catch {}
  });
}
