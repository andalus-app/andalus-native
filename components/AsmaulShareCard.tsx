import React, { useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AsmaulShareData = {
  nr: number;
  arabic: string;
  transliteration: string;
  swedish: string;
  forklaring?: string;
  isDark?: boolean;
};

export type AsmaulShareCardRef = {
  capture: (data: AsmaulShareData) => Promise<void>;
};

type FontData = { base64: string; mimeType: string } | null;

// ── Asset loaders ─────────────────────────────────────────────────────────────

async function loadLogoBase64(): Promise<string> {
  const asset = Asset.fromModule(require('@/assets/images/icon.png'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

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

function buildHtml(data: AsmaulShareData, logoBase64: string, fontData: FontData): string {
  const safeJson = (v: unknown) =>
    JSON.stringify(v).replace(/<\/script>/gi, '<\\/script>');

  const scriptPayload = safeJson({
    nr:              data.nr,
    arabic:          data.arabic,
    transliteration: data.transliteration,
    swedish:         data.swedish,
    forklaring:      data.forklaring ?? '',
    isDark:          data.isDark !== false,
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

    // ── 2. Arabic font ───────────────────────────────────────────────────────
    var ARABIC_FONT_FAMILY = null;
    if (FONT_DATA) {
      try {
        var face = new FontFace(
          'AsmaulArabic',
          'url(data:' + FONT_DATA.mimeType + ';base64,' + FONT_DATA.base64 + ')'
        );
        document.fonts.add(face);
        await face.load();
        ARABIC_FONT_FAMILY = 'AsmaulArabic';
      } catch(fontErr) {
        ARABIC_FONT_FAMILY = null;
      }
    }
    var ARABIC_STACK = ARABIC_FONT_FAMILY
      ? '"AsmaulArabic", "Geeza Pro", "Arabic Typesetting", serif'
      : '"Geeza Pro", "Arabic Typesetting", "Simplified Arabic", serif';

    // ── 3. Color palette ─────────────────────────────────────────────────────
    var IS_DARK    = DATA.isDark !== false;
    var C_BG       = IS_DARK ? '#0C1A17'                    : '#F2F0EB';
    var C_TEXT     = IS_DARK ? '#FFFFFF'                    : '#1A1A18';
    var C_TRANS    = IS_DARK ? 'rgba(255,255,255,0.90)'     : 'rgba(26,26,24,0.82)';
    var C_MUTED    = IS_DARK ? 'rgba(255,255,255,0.68)'     : 'rgba(26,26,24,0.58)';
    var C_GOLD     = IS_DARK ? '#cab488'                    : '#7A5318';
    var BADGE_BG   = IS_DARK ? 'rgba(36,100,93,0.45)'      : 'rgba(36,100,93,0.12)';
    var BADGE_TEXT = IS_DARK ? '#cab488'                    : '#1B4D45';
    var BADGE_BORD = IS_DARK ? 'rgba(202,180,136,0.45)'    : 'rgba(36,100,93,0.40)';
    var GRAD_C     = IS_DARK ? 'rgba(36,100,93,0.13)'      : 'rgba(36,100,93,0.07)';

    // ── 4. Background ─────────────────────────────────────────────────────────
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, W, H);

    var grad = ctx.createRadialGradient(W / 2, H * 0.48, 0, W / 2, H * 0.48, 580);
    grad.addColorStop(0, GRAD_C);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ── 5. Gold accent bar at top ─────────────────────────────────────────────
    ctx.fillStyle = C_GOLD;
    ctx.fillRect(0, 0, W, 6);

    // ── 6. Header (logo + app name) ───────────────────────────────────────────
    var PAD_H = 60, HEADER_TOP = 44;
    var LOGO_SZ = 60, LOGO_R = 15;
    var lx = PAD_H, ly = HEADER_TOP;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(lx + LOGO_R, ly);
    ctx.lineTo(lx + LOGO_SZ - LOGO_R, ly);
    ctx.quadraticCurveTo(lx + LOGO_SZ, ly, lx + LOGO_SZ, ly + LOGO_R);
    ctx.lineTo(lx + LOGO_SZ, ly + LOGO_SZ - LOGO_R);
    ctx.quadraticCurveTo(lx + LOGO_SZ, ly + LOGO_SZ, lx + LOGO_SZ - LOGO_R, ly + LOGO_SZ);
    ctx.lineTo(lx + LOGO_R, ly + LOGO_SZ);
    ctx.quadraticCurveTo(lx, ly + LOGO_SZ, lx, ly + LOGO_SZ - LOGO_R);
    ctx.lineTo(lx, ly + LOGO_R);
    ctx.quadraticCurveTo(lx, ly, lx + LOGO_R, ly);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(logo, lx, ly, LOGO_SZ, LOGO_SZ);
    ctx.restore();

    ctx.direction = 'ltr';
    ctx.fillStyle = C_TEXT;
    ctx.font = '700 30px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Hidayah', lx + LOGO_SZ + 18, ly + LOGO_SZ / 2);

    // ── 7. Footer metrics (compute first) ─────────────────────────────────────
    var PAD_BOT = 52;
    var BADGE_FONT = 26, BADGE_PAD_H = 28, BADGE_PAD_V = 12;
    var FOOTER_GAP = 20;
    var SUBTITLE_SIZE = 22;

    ctx.direction = 'ltr';
    ctx.font = '700 ' + BADGE_FONT + 'px -apple-system, sans-serif';
    var badgeLabel = 'Allahs namn • #' + DATA.nr;
    var badgeTextW = ctx.measureText(badgeLabel).width;
    var badgeW = badgeTextW + BADGE_PAD_H * 2;
    var badgeH = BADGE_FONT + BADGE_PAD_V * 2;
    var footerH = badgeH + FOOTER_GAP + SUBTITLE_SIZE;
    var footerY = H - PAD_BOT - footerH;

    // ── 8. Content area ───────────────────────────────────────────────────────
    var CONTENT_TOP = HEADER_TOP + LOGO_SZ + 40;
    var CONTENT_BOT = footerY - 44;
    var CONTENT_H   = CONTENT_BOT - CONTENT_TOP;
    var TEXT_MAX_W  = W - 120;

    // Arabic name — Allah's names are short, use large font
    var ARABIC_SIZE   = 160;
    var ARABIC_LINE_H = Math.round(ARABIC_SIZE * 1.35);

    // Word-wrap in case some names are longer
    ctx.direction = 'rtl';
    ctx.font = ARABIC_SIZE + 'px ' + ARABIC_STACK;
    ctx.textAlign = 'center';
    var arabicWords = DATA.arabic.split(' ');
    var arabicLines = [], aCur = '';
    for (var ai = 0; ai < arabicWords.length; ai++) {
      var aTest = aCur ? aCur + ' ' + arabicWords[ai] : arabicWords[ai];
      if (ctx.measureText(aTest).width > TEXT_MAX_W && aCur) {
        arabicLines.push(aCur);
        aCur = arabicWords[ai];
      } else {
        aCur = aTest;
      }
    }
    if (aCur) arabicLines.push(aCur);

    // Transliteration
    var TRANSL_SIZE   = 54;
    var TRANSL_LINE_H = Math.round(TRANSL_SIZE * 1.5);

    ctx.direction = 'ltr';
    ctx.font = '700 ' + TRANSL_SIZE + 'px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    var translWords = DATA.transliteration.split(' ');
    var translLines = [], tCur = '';
    for (var ti = 0; ti < translWords.length; ti++) {
      var tTest = tCur ? tCur + ' ' + translWords[ti] : translWords[ti];
      if (ctx.measureText(tTest).width > TEXT_MAX_W && tCur) {
        translLines.push(tCur);
        tCur = translWords[ti];
      } else {
        tCur = tTest;
      }
    }
    if (tCur) translLines.push(tCur);

    // Swedish meaning
    var SWEDISH_SIZE   = 40;
    var SWEDISH_LINE_H = Math.round(SWEDISH_SIZE * 1.6);

    ctx.font = 'italic ' + SWEDISH_SIZE + 'px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    var swedishWords = DATA.swedish.split(' ');
    var swedishLines = [], sCur = '';
    for (var si = 0; si < swedishWords.length; si++) {
      var sTest = sCur ? sCur + ' ' + swedishWords[si] : swedishWords[si];
      if (ctx.measureText(sTest).width > TEXT_MAX_W && sCur) {
        swedishLines.push(sCur);
        sCur = swedishWords[si];
      } else {
        sCur = sTest;
      }
    }
    if (sCur) swedishLines.push(sCur);

    // Förklaring — adaptive size, max 7 lines
    var FORKL_SIZE   = DATA.forklaring.length > 500 ? 24 : DATA.forklaring.length > 300 ? 27 : 30;
    var FORKL_LINE_H = Math.round(FORKL_SIZE * 1.68);
    var MAX_FORKL_LINES = 7;

    var forklaringLines = [];
    if (DATA.forklaring) {
      ctx.direction = 'ltr';
      ctx.font = FORKL_SIZE + 'px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      var fWords = DATA.forklaring.split(' ');
      var fCur = '';
      for (var fi = 0; fi < fWords.length; fi++) {
        var fTest = fCur ? fCur + ' ' + fWords[fi] : fWords[fi];
        if (ctx.measureText(fTest).width > TEXT_MAX_W && fCur) {
          forklaringLines.push(fCur);
          fCur = fWords[fi];
          if (forklaringLines.length >= MAX_FORKL_LINES) break;
        } else {
          fCur = fTest;
        }
      }
      if (fCur && forklaringLines.length < MAX_FORKL_LINES) {
        forklaringLines.push(fCur);
      } else if (forklaringLines.length >= MAX_FORKL_LINES && forklaringLines.length > 0) {
        // Truncate last line with ellipsis
        var last = forklaringLines[forklaringLines.length - 1];
        while (ctx.measureText(last + '…').width > TEXT_MAX_W && last.length > 0) {
          last = last.slice(0, last.lastIndexOf(' '));
        }
        forklaringLines[forklaringLines.length - 1] = last + '…';
      }
    }

    var hasForklaring = forklaringLines.length > 0;
    var FORKL_SEP_H   = hasForklaring ? 2 + 44 : 0; // subtle separator + margins
    var forklaringBlockH = hasForklaring ? forklaringLines.length * FORKL_LINE_H : 0;

    // ── Vertical centering ────────────────────────────────────────────────────
    var SEP_BLOCK_H  = 2 + 56; // gold line + margins
    var arabicBlockH = arabicLines.length * ARABIC_LINE_H;
    var translBlockH = translLines.length * TRANSL_LINE_H;
    var swBlockH     = swedishLines.length * SWEDISH_LINE_H;
    var totalH       = arabicBlockH + SEP_BLOCK_H + translBlockH + 24 + swBlockH + FORKL_SEP_H + forklaringBlockH;
    var startY       = CONTENT_TOP + Math.max(0, Math.floor((CONTENT_H - totalH) / 2));

    // ── Draw Arabic (large, centered, RTL) ────────────────────────────────────
    ctx.direction = 'rtl';
    ctx.font = ARABIC_SIZE + 'px ' + ARABIC_STACK;
    ctx.fillStyle = C_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (var ali = 0; ali < arabicLines.length; ali++) {
      ctx.fillText(arabicLines[ali], W / 2, startY + ali * ARABIC_LINE_H + ARABIC_SIZE);
    }

    // ── Gold separator ────────────────────────────────────────────────────────
    var sepY = startY + arabicBlockH + 28;
    ctx.direction = 'ltr';
    ctx.fillStyle = C_GOLD;
    ctx.fillRect((W - 96) / 2, sepY, 96, 2);

    // ── Transliteration ───────────────────────────────────────────────────────
    var translStartY = sepY + 2 + 28;
    ctx.direction = 'ltr';
    ctx.font = '700 ' + TRANSL_SIZE + 'px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = C_TRANS;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (var tli = 0; tli < translLines.length; tli++) {
      ctx.fillText(translLines[tli], W / 2, translStartY + tli * TRANSL_LINE_H + TRANSL_SIZE);
    }

    // ── Swedish meaning ───────────────────────────────────────────────────────
    var swStartY = translStartY + translBlockH + 24;
    ctx.font = 'italic ' + SWEDISH_SIZE + 'px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = C_TRANS;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (var sli = 0; sli < swedishLines.length; sli++) {
      ctx.fillText(swedishLines[sli], W / 2, swStartY + sli * SWEDISH_LINE_H + SWEDISH_SIZE);
    }

    // ── Förklaring ────────────────────────────────────────────────────────────
    if (hasForklaring) {
      var fSepY = swStartY + swBlockH + 22;
      ctx.fillStyle = IS_DARK ? 'rgba(255,255,255,0.18)' : 'rgba(26,26,24,0.18)';
      ctx.fillRect(PAD_H, fSepY, W - PAD_H * 2, 1);

      var fStartY = fSepY + 1 + 22;
      ctx.direction = 'ltr';
      ctx.font = FORKL_SIZE + 'px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = C_MUTED;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (var fli = 0; fli < forklaringLines.length; fli++) {
        ctx.fillText(forklaringLines[fli], W / 2, fStartY + fli * FORKL_LINE_H + FORKL_SIZE);
      }
    }

    // ── Footer: badge pill ────────────────────────────────────────────────────
    var bx = (W - badgeW) / 2, br = 20;

    ctx.fillStyle = BADGE_BG;
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

    ctx.strokeStyle = BADGE_BORD;
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

    ctx.direction = 'ltr';
    ctx.fillStyle = BADGE_TEXT;
    ctx.font = '700 ' + BADGE_FONT + 'px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeLabel, W / 2, footerY + badgeH / 2);

    // ── Gold bar at bottom ────────────────────────────────────────────────────
    ctx.fillStyle = C_GOLD;
    ctx.fillRect(0, H - 6, W, 6);

    // ── Export ────────────────────────────────────────────────────────────────
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

const AsmaulShareCard = forwardRef<AsmaulShareCardRef, object>(
  function AsmaulShareCard(_, ref) {
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

    const capture = useCallback(async (data: AsmaulShareData) => {
      const [logoBase64, fontData] = await Promise.all([
        loadLogoBase64(),
        loadArabicFontBase64(),
      ]);
      const htmlContent = buildHtml(data, logoBase64, fontData);
      setHtml(htmlContent);

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

      const dest = `${FileSystem.cacheDirectory}Hidayah_asmaul_share.png`;
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

export default AsmaulShareCard;
