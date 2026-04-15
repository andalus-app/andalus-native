/**
 * YoutubeBackgroundPlayer
 *
 * Persistent WebView mounted at root layout level — outside the tab/stack
 * navigators so iOS never considers it "off-screen" and suspends its JavaScript.
 *
 * Positioning trick: the View is placed to the LEFT of the visible screen
 * (left: -width) with real dimensions (width × 200). WKWebView continues
 * executing JS and playing audio for off-screen views that have non-zero size
 * and are part of the visible view hierarchy (just not within the viewport).
 *
 * Pause/resume: sent via postMessage to the YouTube iframe player API
 * (requires enablejsapi=1 in the embed URL, already present).
 *
 * When videoId is null (stopped), the component renders nothing so no
 * WebView is kept alive unnecessarily.
 */

import React, { useRef, useEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { useYoutubePlayer } from '../context/YoutubePlayerContext';

const YT_BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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
  src="https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1&autoplay=1"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  allowfullscreen></iframe>
</body>
</html>`;
}

// JavaScript injected into the WebView to control playback via the YouTube
// iframe player API. The postMessage approach works without the full JS API
// bootstrap — the iframe's content window responds to these commands.
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

export default function YoutubeBackgroundPlayer() {
  const { videoId, isPlaying } = useYoutubePlayer();
  const webViewRef    = useRef<WebView>(null);
  const { width }     = useWindowDimensions();
  // Track previous isPlaying so we only inject JS on actual changes.
  const prevPlayingRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (prevPlayingRef.current === isPlaying) return;
    prevPlayingRef.current = isPlaying;
    if (!videoId) return;
    // WebView may not have finished loading on the first play — the autoplay=1
    // param handles the initial start. After that, inject pause/play as needed.
    webViewRef.current?.injectJavaScript(isPlaying ? JS_PLAY : JS_PAUSE);
  }, [isPlaying, videoId]);

  // No stream selected → render nothing.
  if (!videoId) return null;

  return (
    <View
      style={{
        position: 'absolute',
        // Off the left edge of the screen: mounted + visible to iOS layout
        // engine (non-zero size) but not visible to the user.
        left: -width,
        top: 0,
        width,
        height: 200,
      }}
      pointerEvents="none"
    >
      <WebView
        ref={webViewRef}
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
        onShouldStartLoadWithRequest={(req) =>
          req.url === 'about:blank' ||
          req.url.startsWith('https://www.youtube-nocookie.com') ||
          req.url.startsWith('https://www.youtube.com') ||
          req.url.startsWith('https://youtube.com')
        }
      />
    </View>
  );
}
