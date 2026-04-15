/**
 * bernstromTranslation.ts
 *
 * Knut Bernström's Swedish translation of the Quran.
 * © Knut Bernström / Sakina Förlag AB — all rights reserved.
 *
 * Source: 30 Word documents supplied by Sakina Förlag AB, parsed 2026-04-02.
 *
 * Coverage: 6 235 of 6 236 verses (113/114 surahs fully complete).
 *   Missing: 80:42 — genuinely absent in the source documents.
 *
 * Usage:
 *   import { getBernstrom, BERNSTROM_META } from '@/data/bernstromTranslation';
 *   const text = getBernstrom(1, 1); // "I Guds, Den Nåderikes, Den Barmhärtiges Namn!"
 *
 * Key format inside the JSON: "surah:verse"  e.g. "2:255"
 * This matches the verse_key format used by mushafApi.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _data: Record<string, string> = require('./bernstromTranslation.json');

/** Copyright and attribution metadata shown in the UI wherever the translation is displayed. */
export const BERNSTROM_META = {
  translator: 'Knut Bernström',
  publisher:  'Sakina Förlag AB',
  /** Full attribution line ready for UI display */
  credit:     '© Knut Bernström / Sakina Förlag AB',
} as const;

/**
 * Look up a verse translation by surah and ayah number.
 *
 * @param surah  1-based surah number (1–114)
 * @param ayah   1-based verse number
 * @returns      Swedish translation string, or undefined if not found
 */
export function getBernstrom(surah: number, ayah: number): string | undefined {
  return _data[`${surah}:${ayah}`];
}

/**
 * Look up a verse translation using a verse_key string (e.g. "2:255").
 * This matches the verse_key format returned by the Quran Foundation API.
 */
export function getBernstromByKey(verseKey: string): string | undefined {
  return _data[verseKey];
}

/** The full translation map — keyed by "surah:verse". Use getBernstrom() for single lookups. */
export const BERNSTROM_DATA: Readonly<Record<string, string>> = _data;
