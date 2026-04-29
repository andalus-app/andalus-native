/**
 * VerseShareCard.tsx
 *
 * Renders a verse share image (1080×1350) using a hidden WebView + pure
 * HTML5 Canvas (no SVG foreignObject). Pure canvas is required because
 * SVG foreignObject capture does not serialize CSS @font-face fonts —
 * QCF V2 PUA glyphs would render as boxes via that path.
 *
 * With pure canvas + FontFace API, the QCF V2 page fonts are loaded from
 * the Quran Foundation CDN and drawn glyph-by-glyph RTL. The result is
 * the same authentic King Fahad Complex V2 typeface used in the Mushaf reader.
 */

import React, { useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

// ── Types ────────────────────────────────────────────────────────────────────

export type QCFWord = {
  code_v2: string;
  pageNumber: number;
};

export type VerseShareData = {
  verseKey: string;
  translation: string | null;
  surahName: string;
  surahNameArabic: string;
  verseNumber: number;
  qcfWords: QCFWord[];   // QCF V2 glyphs — use these for Arabic rendering
};

export type VerseShareCardRef = {
  capture: (data: VerseShareData) => Promise<void>;
};

// ── Logo loader ───────────────────────────────────────────────────────────────

async function loadLogoBase64(): Promise<string> {
  const asset = Asset.fromModule(require('@/assets/images/icon.png'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

// ── HTML + canvas builder ────────────────────────────────────────────────────

function buildHtml(data: VerseShareData, logoBase64: string): string {
  const safeJson = (v: unknown) =>
    JSON.stringify(v).replace(/<\/script>/gi, '<\\/script>');

  const scriptPayload = safeJson({
    verseKey: data.verseKey,
    surahName: data.surahName,
    surahNameArabic: data.surahNameArabic,
    verseNumber: data.verseNumber,
    translation: data.translation,
    qcfWords: data.qcfWords,
  });

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080,initial-scale=1">
<style>
* { margin:0; padding:0; }
body { width:1080px; height:1350px; overflow:hidden; background:#0C1A17; }
canvas { display:block; }
</style>
</head>
<body>
<canvas id="c" width="1080" height="1350"></canvas>
<script>
(async function() {
  try {
    var DATA = ${scriptPayload};
    var LOGO_B64 = ${safeJson(logoBase64)};

    var canvas = document.getElementById('c');
    var ctx = canvas.getContext('2d');
    var W = 1080, H = 1350;

    // ── 1. Load logo ────────────────────────────────────────────────────────
    var logo = await new Promise(function(res, rej) {
      var img = new Image();
      img.onload = function() { res(img); };
      img.onerror = rej;
      img.src = 'data:image/png;base64,' + LOGO_B64;
    });

    // ── 2. Load QCF V2 fonts ────────────────────────────────────────────────
    var uniquePages = [...new Set(DATA.qcfWords.map(function(w) { return w.pageNumber; }))];
    await Promise.all(uniquePages.map(async function(n) {
      var name = 'QCFp' + String(n).padStart(3, '0');
      var url  = 'https://verses.quran.foundation/fonts/quran/hafs/v2/ttf/p' + n + '.ttf';
      var f = new FontFace(name, 'url(' + url + ')');
      document.fonts.add(f);
      await f.load();
    }));

    // ── 3. Background ───────────────────────────────────────────────────────
    ctx.fillStyle = '#0C1A17';
    ctx.fillRect(0, 0, W, H);

    // Subtle radial glow in the content region (single premium touch)
    var grad = ctx.createRadialGradient(W / 2, H * 0.48, 0, W / 2, H * 0.48, 580);
    grad.addColorStop(0, 'rgba(36,100,93,0.11)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ── 4. Gold accent bar at top ───────────────────────────────────────────
    ctx.fillStyle = '#cab488';
    ctx.fillRect(0, 0, W, 6);

    // ── 5. Header (logo + app name) ─────────────────────────────────────────
    var PAD_H = 56, PAD_TOP = 40;
    var LOGO_SIZE = 56, LOGO_RADIUS = 14;
    var lx = PAD_H, ly = PAD_TOP;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(lx + LOGO_RADIUS, ly);
    ctx.lineTo(lx + LOGO_SIZE - LOGO_RADIUS, ly);
    ctx.quadraticCurveTo(lx + LOGO_SIZE, ly, lx + LOGO_SIZE, ly + LOGO_RADIUS);
    ctx.lineTo(lx + LOGO_SIZE, ly + LOGO_SIZE - LOGO_RADIUS);
    ctx.quadraticCurveTo(lx + LOGO_SIZE, ly + LOGO_SIZE, lx + LOGO_SIZE - LOGO_RADIUS, ly + LOGO_SIZE);
    ctx.lineTo(lx + LOGO_RADIUS, ly + LOGO_SIZE);
    ctx.quadraticCurveTo(lx, ly + LOGO_SIZE, lx, ly + LOGO_SIZE - LOGO_RADIUS);
    ctx.lineTo(lx, ly + LOGO_RADIUS);
    ctx.quadraticCurveTo(lx, ly, lx + LOGO_RADIUS, ly);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(logo, lx, ly, LOGO_SIZE, LOGO_SIZE);
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '700 28px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Hidayah', lx + LOGO_SIZE + 16, ly + LOGO_SIZE / 2);

    // ── 6. Footer metrics (compute first, draw after content) ───────────────
    var PAD_BOT = 40;
    var BADGE_FONT = 22, BADGE_PAD_H = 24, BADGE_PAD_V = 9;
    var FOOTER_ARABIC_SIZE = 28, FOOTER_TEXT_SIZE = 18;
    var FOOTER_GAP = 14;

    ctx.font = '700 ' + BADGE_FONT + 'px -apple-system, sans-serif';
    var badgeTextW = ctx.measureText(DATA.verseKey).width;
    var badgeW = badgeTextW + BADGE_PAD_H * 2;
    var badgeH = BADGE_FONT + BADGE_PAD_V * 2;

    var footerH = badgeH + FOOTER_GAP + Math.round(FOOTER_ARABIC_SIZE * 1.4)
                + FOOTER_GAP + Math.round(FOOTER_TEXT_SIZE * 1.4);

    // Footer sits at fixed distance from bottom — no divider gap
    var footerY = H - PAD_BOT - footerH;

    // ── 7. Content area (no dividers — direct padding from header/footer) ───
    var contentTop = PAD_TOP + LOGO_SIZE + 30;   // 40+56+30 = 126
    var contentBot = footerY - 40;
    var contentH   = contentBot - contentTop;
    var TEXT_MAX_W = W - PAD_H * 2 - 16;

    // Arabic size by word count (unchanged — QCF font is already premium)
    var wordCount = DATA.qcfWords.length;
    var ARABIC_SIZE = wordCount > 35 ? 48 : wordCount > 22 ? 60 : wordCount > 12 ? 72 : 82;
    var LINE_H = Math.round(ARABIC_SIZE * 1.75);

    // ── Word-wrap Arabic (RTL, glyph-by-glyph measurement) ──────────────────
    var wrapLines = [];
    var curWords = [], curW = 0;
    for (var wi = 0; wi < DATA.qcfWords.length; wi++) {
      var wrd = DATA.qcfWords[wi];
      var fontName = 'QCFp' + String(wrd.pageNumber).padStart(3, '0');
      ctx.font = ARABIC_SIZE + 'px ' + fontName;
      var mw = ctx.measureText(wrd.code_v2).width;
      if (curW + mw > TEXT_MAX_W && curWords.length > 0) {
        wrapLines.push({ words: curWords, totalW: curW });
        curWords = []; curW = 0;
      }
      curWords.push({ code_v2: wrd.code_v2, pageNumber: wrd.pageNumber, w: mw });
      curW += mw;
    }
    if (curWords.length > 0) wrapLines.push({ words: curWords, totalW: curW });

    // ── Translation wrap ────────────────────────────────────────────────────
    var transLines = [];
    var TRANS_SIZE = 0, TRANS_LINE_H = 0;
    if (DATA.translation) {
      var tLen = DATA.translation.length;
      TRANS_SIZE   = tLen > 500 ? 32 : tLen > 280 ? 38 : 46;
      TRANS_LINE_H = Math.round(TRANS_SIZE * 1.72);
      ctx.font = 'italic ' + TRANS_SIZE + 'px -apple-system, sans-serif';
      var tWords = DATA.translation.split(' ');
      var tCur = '';
      for (var ti = 0; ti < tWords.length; ti++) {
        var test = tCur ? tCur + ' ' + tWords[ti] : tWords[ti];
        if (ctx.measureText(test).width > TEXT_MAX_W && tCur) {
          transLines.push(tCur);
          tCur = tWords[ti];
        } else {
          tCur = test;
        }
      }
      if (tCur) transLines.push(tCur);
    }

    // ── Vertical centering ──────────────────────────────────────────────────
    var arabicBlockH = wrapLines.length * LINE_H;
    var SEP_BLOCK_H  = transLines.length > 0 ? 2 + 44 : 0;  // gold line + margins
    var transBlockH  = transLines.length > 0 ? transLines.length * TRANS_LINE_H : 0;
    var totalTextH   = arabicBlockH + SEP_BLOCK_H + transBlockH;
    var textStartY   = contentTop + Math.max(0, Math.floor((contentH - totalTextH) / 2));

    // ── Draw Arabic lines (RTL, glyph-by-glyph) ────────────────────────────
    for (var li = 0; li < wrapLines.length; li++) {
      var line = wrapLines[li];
      var baseY = textStartY + li * LINE_H + ARABIC_SIZE;
      var x = (W + line.totalW) / 2;
      for (var gi = 0; gi < line.words.length; gi++) {
        var g = line.words[gi];
        var gFont = 'QCFp' + String(g.pageNumber).padStart(3, '0');
        ctx.font = ARABIC_SIZE + 'px ' + gFont;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(g.code_v2, x - g.w, baseY);
        x -= g.w;
      }
    }

    // ── Draw translation ────────────────────────────────────────────────────
    if (transLines.length > 0) {
      var transBlockY = textStartY + arabicBlockH + 22;

      // Elegant gold separator
      ctx.fillStyle = '#cab488';
      ctx.fillRect((W - 72) / 2, transBlockY, 72, 2);

      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      ctx.font = 'italic ' + TRANS_SIZE + 'px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (var tli = 0; tli < transLines.length; tli++) {
        ctx.fillText(
          transLines[tli],
          W / 2,
          transBlockY + 2 + 20 + tli * TRANS_LINE_H + TRANS_SIZE,
        );
      }
    }

    // ── Footer: badge pill ──────────────────────────────────────────────────
    var bx = (W - badgeW) / 2, br = 18;

    // Fill
    ctx.fillStyle = 'rgba(36,100,93,0.42)';
    ctx.beginPath();
    ctx.moveTo(bx + br, footerY);
    ctx.lineTo(bx + badgeW - br, footerY);
    ctx.quadraticCurveTo(bx + badgeW, footerY, bx + badgeW, footerY + br);
    ctx.lineTo(bx + badgeW, footerY + badgeH - br);
    ctx.quadraticCurveTo(bx + badgeW, footerY + badgeH, bx + badgeW - br, footerY + badgeH);
    ctx.lineTo(bx + br, footerY + badgeH);
    ctx.quadraticCurveTo(bx, footerY + badgeH, bx, footerY + badgeH - br);
    ctx.lineTo(bx, footerY + br);
    ctx.quadraticCurveTo(bx, footerY, bx + br, footerY);
    ctx.closePath();
    ctx.fill();

    // Border stroke
    ctx.strokeStyle = 'rgba(202,180,136,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + br, footerY);
    ctx.lineTo(bx + badgeW - br, footerY);
    ctx.quadraticCurveTo(bx + badgeW, footerY, bx + badgeW, footerY + br);
    ctx.lineTo(bx + badgeW, footerY + badgeH - br);
    ctx.quadraticCurveTo(bx + badgeW, footerY + badgeH, bx + badgeW - br, footerY + badgeH);
    ctx.lineTo(bx + br, footerY + badgeH);
    ctx.quadraticCurveTo(bx, footerY + badgeH, bx, footerY + badgeH - br);
    ctx.lineTo(bx, footerY + br);
    ctx.quadraticCurveTo(bx, footerY, bx + br, footerY);
    ctx.closePath();
    ctx.stroke();

    // Badge label (verse key)
    ctx.fillStyle = '#cab488';
    ctx.font = '700 ' + BADGE_FONT + 'px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(DATA.verseKey, W / 2, footerY + badgeH / 2);

    // Surah name in Arabic script
    var arabicFooterY = footerY + badgeH + FOOTER_GAP + FOOTER_ARABIC_SIZE;
    ctx.fillStyle = '#fff';
    ctx.font = '600 ' + FOOTER_ARABIC_SIZE + "px 'Geeza Pro', 'Arabic Typesetting', serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(DATA.surahNameArabic, W / 2, arabicFooterY);

    // Surah name + verse in Latin
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '500 ' + FOOTER_TEXT_SIZE + 'px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      'Surah ' + DATA.surahName + ', Vers ' + DATA.verseNumber,
      W / 2,
      arabicFooterY + FOOTER_GAP + FOOTER_TEXT_SIZE,
    );

    // ── Export ──────────────────────────────────────────────────────────────
    var base64 = canvas.toDataURL('image/png').split(',')[1];
    window.ReactNativeWebView.postMessage(base64);

  } catch(e) {
    window.ReactNativeWebView.postMessage('ERROR:' + e.message);
  }
})();
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
        resolveRef.current(msg.startsWith('ERROR') ? null : msg);
        resolveRef.current = null;
      }
      setHtml(null);
    }, []);

    const capture = useCallback(async (data: VerseShareData) => {
      const logoBase64 = await loadLogoBase64();
      const htmlContent = buildHtml(data, logoBase64);
      setHtml(htmlContent);

      const base64 = await new Promise<string | null>((resolve) => {
        resolveRef.current = resolve;
        // 10s timeout — font loading from CDN can be slow on first share
        setTimeout(() => {
          if (resolveRef.current) {
            resolveRef.current(null);
            resolveRef.current = null;
          }
        }, 10000);
      });

      setHtml(null);
      if (!base64) return;

      const dest = `${FileSystem.cacheDirectory}Hidayah_verse_share.png`;
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
          allowsInlineMediaPlayback={false}
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
