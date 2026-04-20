/**
 * YoutubeBackgroundPlayer — single-WebView YouTube player
 *
 * This is the ONLY WebView used for YouTube playback. There is no separate
 * "inline" WebView in YoutubeCard. Having two WebViews playing the same stream
 * simultaneously caused iOS WKWebView to compete for the AVAudioSession, which
 * reliably dropped audio in the visible player after a few seconds.
 *
 * Two modes:
 *
 *   Inline (inlineFrame != null):
 *     The WebView is positioned at the card's screen coordinates and visible.
 *     Controls (✕ close, "Spela i bakgrunden") are rendered as overlays.
 *     On first entry to inline mode the WebView is unmuted via JS injection.
 *
 *   Background (inlineFrame == null, videoId != null):
 *     The WebView is positioned off-screen to the left (left: -screenWidth).
 *     It has non-zero dimensions so iOS layout engine keeps its WKWebView
 *     process alive and audio continues under the lock screen.
 *     Audio is unmuted (was already unmuted when the user first watched inline).
 *
 * The WebView starts with mute=1 in the embed URL. It is unmuted via JS the
 * first time the user enters inline mode (null → non-null inlineFrame). If the
 * user goes directly to background mode without watching inline first, the audio
 * remains muted until inline mode is entered at least once. This matches the
 * expected UX: audio only starts after the user explicitly taps "Titta".
 */

import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Svg, { Path } from 'react-native-svg';
import { useYoutubePlayer } from '../context/YoutubePlayerContext';

const YT_BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Starts MUTED (mute=1) — unmuted via JS when user enters inline mode for the
// first time. autoplay=1 so the stream connects and buffers immediately, giving
// instant audio when the user taps "Titta" or "Spela i bakgrunden".
function buildEmbedHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
<style>*{margin:0;padding:0}html,body{width:100%;height:100%;background:#000;overflow:hidden}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none}</style>
</head>
<body>
<iframe id="ytplayer"
  src="https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1&autoplay=1&mute=1"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen></iframe>
</body>
</html>`;
}

const JS_PAUSE = `
(function(){try{
  document.querySelector('iframe').contentWindow.postMessage(
    JSON.stringify({event:'command',func:'pauseVideo',args:[]}), '*');
}catch(e){}}()); true;
`;
const JS_PLAY = `
(function(){try{
  document.querySelector('iframe').contentWindow.postMessage(
    JSON.stringify({event:'command',func:'playVideo',args:[]}), '*');
}catch(e){}}()); true;
`;
const JS_UNMUTE = `
(function(){try{
  var w = document.querySelector('iframe').contentWindow;
  w.postMessage(JSON.stringify({event:'command',func:'unMute',args:[]}), '*');
  w.postMessage(JSON.stringify({event:'command',func:'setVolume',args:[100]}), '*');
}catch(e){}}()); true;
`;

export default function YoutubeBackgroundPlayer() {
  const { videoId, isPlaying, stop, inlineFrame, setInlineFrame } = useYoutubePlayer();
  const webViewRef    = useRef<WebView>(null);
  const { width }     = useWindowDimensions();

  const [webViewLoaded, setWebViewLoaded] = useState(false);
  const [webViewError,  setWebViewError]  = useState(false);
  const [retryKey,      setRetryKey]      = useState(0);

  // Mirror inlineFrame in a ref so onLoad callback reads the current value
  // without being stale (onLoad closes over the value at component render time).
  const inlineFrameRef = useRef(inlineFrame);
  useEffect(() => { inlineFrameRef.current = inlineFrame; }, [inlineFrame]);

  // Track whether we've unmuted at least once. Prevents re-injecting JS on
  // every render and ensures the WebView stays unmuted in background mode.
  const unmutedRef = useRef(false);

  const unmutePlayer = () => {
    webViewRef.current?.injectJavaScript(JS_PLAY);
    webViewRef.current?.injectJavaScript(JS_UNMUTE);
    unmutedRef.current = true;
  };

  // Unmute on first inline entry (null → non-null inlineFrame).
  const prevInlineRef = useRef<typeof inlineFrame>(null);
  useEffect(() => {
    const wasNull = prevInlineRef.current === null;
    const isNowSet = inlineFrame !== null;
    prevInlineRef.current = inlineFrame;

    if (isNowSet && wasNull) {
      // Entering inline for the first time in this session → unmute.
      unmutePlayer();
    }
    // Going from inline → background (isNowSet=false): keep unmuted.
    // The audio continues off-screen — that IS the background mode.
  }, [inlineFrame]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause/resume when isPlaying changes (e.g. dhikr/Quran player pauses YouTube).
  const prevPlayingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevPlayingRef.current === isPlaying) return;
    prevPlayingRef.current = isPlaying;
    if (!videoId) return;
    webViewRef.current?.injectJavaScript(isPlaying ? JS_PLAY : JS_PAUSE);
  }, [isPlaying, videoId]);

  // Reset load state when the WebView is remounted (videoId or retryKey changes).
  useEffect(() => {
    setWebViewLoaded(false);
    setWebViewError(false);
    unmutedRef.current = false;
    prevPlayingRef.current = null;
  }, [videoId, retryKey]);

  // No stream — render nothing.
  if (!videoId) return null;

  const isInline = inlineFrame !== null;

  const containerStyle = isInline
    ? {
        position: 'absolute' as const,
        top: inlineFrame.top,
        left: inlineFrame.left,
        width: inlineFrame.width,
        height: inlineFrame.height,
        zIndex: 100,
        borderRadius: 16,
        overflow: 'hidden' as const,
      }
    : {
        position: 'absolute' as const,
        left: -width,
        top: 0,
        width,
        height: 200,
      };

  return (
    <View
      style={containerStyle}
      // Allow touches when inline (controls), block pass-through when off-screen.
      pointerEvents={isInline ? 'box-none' : 'none'}
    >
      <WebView
        ref={webViewRef}
        key={retryKey}
        source={{ html: buildEmbedHtml(videoId), baseUrl: 'https://www.youtube-nocookie.com' }}
        style={{ flex: 1, backgroundColor: '#000' }}
        userAgent={YT_BROWSER_UA}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        onLoadStart={() => { setWebViewLoaded(false); setWebViewError(false); }}
        onLoad={() => {
          setWebViewLoaded(true);
          // WebView may have loaded after inlineFrame was already set (slow network).
          // Re-inject unmute if we're in inline mode — the mute=1 param resets on reload.
          if (inlineFrameRef.current !== null) {
            unmutePlayer();
          }
        }}
        onError={() => { setWebViewLoaded(false); setWebViewError(true); }}
        onShouldStartLoadWithRequest={(req) =>
          req.url === 'about:blank' ||
          req.url.startsWith('https://www.youtube-nocookie.com') ||
          req.url.startsWith('https://www.youtube.com') ||
          req.url.startsWith('https://youtube.com')
        }
      />

      {/* Controls and overlays — only rendered in inline mode */}
      {isInline && (
        <>
          {/* Loading spinner */}
          {!webViewLoaded && !webViewError && (
            <View style={[StyleSheet.absoluteFill, styles.overlay]}>
              <ActivityIndicator color="#FF3B30" size="large" />
            </View>
          )}

          {/* Error state */}
          {webViewError && (
            <View style={[StyleSheet.absoluteFill, styles.overlay, { gap: 12 }]}>
              <Text style={styles.errorText}>Kunde inte ladda videon</Text>
              <TouchableOpacity
                onPress={() => { setWebViewError(false); setWebViewLoaded(false); setRetryKey((k) => k + 1); }}
                activeOpacity={0.75}
                style={styles.retryBtn}
              >
                <Text style={styles.retryBtnText}>Försök igen</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ✕ — close and stop playback entirely */}
          <TouchableOpacity
            onPress={stop}
            activeOpacity={0.8}
            style={styles.closeBtn}
          >
            <Svg width={12} height={12} viewBox="0 0 14 14" fill="none">
              <Path d="M1 1l12 12M13 1L1 13" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>

          {/* "Spela i bakgrunden" — move WebView off-screen, audio continues */}
          <TouchableOpacity
            onPress={() => setInlineFrame(null)}
            activeOpacity={0.8}
            style={styles.bgBtn}
          >
            <View style={styles.bgDot} />
            <Text style={styles.bgBtnText}>Spela i bakgrunden</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    zIndex: 10,
  },
  errorText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
  },
  retryBtn: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  closeBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgBtn: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  bgDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34C759',
  },
  bgBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});
