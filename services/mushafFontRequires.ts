/**
 * mushafFontRequires.ts — bundled font requires for OFFLINE_MODE='bundled'
 *
 * Currently empty because OFFLINE_MODE='download' is active.
 * Fonts are downloaded at runtime from CDN — not bundled in the app binary.
 *
 * To re-enable bundled mode:
 *   1. Run: node scripts/downloadQCFFonts.js
 *   2. Run: node scripts/generateFontRequires.js  (regenerates this file)
 *   3. Set OFFLINE_MODE = 'bundled' in mushafFontManager.ts
 */

export const PAGE_FONT_REQUIRES: Record<number, number> = {};
export const SURAH_NAME_REQUIRE: number | null = null;
export const BISMILLAH_REQUIRE: number | null = null;
