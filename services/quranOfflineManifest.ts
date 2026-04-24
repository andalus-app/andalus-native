/**
 * quranOfflineManifest.ts
 *
 * Tracks which Mushaf pages have been downloaded and cached to disk.
 *
 * Loaded once at startup into a flat in-memory Map for O(1) lookups.
 * Persisted as a single JSON file with an atomic write (tmp → rename)
 * so a mid-write app kill can never corrupt the manifest.
 *
 * Scope: page DATA only.
 *   Font status is tracked separately via mushafFontManager.ts
 *   (Font.isLoaded + FileSystem.getInfoAsync). Chapter (surah) metadata
 *   stays in AsyncStorage under its existing keys and is not touched here.
 *
 * Backward compatibility:
 *   The AsyncStorage page cache (andalus_mushaf_cache_v4_*) is left intact.
 *   mushafApi.ts continues to use it until quranPageFileStore.ts is fully
 *   integrated. Manifest and FileStore are additive — no existing data is
 *   deleted or overwritten.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { qLog, qWarn }  from './quranPerfLogger';

// ── Paths ─────────────────────────────────────────────────────────────────────

export const MANIFEST_DIR  = `${FileSystem.documentDirectory}andalus/mushaf/`;
const MANIFEST_PATH = `${MANIFEST_DIR}manifest.json`;
const MANIFEST_TMP  = `${MANIFEST_DIR}manifest.json.tmp`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type PageDataStatus = 'missing' | 'done' | 'failed';

export type ManifestEntry = {
  /** Whether page JSON is on disk and readable. */
  data: PageDataStatus;
  /**
   * Schema version of the stored ComposedMushafPage JSON.
   * Must equal CURRENT_DATA_VERSION; pages with an older version are
   * treated as 'missing' and re-fetched.
   */
  dataVersion: number;
};

/**
 * Bump whenever the ComposedMushafPage serialisation format changes (new
 * fields, type renames, etc.) so old cached files are discarded cleanly.
 */
export const CURRENT_DATA_VERSION = 1;

type ManifestJson = {
  /** Manifest file format version — not the same as CURRENT_DATA_VERSION. */
  schemaVersion: number;
  entries: Record<string, ManifestEntry>;
};

const SCHEMA_VERSION = 1;

// ── In-memory state ───────────────────────────────────────────────────────────

const _entries = new Map<number, ManifestEntry>();
let _dirty     = false;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

// ── Initialisation ────────────────────────────────────────────────────────────

let _initPromise: Promise<void> | null = null;

/**
 * Loads the manifest from disk into memory.
 * Safe to call multiple times — subsequent calls return the same Promise.
 * Must be awaited before any read/write operations.
 */
export function initManifest(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = _load();
  return _initPromise;
}

async function _load(): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(MANIFEST_DIR, { intermediates: true });

    const info = await FileSystem.getInfoAsync(MANIFEST_PATH);
    if (!info.exists) return; // fresh install — empty map is correct

    const raw  = await FileSystem.readAsStringAsync(MANIFEST_PATH);
    const json = JSON.parse(raw) as ManifestJson;

    if (json.schemaVersion !== SCHEMA_VERSION) {
      // Schema changed — start fresh. Pages will be re-downloaded.
      qLog('Manifest schema version mismatch — resetting');
      return;
    }

    for (const [key, entry] of Object.entries(json.entries)) {
      const n = parseInt(key, 10);
      if (!isNaN(n) && n >= 1 && n <= 604) {
        _entries.set(n, entry);
      }
    }

    const done = [..._entries.values()].filter(
      e => e.data === 'done' && e.dataVersion === CURRENT_DATA_VERSION,
    ).length;
    qLog(`Manifest loaded — ${done}/604 pages cached on disk`);
  } catch {
    // Corrupt or unreadable — start fresh. Overwritten on next save.
    _entries.clear();
    qWarn('Manifest load failed — starting fresh');
  }
}

// ── Reads (O(1), synchronous after init) ──────────────────────────────────────

/**
 * Returns true if page N has valid cached data on disk.
 * Requires initManifest() to have been awaited.
 */
export function isPageCached(pageNumber: number): boolean {
  const e = _entries.get(pageNumber);
  return e?.data === 'done' && e.dataVersion === CURRENT_DATA_VERSION;
}

/** Returns the raw manifest entry, or null if the page is not tracked. */
export function getPageEntry(pageNumber: number): ManifestEntry | null {
  return _entries.get(pageNumber) ?? null;
}

/** Count of pages with status 'done' and current data version. */
export function getCachedPageCount(): number {
  let n = 0;
  for (const e of _entries.values()) {
    if (e.data === 'done' && e.dataVersion === CURRENT_DATA_VERSION) n++;
  }
  return n;
}

/** Returns a list of all page numbers whose data status is 'missing' or 'failed'. */
export function getMissingPages(): number[] {
  const missing: number[] = [];
  for (let p = 1; p <= 604; p++) {
    if (!isPageCached(p)) missing.push(p);
  }
  return missing;
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Marks a page as successfully cached on disk.
 * Schedules a debounced disk write (200 ms) so rapid marks coalesce.
 */
export function markPageDone(pageNumber: number): void {
  _entries.set(pageNumber, { data: 'done', dataVersion: CURRENT_DATA_VERSION });
  _scheduleSave();
}

/**
 * Marks a page fetch as failed.
 * Will not downgrade a page that is already 'done' (cached data stays valid).
 */
export function markPageFailed(pageNumber: number): void {
  const existing = _entries.get(pageNumber);
  if (existing?.data !== 'done') {
    _entries.set(pageNumber, { data: 'failed', dataVersion: CURRENT_DATA_VERSION });
    _scheduleSave();
  }
}

/**
 * Removes a page's entry, forcing re-download on next access.
 * Use after a data version bump or detected file corruption.
 */
export function invalidatePage(pageNumber: number): void {
  if (_entries.has(pageNumber)) {
    _entries.delete(pageNumber);
    _scheduleSave();
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

function _scheduleSave(): void {
  _dirty = true;
  if (_saveTimer !== null) return; // already scheduled
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (_dirty) _saveNow().catch(() => {});
  }, 200);
}

/**
 * Atomic write: tmp file → rename.
 * iOS rename() is atomic — a mid-write crash leaves the old manifest intact.
 */
async function _saveNow(): Promise<void> {
  _dirty = false;
  const entries: Record<string, ManifestEntry> = {};
  for (const [n, entry] of _entries) {
    entries[String(n)] = entry;
  }
  const json: ManifestJson = { schemaVersion: SCHEMA_VERSION, entries };
  try {
    await FileSystem.writeAsStringAsync(MANIFEST_TMP, JSON.stringify(json));
    await FileSystem.moveAsync({ from: MANIFEST_TMP, to: MANIFEST_PATH });
  } catch (e) {
    qWarn(`Manifest save failed: ${String(e)}`);
  }
}

/**
 * Flushes any pending debounced write immediately.
 * Call from an AppState 'background' handler so recent marks survive
 * the process being suspended before the 200 ms debounce fires.
 */
export async function flushManifest(): Promise<void> {
  if (_saveTimer !== null) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (_dirty) await _saveNow();
}
