/**
 * RuqyahYouTubePlayer
 *
 * Inline YouTube player using react-native-webview.
 * Renders the video inside a full HTML document with an <iframe> —
 * required because YouTube's embed API rejects direct URI requests
 * (produces Error 153 "video player configuration error").
 *
 * source={{ html }} tells the WebView to render local HTML content,
 * which then loads the YouTube iframe embed correctly.
 */

import React, { useState, memo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { RO, RO_DIM, RO_TEXT_ON } from './ruqyahColors';
import { pauseYoutubePlayer } from '../../context/YoutubePlayerContext';

// ── helpers ───────────────────────────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/**
 * Build a self-contained HTML page that embeds the YouTube iframe.
 *
 * Uses youtube-nocookie.com to avoid Error 152/153:
 *   - youtube-nocookie.com is YouTube's privacy-enhanced embed domain;
 *     it relaxes bot-detection checks that block WebView clients.
 *   - Combined with a real browser User-Agent and domStorageEnabled,
 *     this lets YouTube's player JS initialize correctly.
 *
 * iframe params:
 *   playsinline=1     — iOS: keep playback inline, not fullscreen
 *   rel=0             — suppress unrelated recommendations
 *   modestbranding=1  — minimal YouTube chrome
 *   enablejsapi=1     — allow player API
 */
function buildEmbedHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
    iframe {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <iframe
    src="https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen>
  </iframe>
</body>
</html>`;
}

// Real mobile browser UA — prevents YouTube from treating the WebView as a bot
const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ── component ─────────────────────────────────────────────────────────────────

type Props = { youtubeUrl: string };

function RuqyahYouTubePlayer({ youtubeUrl }: Props) {
  const { theme: T } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [retry, setRetry]     = useState(0);

  const videoId = extractYouTubeId(youtubeUrl);

  if (!videoId) {
    return (
      <View style={[styles.errorBox, { backgroundColor: T.card, borderColor: T.border }]}>
        <SvgIcon name="play" size={22} color={T.textMuted} />
        <Text style={[styles.errorText, { color: T.textMuted }]}>
          Videon kunde inte laddas
        </Text>
      </View>
    );
  }

  const html = buildEmbedHtml(videoId);

  return (
    <View style={styles.wrapper}>
      {/* Loading overlay — shown until iframe fires onLoad */}
      {loading && !error && (
        <View style={[StyleSheet.absoluteFill, styles.overlay]}>
          <ActivityIndicator color={RO} size="large" />
        </View>
      )}

      {/* Error state */}
      {error && (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: 'rgba(0,0,0,0.85)' }]}>
          <SvgIcon name="play" size={28} color={T.textMuted} />
          <Text style={[styles.errorText, { color: T.textMuted, marginTop: 10 }]}>
            Kunde inte ladda videon
          </Text>
          <TouchableOpacity
            onPress={() => { setError(false); setLoading(true); setRetry((r) => r + 1); }}
            style={[styles.retryBtn, { backgroundColor: RO, borderColor: RO }]}
            activeOpacity={0.75}
          >
            <Text style={[styles.retryText, { color: RO_TEXT_ON }]}>Försök igen</Text>
          </TouchableOpacity>
        </View>
      )}

      <WebView
        key={retry}
        // source={{ html }} — embed as local HTML, not a URI — fixes Error 153
        // baseUrl must match embed domain so YouTube's CSP accepts the origin
        source={{ html, baseUrl: 'https://www.youtube-nocookie.com' }}
        style={styles.webview}
        // Real mobile browser UA — prevents YouTube treating WebView as a bot (fixes Error 152)
        userAgent={BROWSER_UA}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        // domStorageEnabled required for YouTube player JS to initialise correctly
        domStorageEnabled
        // thirdPartyCookiesEnabled required on Android for youtube-nocookie.com
        thirdPartyCookiesEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        onLoadStart={() => { setLoading(true); setError(false); }}
        onLoad={() => { setLoading(false); pauseYoutubePlayer(); }}
        onError={() => { setLoading(false); setError(true); }}
        // Only allow navigation within YouTube — blocks accidental external links
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

// ── styles ────────────────────────────────────────────────────────────────────

const PLAYER_HEIGHT = 210;

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    height: PLAYER_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 10,
  },
  errorBox: {
    height: PLAYER_HEIGHT,
    borderRadius: 12,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

export default memo(RuqyahYouTubePlayer);
