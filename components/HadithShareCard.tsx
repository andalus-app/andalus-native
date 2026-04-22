/**
 * components/HadithShareCard.tsx
 *
 * Renders a hadith share image (1080×1350) using a hidden WebView + HTML5
 * Canvas — the same approach as VerseShareCard.
 *
 * Arabic font: reads the locally cached font file from arabicFontService
 * (KFGQPC Uthman Taha Naskh → Amiri → Scheherazade New) in priority order
 * and embeds it as a base64 data-URL via the FontFace API inside the canvas.
 * This ensures the same font and glyph coverage as ArabicText in the detail
 * view, including U+FDFA (ﷺ ARABIC LIGATURE SALLALLAHOU ALAYHE WASALLAM).
 *
 * Same visual identity as VerseShareCard:
 *   - Dark background #0C1A17
 *   - Accent bar at top
 *   - Hidayah logo + app name header
 *   - Footer: hadith number badge + source
 */

import React, { useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HadithShareData = {
  hadithNr: number;
  arabiska: string;
  svenska: string;
  källa: string;
};

export type HadithShareCardRef = {
  capture: (data: HadithShareData) => Promise<void>;
};

type FontData = { base64: string; mimeType: string } | null;

// ── Asset loaders ─────────────────────────────────────────────────────────────

async function loadLogoBase64(): Promise<string> {
  const asset = Asset.fromModule(require('@/assets/images/icon.png'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

/**
 * Tries to load the locally cached Arabic font in the same priority order as
 * arabicFontService.ts: KFGQPC → Amiri → Scheherazade New.
 * Returns base64 + mimeType so it can be embedded as a data-URL in the
 * WebView's FontFace API call.
 */
async function loadArabicFontBase64(): Promise<FontData> {
  const FONTS_DIR = `${FileSystem.documentDirectory}arabic_fonts/`;
  const MIN_BYTES = 50_000;
  const candidates = [
    { filename: 'KFGQPCUthmanTahaNaskh.otf', mimeType: 'font/otf' },
    { filename: 'Amiri.ttf',                  mimeType: 'font/ttf' },
    { filename: 'ScheherazadeNew.ttf',         mimeType: 'font/ttf' },
  ];
  for (const font of candidates) {
    try {
      const info = await FileSystem.getInfoAsync(FONTS_DIR + font.filename);
      if (info.exists && (info.size ?? 0) >= MIN_BYTES) {
        const base64 = await FileSystem.readAsStringAsync(FONTS_DIR + font.filename, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return { base64, mimeType: font.mimeType };
      }
    } catch {}
  }
  return null;
}

// ── HTML + canvas builder ─────────────────────────────────────────────────────

function buildHtml(data: HadithShareData, logoBase64: string, fontData: FontData): string {
  const safeJson = (v: unknown) =>
    JSON.stringify(v).replace(/<\/script>/gi, '<\\/script>');

  const scriptPayload = safeJson({
    hadithNr: data.hadithNr,
    arabiska: data.arabiska,
    svenska:  data.svenska,
    källa:    data.källa,
  });

  const fontPayload = fontData
    ? safeJson({ base64: fontData.base64, mimeType: fontData.mimeType })
    : 'null';

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
    var DATA      = ${scriptPayload};
    var LOGO_B64  = ${safeJson(logoBase64)};
    var FONT_DATA = ${fontPayload};

    var canvas = document.getElementById('c');
    var ctx    = canvas.getContext('2d');
    var W = 1080, H = 1350;

    // ── 1. Logo ──────────────────────────────────────────────────────────────
    var logo = await new Promise(function(res, rej) {
      var img = new Image();
      img.onload = function() { res(img); };
      img.onerror = rej;
      img.src = 'data:image/png;base64,' + LOGO_B64;
    });

    // ── 2. Load Arabic font from local cache ─────────────────────────────────
    // Uses the same font file as ArabicText/arabicFontService.
    // Falls back to system Arabic if not yet cached on device.
    var ARABIC_FONT_FAMILY = null;
    if (FONT_DATA) {
      try {
        var face = new FontFace(
          'HadithArabic',
          'url(data:' + FONT_DATA.mimeType + ';base64,' + FONT_DATA.base64 + ')'
        );
        document.fonts.add(face);
        await face.load();
        ARABIC_FONT_FAMILY = 'HadithArabic';
      } catch(fontErr) {
        // Font load failed — fallback to system Arabic below
        ARABIC_FONT_FAMILY = null;
      }
    }
    // System Arabic fallback (covers U+FDFA on iOS via Geeza Pro)
    var ARABIC_STACK = ARABIC_FONT_FAMILY
      ? '"HadithArabic", "Geeza Pro", "Arabic Typesetting", serif'
      : '"Geeza Pro", "Arabic Typesetting", "Simplified Arabic", serif';

    // ── 3. Background ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#0C1A17';
    ctx.fillRect(0, 0, W, H);

    // ── 4. Accent bar ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#24645d';
    ctx.fillRect(0, 0, W, 6);

    // ── 5. Header (logo + app name) ───────────────────────────────────────────
    var PAD_H = 56, PAD_TOP = 48;
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

    // ── 6. Top divider ────────────────────────────────────────────────────────
    var DIV1_Y = PAD_TOP + LOGO_SIZE + 24;
    ctx.fillStyle = 'rgba(36,100,93,0.4)';
    ctx.fillRect(PAD_H, DIV1_Y, W - PAD_H * 2, 1);

    // ── 7. Footer (calculate height first, draw after) ────────────────────────
    var PAD_BOT = 44;
    var BADGE_FONT = 20, BADGE_PAD_H = 24, BADGE_PAD_V = 10;
    var SOURCE_SIZE = 18;
    var FOOTER_GAP = 16;

    ctx.font = '700 ' + BADGE_FONT + 'px -apple-system, sans-serif';
    var badgeLabel = 'Hadith #' + DATA.hadithNr;
    var badgeTextW = ctx.measureText(badgeLabel).width;
    var badgeW = badgeTextW + BADGE_PAD_H * 2;
    var badgeH = BADGE_FONT + BADGE_PAD_V * 2;

    var footerH = badgeH + FOOTER_GAP + Math.round(SOURCE_SIZE * 1.4);
    var DIV2_Y  = H - PAD_BOT - 24 - footerH - 1;

    ctx.fillStyle = 'rgba(36,100,93,0.4)';
    ctx.fillRect(PAD_H, DIV2_Y, W - PAD_H * 2, 1);

    var footerY = DIV2_Y + 1 + 24;

    // Badge pill
    var bx = (W - badgeW) / 2, br = 18;
    ctx.fillStyle = 'rgba(36,100,93,0.3)';
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

    ctx.fillStyle = '#cab488';
    ctx.font = '700 ' + BADGE_FONT + 'px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeLabel, W / 2, footerY + badgeH / 2);

    // Source line
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '500 ' + SOURCE_SIZE + 'px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(DATA.källa, W / 2, footerY + badgeH + FOOTER_GAP + SOURCE_SIZE);

    // ── 8. Content area ───────────────────────────────────────────────────────
    var contentTop = DIV1_Y + 1 + 48;
    var contentBot = DIV2_Y - 48;
    var contentH   = contentBot - contentTop;
    var TEXT_MAX_W = W - PAD_H * 2 - 24;

    // Arabic font size — original scale (smaller, tighter)
    var arabicLen = DATA.arabiska.length;
    var ARABIC_SIZE   = arabicLen > 600 ? 32 : arabicLen > 350 ? 38 : arabicLen > 180 ? 46 : 56;
    var ARABIC_LINE_H = Math.round(ARABIC_SIZE * 2.0); // generous line-height for diacritics

    // Swedish font size — larger, since U+FDFA (ﷺ) appears here
    var svenskaLen = DATA.svenska.length;
    var SVENSKA_SIZE   = svenskaLen > 500 ? 28 : svenskaLen > 280 ? 34 : 40;
    var SVENSKA_LINE_H = Math.round(SVENSKA_SIZE * 1.65);

    // Swedish font stack: -apple-system for Latin, Arabic font as fallback so
    // U+FDFA (ﷺ) and other Arabic ligatures render with the correct glyph.
    var SVENSKA_FONT_STACK = ARABIC_FONT_FAMILY
      ? '"HadithArabic", -apple-system, sans-serif'
      : '"Geeza Pro", "Arabic Typesetting", -apple-system, sans-serif';

    // ── Word-wrap Arabic (RTL: prepend each new word to the left) ─────────────
    // Using the custom font for measurement so wrap matches rendered widths.
    ctx.font = ARABIC_SIZE + 'px ' + ARABIC_STACK;
    ctx.textAlign = 'right';
    var arabicWords = DATA.arabiska.split(' ');
    var arabicLines = [], aCur = '';
    for (var ai = 0; ai < arabicWords.length; ai++) {
      var aTest = aCur ? arabicWords[ai] + ' ' + aCur : arabicWords[ai];
      if (ctx.measureText(aTest).width > TEXT_MAX_W && aCur) {
        arabicLines.push(aCur);
        aCur = arabicWords[ai];
      } else {
        aCur = aTest;
      }
    }
    if (aCur) arabicLines.push(aCur);

    // ── Word-wrap Swedish ─────────────────────────────────────────────────────
    // Measure with the same stack used for drawing so wrap widths are accurate.
    ctx.font = 'italic ' + SVENSKA_SIZE + 'px ' + SVENSKA_FONT_STACK;
    var svenskaWords = DATA.svenska.split(' ');
    var svenskaLines = [], sCur = '';
    for (var si = 0; si < svenskaWords.length; si++) {
      var sTest = sCur ? sCur + ' ' + svenskaWords[si] : svenskaWords[si];
      if (ctx.measureText(sTest).width > TEXT_MAX_W && sCur) {
        svenskaLines.push(sCur);
        sCur = svenskaWords[si];
      } else {
        sCur = sTest;
      }
    }
    if (sCur) svenskaLines.push(sCur);

    // ── Vertical centering ────────────────────────────────────────────────────
    var arabicBlockH  = arabicLines.length * ARABIC_LINE_H;
    var sepBlockH     = 2 + 40;           // separator line + gap below
    var svenskaBlockH = svenskaLines.length * SVENSKA_LINE_H;
    var totalH        = arabicBlockH + sepBlockH + svenskaBlockH;
    var startY        = contentTop + Math.max(0, (contentH - totalH) / 2);

    // ── Draw Arabic lines (RTL, right-aligned) ────────────────────────────────
    ctx.font = ARABIC_SIZE + 'px ' + ARABIC_STACK;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    for (var ali = 0; ali < arabicLines.length; ali++) {
      ctx.fillText(arabicLines[ali], W - PAD_H - 8, startY + ali * ARABIC_LINE_H + ARABIC_SIZE);
    }

    // ── Separator ─────────────────────────────────────────────────────────────
    var sepY = startY + arabicBlockH + 20;
    ctx.fillStyle = '#cab488';
    ctx.fillRect((W - 56) / 2, sepY, 56, 2);

    // ── Draw Swedish lines ────────────────────────────────────────────────────
    var transStartY = sepY + 2 + 20;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = 'italic ' + SVENSKA_SIZE + 'px ' + SVENSKA_FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (var sli = 0; sli < svenskaLines.length; sli++) {
      ctx.fillText(
        svenskaLines[sli],
        W / 2,
        transStartY + sli * SVENSKA_LINE_H + SVENSKA_SIZE,
      );
    }

    // ── 9. Export ─────────────────────────────────────────────────────────────
    var base64 = canvas.toDataURL('image/png').split(',')[1];
    window.ReactNativeWebView.postMessage(base64);

  } catch(e) {
    window.ReactNativeWebView.postMessage('ERROR:' + e.message);
  }
})();
</script>
</body></html>`;
}

// ── Component ─────────────────────────────────────────────────────────────────

const HadithShareCard = forwardRef<HadithShareCardRef, object>(
  function HadithShareCard(_, ref) {
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

    const capture = useCallback(async (data: HadithShareData) => {
      // Load logo and font in parallel
      const [logoBase64, fontData] = await Promise.all([
        loadLogoBase64(),
        loadArabicFontBase64(),
      ]);
      const htmlContent = buildHtml(data, logoBase64, fontData);
      setHtml(htmlContent);

      // 15 s timeout — font embedding from disk can take a moment on older devices
      const base64 = await new Promise<string | null>((resolve) => {
        resolveRef.current = resolve;
        setTimeout(() => {
          if (resolveRef.current) {
            resolveRef.current(null);
            resolveRef.current = null;
          }
        }, 15_000);
      });

      setHtml(null);
      if (!base64) return;

      const dest = `${FileSystem.cacheDirectory}andalus_hadith_share.png`;
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

export default HadithShareCard;
