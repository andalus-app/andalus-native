/**
 * quranAudioService.ts
 *
 * Resolves audio URLs for Quran recitations and manages download caching
 * to DocumentDir (survives app restarts, unlike CacheDir).
 *
 * Audio API: https://api.quran.com/api/v4/chapter_recitations/{recitationId}/{chapterId}
 * Returns: { audio_file: { audio_url: string } }
 */

import * as FileSystem from 'expo-file-system/legacy';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Reciter = {
  id: number;
  name: string;          // Display name (Swedish-friendly)
  style: string;         // 'Murattal' | 'Mujawwad'
};

// ── Reciter catalogue ────────────────────────────────────────────────────────

// IDs correspond to QuranCDN reciter IDs (api.qurancdn.com/api/qdc/audio/reciters).
// Sorted alphabetically by display name (A → Ö).
export const RECITERS: Reciter[] = [
  { id: 2,   name: 'AbdulBaset AbdulSamad',            style: 'Murattal'  },
  { id: 1,   name: 'AbdulBaset AbdulSamad',            style: 'Mujawwad'  },
  { id: 3,   name: 'Abdur-Rahman as-Sudais',           style: 'Murattal'  },
  { id: 4,   name: 'Abu Bakr al-Shatri',               style: 'Murattal'  },
  { id: 5,   name: 'Hani ar-Rifai',                    style: 'Murattal'  },
  { id: 161, name: 'Khalifah Al Tunaiji',              style: 'Murattal'  },
  { id: 12,  name: 'Mahmoud Khalil Al-Husary',         style: 'Muallim'   },
  { id: 6,   name: 'Mahmoud Khalil Al-Husary',         style: 'Murattal'  },
  { id: 159, name: 'Maher Al Muaiqly',                 style: 'Murattal'  },
  { id: 7,   name: "Mishari Rashid al-'Afasy",         style: 'Murattal'  },
  { id: 9,   name: 'Mohamed Siddiq al-Minshawi',       style: 'Murattal'  },
  { id: 10,  name: "Sa'ud ash-Shuraim",                style: 'Murattal'  },
  { id: 97,  name: 'Yasser Ad Dussary',                style: 'Murattal'  },
];

export const DEFAULT_RECITER_ID = 7; // Mishari Rashid al-Afasy

// ── Paths ────────────────────────────────────────────────────────────────────

const AUDIO_DIR = `${FileSystem.documentDirectory}quran_audio/`;

function audioFileName(reciterId: number, surahId: number): string {
  return `r${reciterId}_s${String(surahId).padStart(3, '0')}.mp3`;
}

function localAudioPath(reciterId: number, surahId: number): string {
  return `${AUDIO_DIR}${audioFileName(reciterId, surahId)}`;
}

/**
 * Dedicated cache path for the bismillah clip (Al-Fatiha verse 1:1).
 * Separate from the full surah-1 cache so it can be downloaded independently
 * as a short (~5 s) file without pulling the entire Al-Fatiha chapter.
 */
// Cache filename bumped to v3 (2026-05-03) — v2 files for reciters like Yasser
// Ad Dussary (ID 97) were still storing the FULL Al-Fatiha chapter because the
// "last resort" fallback in getBismillahAudioUri downloaded it when both verse-API
// and CDN regex derivation failed. Fallback 2 has been removed; if verse-level
// resolution fails the engine now skips the bismillah track entirely instead of
// playing the full chapter. v3 forces a clean re-download with the fixed logic.
function bismillahLocalPath(reciterId: number): string {
  return `${AUDIO_DIR}r${reciterId}_bsml_v3.mp3`;
}

// ── API ──────────────────────────────────────────────────────────────────────

// QuranCDN — same source as mushafTimingService.
// These audio files do NOT contain Bismillah at the start — verse 1 starts at 0ms.
// Bismillah audio is played separately by QuranAudioPlayer using Al-Fatiha's
// verse 1:1 recording before the surah audio begins (for surahs 2-8, 10-114).
const QDC_API = 'https://api.qurancdn.com/api/qdc';

async function resolveRemoteUrl(reciterId: number, surahId: number): Promise<string> {
  const template = CHAPTER_URL_TEMPLATES[reciterId];
  if (template) return template(surahId);
  const url = `${QDC_API}/audio/reciters/${reciterId}/audio_files?chapter=${surahId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`QDC Audio API ${resp.status} for surah ${surahId}`);
  const json = await resp.json() as { audio_files: Array<{ audio_url: string }> };
  const audioUrl = json.audio_files?.[0]?.audio_url;
  if (!audioUrl) throw new Error(`No audio_url in QDC response for surah ${surahId}`);
  return audioUrl;
}

/**
 * Derives the verse-level audio URL from the chapter audio URL.
 *
 * QuranCDN chapter URL pattern (any host):
 *   {scheme}://{host}/{slug}/{NNN}.mp3
 *
 * Verse URL pattern (same host, same slug):
 *   {scheme}://{host}/{slug}/mp3/{SSSVVV}.mp3
 *   where SSS = 3-digit surah, VVV = 3-digit verse
 *
 * The slug is already embedded in the chapter URL the QDC API returns, so we
 * never need a hardcoded reciter-ID → slug table. The host is also derived
 * from the chapter URL — historically the regex only matched
 * `audio.qurancdn.com`, but several QDC reciters serve from alternative
 * QuranCDN buckets (e.g. `verses.quran.com`). Matching by structure rather
 * than hostname keeps verse-loop available for every reciter QDC returns.
 *
 * Returns null only when the chapter URL doesn't end in a {slug}/{NNN}.mp3
 * pattern at all — in that case the caller must surface a clean error
 * instead of silently falling back to the unstable mid-track-seek path.
 */
function deriveVerseAudioUrl(chapterAudioUrl: string, surahId: number, verseId: number): string | null {
  // Strip any query / fragment before structural match.
  const clean = chapterAudioUrl.split(/[?#]/)[0];
  // Capture "{scheme}://{host}/{slug}" with at least one path segment of the
  // form {NNN}.mp3 (chapter file).
  const m = clean.match(/^(https?:\/\/[^/]+\/[^/]+)\/[^/]+\.(?:mp3|ogg|m4a)$/i);
  if (!m) return null;
  const base = m[1];
  const s = String(surahId).padStart(3, '0');
  const v = String(verseId).padStart(3, '0');
  return `${base}/mp3/${s}${v}.mp3`;
}

// Mapping from QuranCDN reciter ID → everyayah.com directory slug.
// Used for reciters not available via the Quran.com per-verse API (which only
// covers IDs 1–12) and whose QuranCDN chapter URLs don't yield valid per-verse
// paths via deriveVerseAudioUrl.
// Verified: everyayah.com hosts full per-verse collections for these reciters.
const EVERYAYAH_SLUGS: Partial<Record<number, string>> = {
  97:  'Yasser_Ad-Dussary_128kbps',
  159: 'Maher_AlMuaiqly_64kbps',
};

function everyayahVerseUrl(slug: string, surahId: number, verseId: number): string {
  const s = String(surahId).padStart(3, '0');
  const v = String(verseId).padStart(3, '0');
  return `https://everyayah.com/data/${slug}/${s}${v}.mp3`;
}

// Reciters whose chapter audio is not served by QuranCDN.
// Key: local reciter ID (≥ 1000). Value: function returning the chapter MP3 URL.
const CHAPTER_URL_TEMPLATES: Partial<Record<number, (surahId: number) => string>> = {};


// ── Public API ───────────────────────────────────────────────────────────────

/** Ensure AUDIO_DIR exists — call once on app start or before first download. */
export async function ensureAudioDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  }
}

/**
 * Returns the local URI for the bismillah audio clip (Al-Fatiha verse 1:1),
 * downloading and caching it first if needed.
 *
 * Strategy:
 *   1. Return the cached file immediately if it already exists.
 *   2. Resolve the canonical per-verse URL via the Quran.com API
 *      (`/api/v4/recitations/{id}/by_ayah/1:1` → `verses.quran.com/...`).
 *   3. If the API returns nothing usable, fall back to the legacy chapter-URL
 *      regex derivation.
 *   4. If neither approach yields a verse-level URL, throw — do NOT fall back
 *      to the full Al-Fatiha chapter. The engine catches and skips the bismillah
 *      pre-track so the surah plays directly.
 *
 * Cached at `r{reciterId}_bsml_v3.mp3`.
 */
export async function getBismillahAudioUri(reciterId: number): Promise<string> {
  await ensureAudioDir();
  const local = bismillahLocalPath(reciterId);
  const cached = await FileSystem.getInfoAsync(local);
  if (cached.exists && (cached as FileSystem.FileInfo & { size?: number }).size) return local;

  // Primary: canonical Quran.com API for verse 1:1 of Al-Fatiha (the bismillah).
  let downloadUrl: string | null = await resolveVerseAudioUrlViaApi(reciterId, 1, 1);

  // Fallback: legacy chapter-URL regex derivation.
  if (!downloadUrl) {
    try {
      const chapterUrl = await resolveRemoteUrl(reciterId, 1);
      downloadUrl = deriveVerseAudioUrl(chapterUrl, 1, 1);
    } catch {
      // Chapter URL fetch failed.
    }
  }

  // Fallback: everyayah.com for reciters not on the Quran.com per-verse API.
  if (!downloadUrl) {
    const slug = EVERYAYAH_SLUGS[reciterId];
    if (slug) downloadUrl = everyayahVerseUrl(slug, 1, 1);
  }

  // If no verse-level URL was found, throw.
  // The engine catches this and skips the bismillah track, playing the surah
  // directly — far better than downloading the full Al-Fatiha chapter (~3 min)
  // as a "bismillah" and blocking the actual surah from playing.
  if (!downloadUrl) {
    throw new Error('Bismillah verse audio URL unavailable for reciter ' + reciterId);
  }

  const dl = FileSystem.createDownloadResumable(downloadUrl, local);
  const result = await dl.downloadAsync();
  if (!result?.uri) {
    await FileSystem.deleteAsync(local, { idempotent: true });
    throw new Error('Bismillah audio download failed');
  }
  // Sanity-check size (HTML 404 bodies are < 1 KB).
  const info = await FileSystem.getInfoAsync(local) as FileSystem.FileInfo & { size?: number };
  if (!info.exists || !info.size || info.size < 1024) {
    await FileSystem.deleteAsync(local, { idempotent: true });
    throw new Error('Bismillah audio download invalid');
  }
  return local;
}

/** True if the bismillah clip has already been downloaded to DocumentDir. */
export async function isBismillahDownloaded(reciterId: number): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(bismillahLocalPath(reciterId));
  return info.exists && !!((info as FileSystem.FileInfo & { size?: number }).size);
}

/** Deletes the cached bismillah clip for a reciter (e.g. on reciter change). */
export async function deleteBismillahAudio(reciterId: number): Promise<void> {
  await FileSystem.deleteAsync(bismillahLocalPath(reciterId), { idempotent: true });
}

/**
 * Cache path for a per-verse audio file (single ayah recording).
 * Used by the verse-repeat path: when the user enables "repeat this verse",
 * the audio engine swaps the chapter source for this single-verse file and
 * sets `player.loop = true`, so iOS loops the verse natively without ever
 * waking the JS bridge — surviving locked-screen JS throttling indefinitely.
 */
function verseLocalPath(reciterId: number, surahId: number, verseId: number): string {
  const s = String(surahId).padStart(3, '0');
  const v = String(verseId).padStart(3, '0');
  return `${AUDIO_DIR}r${reciterId}_v${s}${v}.mp3`;
}

/**
 * Resolves the canonical per-verse audio URL via the Quran.com API.
 *   GET https://api.quran.com/api/v4/recitations/{recitationId}/by_ayah/{verseKey}
 *   → { audio_files: [{ url: "Alafasy/mp3/002001.mp3" }] }
 *
 * The API returns a path relative to https://verses.quran.com/, which is the
 * canonical CDN host for per-verse audio. The slug used here ("Alafasy") is
 * NOT the same as the chapter-URL slug ("mishari_al_afasy" inside the qdc
 * bucket) — that's why the legacy `deriveVerseAudioUrl` regex approach is
 * fundamentally fragile. Always prefer the API.
 *
 * Returns null on network error / missing entry. Caller falls back to the
 * legacy regex-based derivation as a best-effort secondary path.
 */
async function resolveVerseAudioUrlViaApi(
  reciterId: number,
  surahId: number,
  verseId: number,
): Promise<string | null> {
  const verseKey = `${surahId}:${verseId}`;
  const apiUrl = `https://api.quran.com/api/v4/recitations/${reciterId}/by_ayah/${verseKey}`;
  try {
    const resp = await fetch(apiUrl);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { audio_files?: Array<{ url?: string }> };
    const relative = json.audio_files?.[0]?.url;
    if (!relative || typeof relative !== 'string') return null;
    const trimmed = relative.trim();
    if (!trimmed) return null;
    // The Quran.com API returns three URL shapes depending on the reciter:
    //   1. `Alafasy/mp3/001007.mp3` (most reciters) → prefix verses.quran.com
    //   2. `//mirrors.quranicaudio.com/everyayah/...` (Husary id=6, 12)
    //      → protocol-relative; prefix `https:` (NOT verses.quran.com — the
    //      host is in the URL itself)
    //   3. `https://...` (rare, defensive) → use as-is
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    return `https://verses.quran.com/${trimmed}`;
  } catch {
    return null;
  }
}

/**
 * Returns a local file:// URI for the single-verse audio of (surah, verse),
 * downloading and caching it on first call. Returns `null` only when both the
 * canonical Quran.com API AND the legacy chapter-URL derivation fail to
 * produce a working per-verse URL — the caller (engine) then surfaces the
 * "Vers-upprepning ej tillgänglig" notification and falls back to chapter
 * playback.
 *
 * Strategy:
 *   1. Return the cached file immediately if it exists.
 *   2. Resolve the canonical per-verse URL via the Quran.com API
 *      (`/api/v4/recitations/{id}/by_ayah/{verseKey}` → `verses.quran.com/...`).
 *   3. If the API returns nothing usable, fall back to the legacy
 *      `deriveVerseAudioUrl` regex on the chapter URL — works for older
 *      reciters whose chapter URLs still match `{host}/{slug}/{NNN}.mp3`.
 *   4. Download to `r{reciterId}_v{NNN}{NNN}.mp3`.
 *
 * Files are small (most verses are 3–30 s of audio), so no eviction policy is
 * applied here — the user clearing app storage / reinstalling is sufficient.
 */
export async function getVerseAudioUri(
  reciterId: number,
  surahId: number,
  verseId: number,
): Promise<string | null> {
  await ensureAudioDir();
  const local = verseLocalPath(reciterId, surahId, verseId);
  const cached = await FileSystem.getInfoAsync(local);
  if (cached.exists && (cached as FileSystem.FileInfo & { size?: number }).size) {
    return local;
  }

  // Primary: the canonical Quran.com API. Works for every reciter exposed by
  // Quran.com (which is the same set RECITERS is curated from).
  let verseUrl: string | null = await resolveVerseAudioUrlViaApi(reciterId, surahId, verseId);

  // Fallback: derive from the chapter URL via the legacy regex. Only catches
  // a small subset of reciters today — the chapter URL format moved away from
  // `{host}/{slug}/{NNN}.mp3` for most reciters. Kept as a safety net for any
  // remaining legacy CDN paths.
  if (!verseUrl) {
    try {
      const chapterUrl = await resolveRemoteUrl(reciterId, surahId);
      verseUrl = deriveVerseAudioUrl(chapterUrl, surahId, verseId);
    } catch {
      // fall through to everyayah.com
    }
  }

  // Fallback: everyayah.com for reciters not on the Quran.com per-verse API
  // (only IDs 1–12 are supported there) whose QuranCDN chapter URLs don't
  // yield valid per-verse paths via deriveVerseAudioUrl.
  if (!verseUrl) {
    const slug = EVERYAYAH_SLUGS[reciterId];
    if (slug) verseUrl = everyayahVerseUrl(slug, surahId, verseId);
  }

  if (!verseUrl) return null;

  // Download. If the bucket returns 404 or an HTML error body, treat as
  // unavailable — caller hard-disables verse-repeat for this reciter so the
  // user sees a clear error rather than a flaky seek-loop fallback.
  try {
    const dl = FileSystem.createDownloadResumable(verseUrl, local);
    const result = await dl.downloadAsync();
    if (!result?.uri) {
      await FileSystem.deleteAsync(local, { idempotent: true });
      return null;
    }
    // Sanity-check size — some buckets return a 200 with an HTML error body.
    // A real per-verse mp3 is at minimum a few KB; anything under 1 KB is junk.
    const info = await FileSystem.getInfoAsync(local) as FileSystem.FileInfo & { size?: number };
    if (!info.exists || !info.size || info.size < 1024) {
      await FileSystem.deleteAsync(local, { idempotent: true });
      return null;
    }
    return local;
  } catch {
    await FileSystem.deleteAsync(local, { idempotent: true });
    return null;
  }
}

/**
 * Returns the best available URI for a surah:
 * 1. If already cached locally → returns file:// URI immediately
 * 2. Otherwise → resolves remote URL from API (stream; no download yet)
 *
 * To pre-download call `downloadSurahAudio()` separately.
 */
export async function getAudioUri(
  reciterId: number,
  surahId: number,
): Promise<string> {
  const local = localAudioPath(reciterId, surahId);
  const info = await FileSystem.getInfoAsync(local);
  if (info.exists && info.size > 0) return local;
  return resolveRemoteUrl(reciterId, surahId);
}

/**
 * Downloads a surah audio file to DocumentDir.
 * Calls progressCallback with [bytesDownloaded, bytesTotal] during download.
 * Returns the local file:// path on success.
 *
 * cancelRef — optional ref whose .current will be set to a cancel function while
 * the download is active. Calling it pauses expo-file-system and deletes the
 * partial file, then throws a CancelledError so callers can distinguish an
 * explicit cancel from a real network error.
 */
export class DownloadCancelledError extends Error {
  constructor() { super('download_cancelled'); }
}

export async function downloadSurahAudio(
  reciterId: number,
  surahId: number,
  progressCallback?: (downloaded: number, total: number) => void,
  cancelRef?: { current: (() => void) | null },
): Promise<string> {
  await ensureAudioDir();
  const dest = localAudioPath(reciterId, surahId);

  // Skip if already complete
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists && info.size > 0) return dest;

  const remoteUrl = await resolveRemoteUrl(reciterId, surahId);
  const dl = FileSystem.createDownloadResumable(
    remoteUrl,
    dest,
    {},
    progressCallback
      ? (p) => progressCallback(p.totalBytesWritten, p.totalBytesExpectedToWrite)
      : undefined,
  );

  // Expose a cancel hook: pause the download and delete the partial file.
  if (cancelRef) {
    cancelRef.current = () => {
      cancelRef.current = null;
      dl.pauseAsync().catch(() => undefined);
      FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    };
  }

  try {
    const result = await dl.downloadAsync();
    if (cancelRef) cancelRef.current = null;
    // pauseAsync() causes downloadAsync() to resolve with null — treat as cancel.
    if (!result?.uri) throw new DownloadCancelledError();
    return result.uri;
  } catch (e) {
    if (cancelRef) cancelRef.current = null;
    throw e;
  }
}

/** Returns true if surah audio is already cached locally. */
export async function isSurahDownloaded(
  reciterId: number,
  surahId: number,
): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(localAudioPath(reciterId, surahId));
  return info.exists && (info as FileSystem.FileInfo & { size?: number }).size !== undefined && ((info as FileSystem.FileInfo & { size: number }).size > 0);
}

/** Deletes the cached audio file for a surah. */
export async function deleteSurahAudio(
  reciterId: number,
  surahId: number,
): Promise<void> {
  const local = localAudioPath(reciterId, surahId);
  const info = await FileSystem.getInfoAsync(local);
  if (info.exists) await FileSystem.deleteAsync(local, { idempotent: true });
}

/** Returns total bytes used by all cached audio files. */
export async function cachedAudioBytes(): Promise<number> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!info.exists) return 0;
  const files = await FileSystem.readDirectoryAsync(AUDIO_DIR);
  let total = 0;
  await Promise.all(
    files.map(async (f) => {
      const fi = await FileSystem.getInfoAsync(`${AUDIO_DIR}${f}`) as FileSystem.FileInfo & { size?: number };
      if (fi.exists && fi.size) total += fi.size;
    }),
  );
  return total;
}

/** Returns bytes cached for a specific reciter. */
export async function cachedReciterBytes(reciterId: number): Promise<number> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!info.exists) return 0;
  const files = await FileSystem.readDirectoryAsync(AUDIO_DIR);
  const prefix = `r${reciterId}_`;
  let total = 0;
  await Promise.all(
    files
      .filter((f) => f.startsWith(prefix))
      .map(async (f) => {
        const fi = await FileSystem.getInfoAsync(`${AUDIO_DIR}${f}`) as FileSystem.FileInfo & { size?: number };
        if (fi.exists && fi.size) total += fi.size;
      }),
  );
  return total;
}

/** Deletes all cached audio for a reciter. */
export async function deleteReciterCache(reciterId: number): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!info.exists) return;
  const files = await FileSystem.readDirectoryAsync(AUDIO_DIR);
  await Promise.all(
    files
      .filter((f) => f.startsWith(`r${reciterId}_`))
      .map((f) => FileSystem.deleteAsync(`${AUDIO_DIR}${f}`, { idempotent: true })),
  );
}
