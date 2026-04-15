import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import { setAudioModeAsync } from 'expo-audio';

type YoutubePlayerContextValue = {
  videoId: string | null;
  isPlaying: boolean;
  play: (videoId: string) => void;
  pause: () => void;
  stop: () => void;
};

const YoutubePlayerContext = createContext<YoutubePlayerContextValue | null>(null);

// Module-level pause hook — lets dhikr AudioPlayer and QuranAudioPlayer pause
// YouTube without needing to import or use the context directly.
// Pattern from CLAUDE.md: refs for values needed inside stable callbacks.
let _pauseFn: (() => void) | null = null;

export function pauseYoutubePlayer(): void {
  _pauseFn?.();
}

export function YoutubePlayerProvider({ children }: { children: React.ReactNode }) {
  const [videoId, setVideoId]     = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const play = useCallback((id: string) => {
    // Configure and activate AVAudioSession BEFORE the WebView loads so iOS
    // knows this app owns a background audio session. Without this, the screen
    // lock suspends WKWebView audio even when UIBackgroundModes:audio is set.
    // InterruptionModeIOS.DoNotMix: pause other apps' audio (e.g. Music app).
    setAudioModeAsync({
      shouldPlayInBackground: true,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
    setVideoId(id);
    setIsPlaying(true);
  }, []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const stop  = useCallback(() => { setVideoId(null); setIsPlaying(false); }, []);

  // Register the stable pause fn for module-level callers.
  useEffect(() => {
    _pauseFn = pause;
    return () => { if (_pauseFn === pause) _pauseFn = null; };
  }, [pause]);

  const value = useMemo<YoutubePlayerContextValue>(
    () => ({ videoId, isPlaying, play, pause, stop }),
    [videoId, isPlaying, play, pause, stop],
  );

  return (
    <YoutubePlayerContext.Provider value={value}>
      {children}
    </YoutubePlayerContext.Provider>
  );
}

export function useYoutubePlayer(): YoutubePlayerContextValue {
  const ctx = useContext(YoutubePlayerContext);
  if (!ctx) throw new Error('useYoutubePlayer must be inside YoutubePlayerProvider');
  return ctx;
}
