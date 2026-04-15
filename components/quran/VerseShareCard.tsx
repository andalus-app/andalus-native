/**
 * VerseShareCard.tsx
 *
 * Renders an elegant verse share image at Instagram portrait ratio (1080×1350)
 * using a hidden WebView + HTML Canvas. No native modules required beyond
 * react-native-webview (already installed) and expo-sharing + expo-file-system.
 *
 * NOTE: QCF V2 page fonts use Private Use Area codepoints that CANNOT be
 * embedded into the SVG foreignObject → canvas capture pipeline. The font
 * is never serialized into the SVG, so PUA glyphs render as boxes/gibberish.
 * We use text_uthmani (standard Unicode Arabic) instead — it renders correctly
 * with iOS system Arabic fonts (Geeza Pro). The verse-end marker is added
 * using standard Unicode: ﴿١٧﴾ (ornate parentheses + Arabic-Indic numerals).
 */

import React, { useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

// ── Types ────────────────────────────────────────────────────────────────────

export type VerseShareData = {
  verseKey: string;        // e.g. "2:255"
  arabicText: string;      // text_uthmani — standard Unicode Arabic
  translation: string | null;
  surahName: string;       // e.g. "Al-Baqarah"
  surahNameArabic: string; // e.g. "البقرة"
  verseNumber: number;
};

export type VerseShareCardRef = {
  capture: (data: VerseShareData) => Promise<void>;
};

// ── Hidayah monogram logo ────────────────────────────────────────────────────
// Gold gradient on white rounded rect background for share cards

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
  <rect width="56" height="56" rx="14" fill="#fff"/>
  <svg x="6" y="6" width="44" height="44" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0" stop-color="#EBC78C"/>
        <stop offset="0.5" stop-color="#C2A676"/>
        <stop offset="1" stop-color="#9A7F54"/>
      </linearGradient>
    </defs>
    <path fill="url(#hg)" d="M256,0C114.6,0,0,114.6,0,256s114.6,256,256,256s256-114.6,256-256S397.4,0,256,0z M256,368c-5.1,0-9.8-1.1-14.1-3.2c-4.3-2.1-7.9-5-10.7-8.6l-50.5-62.1L125,417c-2.3,3.7-5.5,6.7-9.5,8.8c-4,2.2-8.5,3.2-13.5,3.2c-5.1,0-9.9-1.2-14.2-3.4s-7.8-5.2-10.4-8.8c-2.6-3.6-4.3-7.5-5-11.6c-0.7-4.1-0.8-8.2-0.2-12.2l40-272l3.4-33c0.2-2.3,0.5-4.5,1.1-6.7c0.6-2.2,1.5-4.3,2.7-6.2c1.2-1.9,2.7-3.6,4.5-5.1c1.8-1.5,4-2.6,6.4-3.4c2.4-0.8,5.1-1.2,7.9-1.2c2.8,0,5.5,0.4,8,1.2c2.5,0.8,4.7,1.9,6.5,3.4c1.8,1.5,3.3,3.2,4.5,5.1s2.1,4.1,2.7,6.3c0.6,2.2,0.9,4.4,1.1,6.7l3.4,33l40,272l25.5,31.4l25.5-31.4l40-272l3.4-33c0.2-2.3,0.5-4.5,1.1-6.7c0.6-2.2,1.5-4.3,2.7-6.3c1.2-1.9,2.7-3.6,4.5-5.1c1.8-1.5,4-2.6,6.4-3.4c2.4-0.8,5.1-1.2,7.9-1.2s5.5,0.4,8,1.2c2.5,0.8,4.7,1.9,6.5,3.4c1.8,1.5,3.3,3.2,4.5,5.1s2.1,4.1,2.7,6.3c0.6,2.2,0.9,4.4,1.1,6.7l3.4,33l40,272l25.5,31.4l50.5,62.1c2.8,3.6,6.4,6.4,10.7,8.6s9,3.2,14.1,3.2s9.8-1.1,14.1-3.2s7.9-5,10.7-8.6l10-12.2c2.8-3.6,4.5-7.5,5.2-11.6c0.7-4.1,0.8-8.2,0.3-12.2c-0.5-4.1-1.6-8.1-3.4-11.8c-1.8-3.7-4.1-7.1-6.9-10l-125-125l25.5-31.4l125,125c2.8,2.8,5.1,6.2,6.9,10s3,7.7,3.4,11.8c0.5,4.1,0.4,8.2-0.3,12.2s-2.4,7.9-5.2,11.6c-2.8,3.6-6.4,6.4-10.7,8.6s-9,3.2-14.1,3.2z"/>
  </svg>
</svg>`;

// ── Verse end marker ────────────────────────────────────────────────────────

/** Build ﴿١٧﴾ — ornate right/left parentheses with Arabic-Indic numerals */
function verseEndMark(verseNumber: number): string {
  const arabicIndic = String(verseNumber).replace(/[0-9]/g, (d) =>
    String.fromCharCode(0x0660 + Number(d)),
  );
  // U+FD3F = ornate right paren ﴿  U+FD3E = ornate left paren ﴾
  return `\uFD3F${arabicIndic}\uFD3E`;
}

// ── HTML builder ─────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(data: VerseShareData): string {
  const arabicLen = data.arabicText.length;
  const hasTranslation = !!data.translation;
  const transLen = data.translation?.length ?? 0;

  // Arabic text sizing — large to fill the space
  // Arabic with full tashkeel needs ~2.4x line-height so shadda/harakat don't overlap
  let arabicSize: number;
  let arabicLineH: number;
  if (arabicLen > 500) {
    arabicSize = 38; arabicLineH = 92;
  } else if (arabicLen > 300) {
    arabicSize = 48; arabicLineH = 115;
  } else if (arabicLen > 150) {
    arabicSize = 56; arabicLineH = 134;
  } else {
    arabicSize = 64; arabicLineH = 154;
  }

  // Translation sizing
  let transSize: number;
  let transLineH: number;
  if (!hasTranslation) {
    transSize = 0; transLineH = 0;
  } else if (transLen > 400) {
    transSize = 22; transLineH = 36;
  } else if (transLen > 200) {
    transSize = 26; transLineH = 42;
  } else {
    transSize = 30; transLineH = 48;
  }

  const logoSvgEncoded = LOGO_SVG.replace(/\n\s*/g, '');

  // Arabic text with verse-end marker ﴿١٧﴾
  const arabicWithMark = escHtml(data.arabicText) + ' ' + verseEndMark(data.verseNumber);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=1080,initial-scale=1">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1080px; height:1350px; background:#0C1A17; font-family:-apple-system,system-ui,sans-serif; overflow:hidden; }
.accent-bar { position:absolute; top:0; left:0; right:0; height:6px; background:#668468; }
.container { display:flex; flex-direction:column; height:100%; padding:48px 56px 44px; }
.header { display:flex; align-items:center; gap:16px; }
.logo-wrap { width:56px; height:56px; flex-shrink:0; }
.app-name { color:#fff; font-size:28px; font-weight:700; letter-spacing:0.5px; }
.divider { height:1px; background:rgba(102,132,104,0.4); margin:24px 0; flex-shrink:0; }
.content { flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 12px; }
.arabic { color:#fff; font-size:${arabicSize}px; line-height:${arabicLineH}px; text-align:center; direction:rtl; font-family:'Geeza Pro','Traditional Arabic','Arabic Typesetting',serif; padding:0 8px; -webkit-font-smoothing:antialiased; font-feature-settings:'kern' 1, 'mark' 1, 'mkmk' 1; letter-spacing:0.01em; }
.trans-wrap { padding:16px 24px 0; flex-shrink:0; }
.trans-line { width:56px; height:2px; background:#668468; margin:0 auto 20px; }
.trans { color:rgba(255,255,255,0.75); font-size:${transSize}px; line-height:${transLineH}px; text-align:center; font-style:italic; }
.footer { text-align:center; padding-top:24px; flex-shrink:0; }
.badge { display:inline-block; background:rgba(102,132,104,0.3); padding:6px 22px; border-radius:16px; margin-bottom:12px; }
.badge-text { color:#4db8a8; font-size:18px; font-weight:700; letter-spacing:0.5px; }
.footer-arabic { color:#fff; font-size:26px; font-weight:600; direction:rtl; margin-bottom:6px; font-family:'Geeza Pro','Arabic Typesetting',serif; }
.footer-text { color:rgba(255,255,255,0.5); font-size:17px; font-weight:500; }
</style></head><body>
<div class="accent-bar"></div>
<div class="container">
  <div class="header">
    <div class="logo-wrap">${logoSvgEncoded}</div>
    <span class="app-name">Hidayah</span>
  </div>
  <div class="divider"></div>
  <div class="content">
    <div class="arabic">${arabicWithMark}</div>
    ${hasTranslation ? `
    <div class="trans-wrap">
      <div class="trans-line"></div>
      <div class="trans">${escHtml(data.translation!)}</div>
    </div>` : ''}
  </div>
  <div class="divider"></div>
  <div class="footer">
    <div class="badge"><span class="badge-text">${escHtml(data.verseKey)}</span></div>
    <div class="footer-arabic">${escHtml(data.surahNameArabic)}</div>
    <div class="footer-text">Surah ${escHtml(data.surahName)}, Vers ${data.verseNumber}</div>
  </div>
</div>
<script>
setTimeout(function() {
  try {
    var c = document.createElement('canvas');
    c.width = 1080; c.height = 1350;
    var ctx = c.getContext('2d');
    var svgData = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">' +
      '<foreignObject width="100%" height="100%">' +
      new XMLSerializer().serializeToString(document.documentElement) +
      '</foreignObject></svg>';
    var img = new Image();
    img.onload = function() {
      ctx.drawImage(img, 0, 0);
      var base64 = c.toDataURL('image/png').split(',')[1];
      window.ReactNativeWebView.postMessage(base64);
    };
    img.onerror = function() {
      window.ReactNativeWebView.postMessage('ERROR');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
  } catch(e) {
    window.ReactNativeWebView.postMessage('ERROR');
  }
}, 200);
</script>
</body></html>`;
}

// ── Component ────────────────────────────────────────────────────────────────

const VerseShareCard = forwardRef<VerseShareCardRef, object>(
  function VerseShareCard(_, ref) {
    const resolveRef = useRef<((base64: string | null) => void) | null>(null);
    const [html, setHtml] = useState<string | null>(null);

    const onMessage = useCallback((e: WebViewMessageEvent) => {
      const msg = e.nativeEvent.data;
      if (resolveRef.current) {
        resolveRef.current(msg === 'ERROR' ? null : msg);
        resolveRef.current = null;
      }
      setHtml(null);
    }, []);

    const capture = useCallback(async (data: VerseShareData) => {
      const htmlContent = buildHtml(data);
      setHtml(htmlContent);

      const base64 = await new Promise<string | null>((resolve) => {
        resolveRef.current = resolve;
        setTimeout(() => {
          if (resolveRef.current) {
            resolveRef.current(null);
            resolveRef.current = null;
          }
        }, 6000);
      });

      setHtml(null);
      if (!base64) return;

      const dest = `${FileSystem.cacheDirectory}andalus_verse_share.png`;
      await FileSystem.writeAsStringAsync(dest, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Sharing.shareAsync(dest, { mimeType: 'image/png', UTI: 'public.png' });
    }, []);

    useImperativeHandle(ref, () => ({ capture }), [capture]);

    if (!html) return null;

    return (
      <View style={styles.offScreen} pointerEvents="none">
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={styles.webview}
          onMessage={onMessage}
          javaScriptEnabled
          scrollEnabled={false}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  offScreen: {
    position: 'absolute',
    left: -9999,
    top: -9999,
    width: 1080,
    height: 1350,
    opacity: 0,
  },
  webview: {
    width: 1080,
    height: 1350,
  },
});

export default VerseShareCard;
