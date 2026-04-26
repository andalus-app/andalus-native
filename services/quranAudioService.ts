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
function bismillahLocalPath(reciterId: number): string {
  return `${AUDIO_DIR}r${reciterId}_bsml.mp3`;
}

// ── API ──────────────────────────────────────────────────────────────────────

// QuranCDN — same source as mushafTimingService.
// These audio files do NOT contain Bismillah at the start — verse 1 starts at 0ms.
// Bismillah audio is played separately by QuranAudioPlayer using Al-Fatiha's
// verse 1:1 recording before the surah audio begins (for surahs 2-8, 10-114).
const QDC_API = 'https://api.qurancdn.com/api/qdc';

async function resolveRemoteUrl(reciterId: number, surahId: number): Promise<string> {
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
 * QuranCDN chapter URL pattern:
 *   https://audio.qurancdn.com/{slug}/{NNN}.mp3
 *
 * Verse URL pattern (same CDN, same slug):
 *   https://audio.qurancdn.com/{slug}/mp3/{SSSSVVV}.mp3
 *   where SSSS = 3-digit surah, VVV = 3-digit verse
 *
 * This avoids hardcoding a reciter-ID → slug mapping table — the slug is
 * already embedded in the chapter URL that the QDC API returns.
 *
 * Returns null when the URL does not match the expected QuranCDN pattern,
 * indicating we should fall back to the chapter audio + timer approach.
 */
function deriveVerseAudioUrl(chapterAudioUrl: string, surahId: number, verseId: number): string | null {
  // Match "https://audio.qurancdn.com/{slug}/" at the start of the URL.
  const match = chapterAudioUrl.match(/^(https?:\/\/audio\.qurancdn\.com\/[^/]+)\//);
  if (!match) return null;
  const base = match[1]; // e.g., "https://audio.qurancdn.com/Alafasy_128kbps"
  const s = String(surahId).padStart(3, '0');
  const v = String(verseId).padStart(3, '0');
  return `${base}/mp3/${s}${v}.mp3`;
}

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
 *   2. Ask the QDC API for the Al-Fatiha chapter URL to extract the reciter
 *      slug, then derive the verse-level URL:
 *        https://audio.qurancdn.com/{slug}/mp3/001001.mp3  (~5 s clip)
 *   3. If the URL cannot be derived (different CDN pattern), fall back to
 *      downloading the full Al-Fatiha chapter file instead. In this case
 *      `isBismillahShortClip()` returns false so the caller can still use
 *      the timer-based approach.
 *
 * The file is cached at `r{reciterId}_bsml.mp3` — separate from the full
 * surah-1 download so users who never play surah 1 in full still get a
 * dedicated short clip.
 */
export async function getBismillahAudioUri(reciterId: number): Promise<string> {
  await ensureAudioDir();
  const local = bismillahLocalPath(reciterId);
  const cached = await FileSystem.getInfoAsync(local);
  if (cached.exists && (cached as FileSystem.FileInfo & { size?: number }).size) return local;

  // Resolve chapter URL to derive the verse-level URL.
  const chapterUrl = await resolveRemoteUrl(reciterId, 1); // Al-Fatiha chapter
  const verseUrl = deriveVerseAudioUrl(chapterUrl, 1, 1);
  const downloadUrl = verseUrl ?? chapterUrl; // fallback to chapter if pattern mismatch

  const dl = FileSystem.createDownloadResumable(downloadUrl, local);
  const result = await dl.downloadAsync();
  if (!result?.uri) {
    await FileSystem.deleteAsync(local, { idempotent: true });
    throw new Error('Bismillah audio download failed');
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
