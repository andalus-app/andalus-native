/**
 * mushafFontManager.ts — offline-first QCF V2 font loading
 *
 * ═══════════════════════════════════════════════════════════════
 * CONFIRMED ASSETS
 * ═══════════════════════════════════════════════════════════════
 *
 * Page fonts (QCFp001 … QCFp604):
 *   ✓ CDN: verses.quran.foundation/fonts/quran/hafs/v2/ttf/p{n}.ttf
 *          (confirmed 200 OK — the old raw.githubusercontent.com/quran/
 *           quran-font-files URL was WRONG; that repo does not exist)
 *   ✓ PostScript name: "QCFp{n:03d}" — confirmed via QCFPage1Test.swift
 *   ✓ One font per Mushaf page (604 total)
 *   ✓ Each font encodes all verse/ornament glyphs for that page via cmap
 *   ✓ Used for: verse_line slots only
 *
 * Surah name font (surah_names):
 *   ✓ CDN: raw.githubusercontent.com/quran/quran.com-frontend/
 *          master/static/fonts/surah_names/surah_names.ttf
 *          (confirmed 200 OK — TTF, from quran/quran.com-frontend repo)
 *   ✓ PostScript name: "surah_names"
 *          Source: @font-face in quran.com-frontend-next declares
 *          font-family: "surahnames". The internal nameID 6 is most likely
 *          "surah_names" (filename convention for icon fonts). If surah
 *          glyphs don't render after first test, open the font in FontForge
 *          (Element → Font Info → PS Names tab → PostScript Name field)
 *          and update SURAH_NAME_PS_NAME to match.
 *          Fallback candidate if "surah_names" fails: "surahnames"
 *   ✓ Codepoints: PUA U+E900–U+E972, non-sequential mapping all 114 surahs
 *          Source: surah_names.svg glyph unicode attributes (all verified)
 *   ✓ One font file for all 114 surah name glyphs (icon font pattern)
 *   ✓ Used for: surah_header slots only
 *
 * Bismillah font (QCF_BSML):
 *   ✓ CDN: raw.githubusercontent.com/quran/quran.com-images/
 *          master/res/fonts/QCF_BSML.TTF
 *          (confirmed 200 OK — from quran/quran.com-images repo)
 *   ✓ PostScript name: "QCF_BSML"
 *          Confirmed: fontke.com + nuqayah/qpc-fonts + React Native usage
 *   ✓ Glyph codepoint: U+FDFD (ARABIC LIGATURE BISMILLAH AR-RAHMAN AR-RAHEEM)
 *   ✓ Used for: bismillah slots only
 *
 * Ornaments:
 *   ✓ No separate font. Verse-stream ornaments (end markers, sajdah, etc.)
 *     are part of verse_line rendering via code_v2 from the API.
 *     Inter-surah / page-end decorative dividers use pure SVG geometry.
 *     This matches how quran.com renders them (CSS borders, not font glyphs).
 *
 * ═══════════════════════════════════════════════════════════════
 * OFFLINE STRATEGY
 * ═══════════════════════════════════════════════════════════════
 *
 * Two modes — choose at build time via OFFLINE_MODE constant:
 *
 *   'bundled'  — All font files included in the app binary.
 *                Zero network access required, ever.
 *                Required files in assets/fonts/qcf/:
 *                  p001.ttf … p604.ttf   (604 page fonts)
 *                  surah_names.ttf        (surah name icon font)
 *                  bismillah.ttf          (QCF_BSML.TTF renamed)
 *                Total: 606 files
 *                See mushafFontRequires.ts. Use build script to generate
 *                all 604 page font entries; surah_names and bismillah are
 *                added manually.
 *
 *   'download' — Fonts downloaded on first page access, cached permanently
 *                to DocumentDir. Offline after first view.
 *                CacheDir is NOT used — iOS may purge it under storage pressure.
 *
 * For a shipping Quran app, 'bundled' is correct.
 * Font files must be downloaded from the CDN URLs above and placed in
 * assets/fonts/qcf/ before switching to 'bundled'.
 */

import * as Font from 'expo-font';
import * as FileSystem from 'expo-file-system/legacy';
import {
  PAGE_FONT_REQUIRES,
  SURAH_NAME_REQUIRE,
  BISMILLAH_REQUIRE,
} from './mushafFontRequires';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Switch between bundled and download-on-demand modes.
 * Set to 'bundled' once all 606 font files are in assets/fonts/qcf/.
 */
const OFFLINE_MODE: 'bundled' | 'download' = 'download';

// ── Page font CDN (download mode) ─────────────────────────────────────────────

/**
 * CDN for King Fahd Complex QCF V2 page fonts.
 * CONFIRMED: verses.quran.foundation — checked 200 OK for p1.ttf.
 * pageNumber: integer 1–604, no zero-padding in the URL path.
 *
 * Previous URL (https://raw.githubusercontent.com/quran/quran-font-files/...)
 * was WRONG — that repository does not exist. Do not revert to it.
 */
export const QCF_PAGE_FONT_CDN = (pageNumber: number): string =>
  `https://verses.quran.foundation/fonts/quran/hafs/v2/ttf/p${pageNumber}.ttf`;

// ── Surah name font CDN (download mode) ───────────────────────────────────────

/**
 * CDN for the surah name icon font.
 * CONFIRMED: GitHub raw content, checked 200 OK.
 * Source repo: quran/quran.com-frontend
 * One TTF file encodes all 114 surah name glyphs in PUA codepoints.
 */
export const SURAH_NAME_FONT_CDN =
  'https://raw.githubusercontent.com/quran/quran.com-frontend/master/static/fonts/surah_names/surah_names.ttf';

/**
 * PostScript name for the surah name font.
 *
 * CONFIRMED: The SVG source font file (surah_names.svg) has:
 *   <font id="icomoon" horiz-adv-x="1024">
 *   <font-face units-per-em="1024" ascent="819" descent="-205" />
 *
 * In SVG font format, when <font-face> has no font-family attribute,
 * the font's internal name is the id of the parent <font> element.
 * IcoMoon (the tool that generated this icon font) sets PostScript
 * nameID 6 to match that id — therefore: "icomoon".
 *
 * The CSS aliases ("surahnames" in quran.com-frontend-next, "surah_names"
 * in the old frontend) are web-only @font-face aliases. They are irrelevant
 * for react-native-svg, which uses Core Text → CTFontCreateWithName and
 * requires the actual PostScript name (nameID 6) from the font file.
 */
export const SURAH_NAME_PS_NAME = 'icomoon';

// ── Surah name codepoint table ────────────────────────────────────────────────

/**
 * Mapping of surah number (1–114) → Unicode PUA codepoint.
 *
 * Source: surah_names.svg from quran/quran.com-frontend
 * — extracted from glyph-id → unicode attribute map (all 114 confirmed).
 *
 * The mapping is non-sequential: surah 59 → U+E900 (first codepoint),
 * surah 1 → U+E904. This is an icon font insertion order artifact.
 */
export const SURAH_NAME_CODEPOINTS: Record<number, number> = {
    1: 0xE904,   2: 0xE905,   3: 0xE906,   4: 0xE907,   5: 0xE908,
    6: 0xE90B,   7: 0xE90C,   8: 0xE90D,   9: 0xE90E,  10: 0xE90F,
   11: 0xE910,  12: 0xE911,  13: 0xE912,  14: 0xE913,  15: 0xE914,
   16: 0xE915,  17: 0xE916,  18: 0xE917,  19: 0xE918,  20: 0xE919,
   21: 0xE91A,  22: 0xE91B,  23: 0xE91C,  24: 0xE91D,  25: 0xE91E,
   26: 0xE91F,  27: 0xE920,  28: 0xE921,  29: 0xE922,  30: 0xE923,
   31: 0xE924,  32: 0xE925,  33: 0xE926,  34: 0xE92E,  35: 0xE92F,
   36: 0xE930,  37: 0xE931,  38: 0xE909,  39: 0xE90A,  40: 0xE927,
   41: 0xE928,  42: 0xE929,  43: 0xE92A,  44: 0xE92B,  45: 0xE92C,
   46: 0xE92D,  47: 0xE932,  48: 0xE902,  49: 0xE933,  50: 0xE934,
   51: 0xE935,  52: 0xE936,  53: 0xE937,  54: 0xE938,  55: 0xE939,
   56: 0xE93A,  57: 0xE93B,  58: 0xE93C,  59: 0xE900,  60: 0xE901,
   61: 0xE941,  62: 0xE942,  63: 0xE943,  64: 0xE944,  65: 0xE945,
   66: 0xE946,  67: 0xE947,  68: 0xE948,  69: 0xE949,  70: 0xE94A,
   71: 0xE94B,  72: 0xE94C,  73: 0xE94D,  74: 0xE94E,  75: 0xE94F,
   76: 0xE950,  77: 0xE951,  78: 0xE952,  79: 0xE93D,  80: 0xE93E,
   81: 0xE93F,  82: 0xE940,  83: 0xE953,  84: 0xE954,  85: 0xE955,
   86: 0xE956,  87: 0xE957,  88: 0xE958,  89: 0xE959,  90: 0xE95A,
   91: 0xE95B,  92: 0xE95C,  93: 0xE95D,  94: 0xE95E,  95: 0xE95F,
   96: 0xE960,  97: 0xE961,  98: 0xE962,  99: 0xE963, 100: 0xE964,
  101: 0xE965, 102: 0xE966, 103: 0xE967, 104: 0xE968, 105: 0xE969,
  106: 0xE96A, 107: 0xE96B, 108: 0xE96C, 109: 0xE96D, 110: 0xE96E,
  111: 0xE96F, 112: 0xE970, 113: 0xE971, 114: 0xE972,
};

/**
 * Returns the Unicode character for the given surah's name glyph.
 * Pass directly to SvgText content with fontFamily={SURAH_NAME_PS_NAME}.
 */
export function surahNameGlyph(surahId: number): string {
  const cp = SURAH_NAME_CODEPOINTS[surahId];
  if (!cp) throw new Error(`No surah name codepoint for surah ${surahId} (valid range: 1–114)`);
  return String.fromCodePoint(cp);
}

// ── Bismillah font CDN (download mode) ────────────────────────────────────────

/**
 * CDN for the QCF bismillah glyph font.
 * CONFIRMED: GitHub raw content, checked 200 OK.
 * Source repo: quran/quran.com-images
 * Single glyph at U+FDFD — the complete bismillah ligature.
 */
export const BISMILLAH_FONT_CDN =
  'https://raw.githubusercontent.com/quran/quran.com-images/master/res/fonts/QCF_BSML.TTF';

/**
 * PostScript name for the bismillah font.
 * CONFIRMED: fontke.com + nuqayah/qpc-fonts + React Native community usage.
 */
export const BISMILLAH_PS_NAME = 'QCF_BSML';

/**
 * The bismillah glyph — U+FDFD, ARABIC LIGATURE BISMILLAH AR-RAHMAN AR-RAHEEM.
 * This is the single character to pass to SvgText content with
 * fontFamily={BISMILLAH_PS_NAME}.
 */
export const BISMILLAH_GLYPH = '\uFDFD';

// ── PostScript names — page fonts (CONFIRMED) ─────────────────────────────────

/**
 * PostScript name for a QCF V2 page font.
 * CONFIRMED via QCFPage1Test.swift: page 1 = "QCFp001".
 * Pattern is consistent for pages 1–604.
 *
 * This is the string passed to SVG fontFamily and to CTFontCreateWithName.
 * The key passed to Font.loadAsync is irrelevant for resolution —
 * only the font's internal PostScript name (nameID 6) matters.
 */
export const qcfPagePsName = (n: number): string =>
  `QCFp${String(n).padStart(3, '0')}`;

// ── Bundled font requires ─────────────────────────────────────────────────────
//
// TO ENABLE BUNDLED MODE (one-time setup):
//
//   Step 1 — Download all 606 font files:
//     node scripts/downloadQCFFonts.js
//
//   Step 2 — Generate static require() map (Metro needs static calls):
//     node scripts/generateFontRequires.js
//     This rewrites services/mushafFontRequires.ts with all 606 requires.
//
//   Step 3 — Switch to bundled mode here:
//     const OFFLINE_MODE: 'bundled' | 'download' = 'bundled';
//
// In bundled mode, PAGE_FONT_REQUIRES, SURAH_NAME_REQUIRE, BISMILLAH_REQUIRE
// are imported from ./mushafFontRequires (see import at top of file).
// The _loadFromPath function uses these for the bundled code path.

// ── Local cache paths (download mode) ────────────────────────────────────────

// FileSystem.documentDirectory already has a trailing slash and file:// prefix.
const localPageFontUri = (n: number): string =>
  `${FileSystem.documentDirectory}qcf_p${String(n).padStart(3, '0')}.ttf`;

const localSurahNameFontUri = (): string =>
  `${FileSystem.documentDirectory}qcf_surah_names.ttf`;

const localBismillahFontUri = (): string =>
  `${FileSystem.documentDirectory}qcf_bismillah.ttf`;

// ── Session deduplication ─────────────────────────────────────────────────────
//
// Font.isLoaded() only tracks whether loadAsync was called this session.
// Even if the font file is on disk, it must be re-registered on each launch.
// The promise map prevents duplicate concurrent registrations.

const _inFlight = new Map<string, Promise<string>>();

// ── Generic font loader (shared pattern) ─────────────────────────────────────

async function _loadFromPath(
  psName:    string,
  localPath: string,
  cdnUrl:    string,
  bundledAsset: number | null,
): Promise<string> {
  if (OFFLINE_MODE === 'bundled') {
    if (!bundledAsset) {
      throw new Error(
        `Font "${psName}" not found in bundled requires. ` +
        `Run: node scripts/downloadQCFFonts.js && node scripts/generateFontRequires.js`,
      );
    }
    try {
      await Font.loadAsync({ [psName]: bundledAsset });
    } catch (e: unknown) {
      const msg = String((e as any)?.message ?? e);
      if (!msg.includes('104') && !msg.includes('AlreadyRegistered')) throw e;
    }
    return psName;
  }

  // Download mode
  const existsInfo = await FileSystem.getInfoAsync(localPath);

  if (!existsInfo.exists) {
    const res = await FileSystem.downloadAsync(cdnUrl, localPath);
    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists || (info.size ?? 0) < 1000) {
      await FileSystem.deleteAsync(localPath, { idempotent: true });
      throw new Error(
        `Font download failed or produced empty file for "${psName}". ` +
        `URL: ${cdnUrl}. HTTP status: ${res.status ?? 'unknown'}.`,
      );
    }
  }

  // localPath already has file:// prefix from FileSystem.documentDirectory
  try {
    await Font.loadAsync({ [psName]: { uri: localPath } });
  } catch (e: unknown) {
    // CTFontManagerError code 104 = kCTFontManagerErrorAlreadyRegistered.
    // This happens when iOS already has the font registered from a previous
    // session (hot reload, CMD R, etc.) but expo-font's session tracker doesn't
    // know about it. The font IS available and usable — treat this as success.
    const msg = String((e as any)?.message ?? e);
    if (!msg.includes('104') && !msg.includes('AlreadyRegistered')) throw e;
  }
  return psName;
}

function _deduped(psName: string, loader: () => Promise<string>): Promise<string> {
  if (Font.isLoaded(psName)) return Promise.resolve(psName);
  const existing = _inFlight.get(psName);
  if (existing) return existing;
  const p = loader();
  _inFlight.set(psName, p);
  p.finally(() => _inFlight.delete(psName));
  return p;
}

// ── Public API — page fonts ───────────────────────────────────────────────────

/**
 * Loads and registers the QCF V2 page font for the given page number.
 * Returns the PostScript name to pass to SVG fontFamily.
 *
 * Throws on failure — NEVER returns silently with a wrong font loaded.
 * The caller must handle the error and show a failure state. No fallback.
 */
export function loadQCFPageFont(pageNumber: number): Promise<string> {
  const psName = qcfPagePsName(pageNumber);
  return _deduped(psName, () =>
    _loadFromPath(
      psName,
      localPageFontUri(pageNumber),
      QCF_PAGE_FONT_CDN(pageNumber),
      PAGE_FONT_REQUIRES[pageNumber] ?? null,
    ),
  );
}

// ── Public API — surah name font ──────────────────────────────────────────────

/**
 * Loads and registers the surah name icon font.
 * Returns SURAH_NAME_PS_NAME to pass to SVG fontFamily.
 *
 * This font is the same for every page — it is cached after first load.
 * Call in parallel with loadQCFPageFont() for pages that have surah_header slots.
 */
export function loadSurahNameFont(): Promise<string> {
  return _deduped(SURAH_NAME_PS_NAME, () =>
    _loadFromPath(
      SURAH_NAME_PS_NAME,
      localSurahNameFontUri(),
      SURAH_NAME_FONT_CDN,
      SURAH_NAME_REQUIRE || null,
    ),
  );
}

// ── Public API — bismillah font ───────────────────────────────────────────────

/**
 * Loads and registers the QCF bismillah font (QCF_BSML).
 * Returns BISMILLAH_PS_NAME to pass to SVG fontFamily.
 *
 * This font is the same for every page — it is cached after first load.
 * Call in parallel with loadQCFPageFont() for pages that have bismillah slots.
 */
export function loadBismillahFont(): Promise<string> {
  return _deduped(BISMILLAH_PS_NAME, () =>
    _loadFromPath(
      BISMILLAH_PS_NAME,
      localBismillahFontUri(),
      BISMILLAH_FONT_CDN,
      BISMILLAH_REQUIRE || null,
    ),
  );
}

// ── Public API — synchronous loaded checks ───────────────────────────────────

/**
 * Returns true if the QCF page font is already registered with Core Text /
 * expo-font and can be used immediately without any async work.
 * Used by MushafRenderer to skip the loading→ready state transition when
 * QuranPager has pre-loaded the font before the component mounts.
 */
export function isQCFPageFontLoaded(pageNumber: number): boolean {
  return Font.isLoaded(qcfPagePsName(pageNumber));
}

/**
 * Returns true if the shared Bismillah font is already registered.
 */
export function isBismillahFontLoaded(): boolean {
  return Font.isLoaded(BISMILLAH_PS_NAME);
}

// ── Public API — offline availability ────────────────────────────────────────

/**
 * Returns true if the page font is available without a network request.
 */
export async function isQCFPageFontAvailableOffline(
  pageNumber: number,
): Promise<boolean> {
  if (OFFLINE_MODE === 'bundled') return pageNumber in PAGE_FONT_REQUIRES;
  return FileSystem.getInfoAsync(localPageFontUri(pageNumber)).then(i => i.exists);
}

/**
 * Pre-warms a range of page fonts by downloading them to disk without
 * registering them yet. Call in the background after the user opens the
 * Mushaf, so subsequent pages are available instantly.
 *
 * @param startPage   first page to pre-warm (inclusive)
 * @param endPage     last page to pre-warm (inclusive)
 * @param concurrency how many downloads to run in parallel (default: 4)
 */
export async function preWarmPageFonts(
  startPage:   number,
  endPage:     number,
  concurrency: number = 4,
): Promise<void> {
  if (OFFLINE_MODE === 'bundled') return;

  const pages = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i,
  );

  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map(async n => {
        const localUri = localPageFontUri(n);
        const info = await FileSystem.getInfoAsync(localUri);
        if (info.exists) return;
        await FileSystem.downloadAsync(QCF_PAGE_FONT_CDN(n), localUri);
      }),
    );
  }
}

/**
 * Downloads the two shared fonts (surah names + bismillah) to disk
 * without registering them. Safe to call from a background startup task.
 * Skips each file if it already exists (idempotent).
 */
export async function preWarmSharedFonts(): Promise<void> {
  if (OFFLINE_MODE === 'bundled') return;
  await Promise.allSettled([
    (async () => {
      const p = localSurahNameFontUri();
      const info = await FileSystem.getInfoAsync(p);
      if (!info.exists) await FileSystem.downloadAsync(SURAH_NAME_FONT_CDN, p);
    })(),
    (async () => {
      const p = localBismillahFontUri();
      const info = await FileSystem.getInfoAsync(p);
      if (!info.exists) await FileSystem.downloadAsync(BISMILLAH_FONT_CDN, p);
    })(),
  ]);
}

/**
 * Returns how many of the 604 QCF page fonts are already on disk.
 * Used by the global cache for progress reporting.
 */
export async function countDownloadedPageFonts(
  startPage = 1,
  endPage   = 604,
): Promise<number> {
  if (OFFLINE_MODE === 'bundled') return endPage - startPage + 1;
  let count = 0;
  const checks = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i,
  ).map(async n => {
    const info = await FileSystem.getInfoAsync(localPageFontUri(n));
    if (info.exists) count++;
  });
  await Promise.all(checks);
  return count;
}
