import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { sendLiveNotification } from '../services/notifications';

export const CHANNEL_ID = 'UCQhN1h0T-02TYWf-mD3-2hQ';
const CACHE_KEY    = 'yt_stream_cache_v2';
// Persisted across app restarts so we never re-notify for the same live videoId.
const NOTIFIED_KEY = 'yt_notified_video_id';
const ENDPOINT     = 'https://yqtnwgezqbznbpeooott.supabase.co/functions/v1/youtube-streams';

export type YTStream = {
  status: 'live' | 'upcoming';
  videoId: string;
  title: string;
  thumbnail: string | null;
  thumbnailLocal: string | null;  // local file:// path, loaded instantly from disk
  scheduledStart?: string | null;
};

// Download thumbnail to local cache and return the file:// path.
// Keyed by videoId so a new stream always gets a fresh download.
async function cacheThumbnail(videoId: string, remoteUrl: string): Promise<string | null> {
  try {
    const path = `${FileSystem.cacheDirectory}yt_thumb_${videoId}.jpg`;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) return path;  // already cached
    const result = await FileSystem.downloadAsync(remoteUrl, path);
    return result.status === 200 ? result.uri : null;
  } catch {
    return null;
  }
}

// Returns true when an upcoming stream's scheduled time has passed by >90 minutes
// AND the stream is still labelled "upcoming" (never transitioned to "live").
//
// 90 min gives the Edge Function plenty of time to detect a late-starting broadcast
// (real live streams transition to status="live" well within 30 min of going on air).
// Streams genuinely on air always have status="live" and are never filtered here.
function isStaleUpcoming(stream: YTStream | null | undefined): boolean {
  if (!stream || stream.status !== 'upcoming' || !stream.scheduledStart) return false;
  return new Date(stream.scheduledStart).getTime() < Date.now() - 90 * 60_000;
}

function pollInterval(stream: YTStream | null): number {
  if (!stream) return 3 * 60 * 60 * 1000;
  if (stream.status === 'live') return 60 * 1000;
  if (stream.status === 'upcoming' && stream.scheduledStart) {
    const ms = new Date(stream.scheduledStart).getTime() - Date.now();
    if (ms < 0)              return 60 * 1000;
    if (ms < 30 * 60_000)   return 3 * 60_000;
    if (ms < 6 * 3_600_000) return 15 * 60_000;
    return 60 * 60_000;
  }
  return 3 * 60 * 60 * 1000;
}

async function fetchStream(): Promise<YTStream | null> {
  const res = await fetch(ENDPOINT);
  if (!res.ok) {
    console.warn('[YT] endpoint error:', res.status);
    return null;
  }
  const json = await res.json();

  // Live stream takes priority
  const live = json.live?.[0];
  if (live?.videoId) {
    return {
      status:         'live',
      videoId:        live.videoId,
      title:          live.title ?? 'Direktsändning',
      thumbnail:      live.thumbnail ?? null,
      thumbnailLocal: null,
      scheduledStart: live.actualStartTime ?? null,
    };
  }

  // Upcoming stream
  const upcoming = json.upcoming?.[0];
  if (upcoming?.videoId) {
    return {
      status:         'upcoming',
      videoId:        upcoming.videoId,
      title:          upcoming.title ?? 'Kommande sändning',
      thumbnail:      upcoming.thumbnail ?? null,
      thumbnailLocal: null,
      scheduledStart: upcoming.scheduledStartTime ?? null,
    };
  }

  return null;
}

export function useYoutubeLive() {
  const [stream,   setStream]   = useState<YTStream | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const timerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchTs        = useRef<number>(0);
  // FIX 1: ref always reflects the latest stream so AppState listener never reads stale state
  const streamRef          = useRef<YTStream | null>(null);
  // FIX 2: track last videoId we notified about so we only fire once per unique live stream
  const notifiedVideoIdRef = useRef<string | null>(null);
  // Safety: prevent state updates after unmount
  const mountedRef         = useRef(true);

  function scheduleNext(current: YTStream | null) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doFetch(), pollInterval(current));
  }

  async function doFetch() {
    try {
      setApiError(null);
      let result = await fetchStream();
      if (!mountedRef.current) return;

      // Discard upcoming streams whose scheduled time has passed.
      // If a stream is still "upcoming" 15+ min after its scheduled start, it
      // either never went live or the Edge Function cache is stale — hide it.
      if (isStaleUpcoming(result)) result = null;

      // Only notify once per unique videoId — ref is pre-loaded from AsyncStorage
      // on mount so this holds across app restarts, not just within a session.
      if (result?.status === 'live' && result.videoId !== notifiedVideoIdRef.current) {
        notifiedVideoIdRef.current = result.videoId;
        AsyncStorage.setItem(NOTIFIED_KEY, result.videoId); // fire-and-forget persist
        await sendLiveNotification(result.videoId, result.title);
      }

      // Cache thumbnail locally so subsequent renders load from disk instantly
      if (result?.thumbnail && result.videoId) {
        const local = await cacheThumbnail(result.videoId, result.thumbnail);
        if (local) result = { ...result, thumbnailLocal: local };
      }

      // FIX 1: keep ref in sync with state so AppState listener always has current value
      streamRef.current = result;
      setStream(result);
      lastFetchTs.current = Date.now();
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ data: result, ts: Date.now() }));
      scheduleNext(result);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : 'Okänt fel';
      console.warn('[useYoutubeLive] fetch error:', msg);
      setApiError(msg);
      if (timerRef.current) clearTimeout(timerRef.current);
      // Error back-off: retry in 5 minutes — polling must never permanently stop
      timerRef.current = setTimeout(() => doFetch(), 5 * 60 * 1000);
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    // 1. Load cache + persisted notified videoId in parallel.
    //    doFetch() is called only after both are ready so notifiedVideoIdRef is
    //    correctly initialised before the first live-check runs — this prevents
    //    re-notifying for the same videoId after an app restart.
    Promise.all([
      AsyncStorage.getItem(CACHE_KEY),
      AsyncStorage.getItem(NOTIFIED_KEY),
    ]).then(([rawCache, notifiedId]) => {
      if (!mountedRef.current) return;

      // Restore the last-notified videoId so we don't spam on app reopen.
      if (notifiedId) notifiedVideoIdRef.current = notifiedId;

      // Show cached stream immediately while the fresh fetch is in flight.
      // Apply the same stale-upcoming filter so a past broadcast never flashes
      // on screen before doFetch() has a chance to return null.
      if (rawCache) {
        try {
          const { data, ts } = JSON.parse(rawCache) as { data: YTStream | null; ts: number };
          if (data && !isStaleUpcoming(data)) {
            streamRef.current  = data;
            setStream(data);
            lastFetchTs.current = ts;
          }
        } catch {}
      }

      // 2. Fetch fresh data now that the ref is properly initialised.
      doFetch();
    });

    // 3. Pause/resume polling on app background/foreground
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        // Clear any lingering timer to avoid double-scheduling
        if (timerRef.current) clearTimeout(timerRef.current);
        const age      = Date.now() - lastFetchTs.current;
        // FIX 1: use streamRef.current, not the stale `stream` closure value
        const interval = pollInterval(streamRef.current);
        if (age >= interval) {
          // Data is stale — fetch immediately
          doFetch();
        } else {
          // FIX 4: data is still fresh — reschedule for remaining time so polling never dies
          timerRef.current = setTimeout(() => doFetch(), interval - age);
        }
      } else {
        // App going to background — clear timer to pause polling
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    });

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      sub.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose a stable refresh function so callers (e.g. pull-to-refresh) can
  // trigger an immediate fetch. Clears the pending poll timer first so we
  // don't double-schedule. doFetch only uses refs so the empty dep array is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    doFetch();
  }, []);

  return {
    stream,
    apiError,
    isLive:     stream?.status === 'live',
    isUpcoming: stream?.status === 'upcoming',
    refresh,
  };
}
