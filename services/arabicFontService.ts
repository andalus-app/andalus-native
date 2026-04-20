/**
 * arabicFontService.ts
 *
 * Downloads, caches and registers Arabic fonts for use in ArabicText.tsx.
 * Zero effect on any other part of the app.
 *
 * All URLs are verified (HTTP 200, correct Content-Type, real font bytes):
 *
 *   KFGQPC  — github.com/fatihkoker/hidayah — OTF hosted in app owner's repo.
 *             Reliable source. 20 s timeout, priority 1.
 *
 *   Amiri   — github.com/aliftype/amiri — verified 200 OK, 612 944 bytes.
 *             Pinned to release tag 1.003 + main-branch fallback.
 *
 *   Scheherazade New — github.com/silnrsi/font-scheherazade
 *             Verified 200 OK, 331 304 bytes.
 *             File lives in references/, not results/.
 *             Pinned to tag v4.500 + master-branch fallback.
 *
 * Why not Google Fonts CSS API:
 *   Google Fonts returns WOFF2 for every User-Agent now.
 *   expo-font / React Native Core Text requires TTF or OTF.
 *   WOFF2 cannot be registered as a native font — it is a web-only format.
 *
 * Why not jsDelivr CDN for these fonts:
 *   jsDelivr compresses font files (~50 % size reduction).
 *   Compressed TTF bytes are not a valid font binary and will fail
 *   to register with iOS Core Text / Android FreeType.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Font from 'expo-font';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Constants ─────────────────────────────────────────────────────────────────

const FONTS_DIR = `${FileSystem.documentDirectory}arabic_fonts/`;
const META_KEY  = 'andalus_arabic_font_meta_v1';

// Arabic fonts are 100 KB – 700 KB. Anything below 50 KB is an error page
// or a corrupt partial download.
const MIN_FONT_BYTES = 50_000;

// ── Types ─────────────────────────────────────────────────────────────────────

type FontStatus = 'idle' | 'downloading' | 'ready' | 'failed';

export type ArabicFontState = {
  status: FontStatus;
  /** fontFamily name to pass to Text style, or null → use system font. */
  family: string | null;
};

type CachedMeta = {
  family:       string;
  filename:     string;
  downloadedAt: number;
};

type FontSpec = {
  id:          string;
  displayName: string;
  /** Key used with Font.loadAsync and as fontFamily in Text styles. */
  family:      string;
  /** Local filename inside FONTS_DIR. */
  filename:    string;
  /**
   * Direct TTF/OTF URLs tried in order.
   * Every URL here is a verified binary font file (HTTP 200, correct size).
   */
  candidateUrls: string[];
  /**
   * Per-spec download timeout in ms.
   * All specs use 20 s — sufficient for GitHub raw content over mobile networks.
   */
  downloadTimeoutMs: number;
};

// ── Font catalogue (verified URLs) ───────────────────────────────────────────

const FONT_SPECS: FontSpec[] = [
  {
    id:          'kfgqpc',
    displayName: 'KFGQPC Uthman Taha Naskh',
    family:      'KFGQPCUthmanTahaNaskh',
    // OTF — expo-font supports both TTF and OTF via Core Text / FreeType.
    filename:    'KFGQPCUthmanTahaNaskh.otf',
    downloadTimeoutMs: 20_000,
    candidateUrls: [
      'https://github.com/fatihkoker/hidayah/raw/refs/heads/main/UthmanTN1B-Ver10.otf',
    ],
  },
  {
    id:          'amiri',
    displayName: 'Amiri',
    family:      'AmiriArabic',
    filename:    'Amiri.ttf',
    downloadTimeoutMs: 20_000,
    candidateUrls: [
      // Verified: HTTP 200, 612 944 bytes, TTF binary. Tag 1.003.
      'https://raw.githubusercontent.com/aliftype/amiri/1.003/fonts/Amiri-Regular.ttf',
      // main branch — same file without version pin.
      'https://raw.githubusercontent.com/aliftype/amiri/main/fonts/Amiri-Regular.ttf',
    ],
  },
  {
    id:          'scheherazade',
    displayName: 'Scheherazade New',
    family:      'ScheherazadeNewArabic',
    filename:    'ScheherazadeNew.ttf',
    downloadTimeoutMs: 20_000,
    candidateUrls: [
      // Verified: HTTP 200, 331 304 bytes, TTF binary. Tag v4.500.
      // NOTE: file is in references/, NOT results/ (results/ does not exist).
      'https://raw.githubusercontent.com/silnrsi/font-scheherazade/refs/tags/v4.500/references/ScheherazadeNew-Regular.ttf',
      // master branch fallback, same directory.
      'https://raw.githubusercontent.com/silnrsi/font-scheherazade/master/references/ScheherazadeNew-Regular.ttf',
    ],
  },
];

// ── Singleton state ───────────────────────────────────────────────────────────
//
// All module-level. Safe because Metro bundles once per app session and
// module scope is shared across all React component instances.

let _state: ArabicFontState = { status: 'idle', family: null };

// _initPromise is set on the first init() call.
// Every subsequent caller (from any ArabicText component) receives the
// same promise — no duplicate downloads, no race conditions.
let _initPromise: Promise<void> | null = null;

let _dirReady = false;

type Listener = (state: ArabicFontState) => void;
const _listeners = new Set<Listener>();

function _setState(patch: Partial<ArabicFontState>): void {
  _state = { ..._state, ...patch };
  for (const fn of _listeners) fn(_state);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${ms}ms — ${label}`)), ms),
    ),
  ]);
}

async function ensureDir(): Promise<void> {
  if (_dirReady) return;
  const info = await FileSystem.getInfoAsync(FONTS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(FONTS_DIR, { intermediates: true });
  }
  _dirReady = true;
}

async function isValidFont(path: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    return info.exists && (info.size ?? 0) >= MIN_FONT_BYTES;
  } catch {
    return false;
  }
}

// ── Font registration ─────────────────────────────────────────────────────────

async function registerFont(spec: FontSpec): Promise<boolean> {
  const path = FONTS_DIR + spec.filename;

  if (!(await isValidFont(path))) {
    console.warn(`[ArabicFont] ${spec.displayName}: file missing or too small — cannot register`);
    return false;
  }

  try {
    // localPath already has the file:// prefix from FileSystem.documentDirectory.
    // Font.loadAsync with { uri } loads from the local filesystem — same pattern
    // as mushafFontManager.ts in this project.
    await Font.loadAsync({ [spec.family]: { uri: path } });
    console.log(`[ArabicFont] ${spec.displayName}: registered as "${spec.family}" ✓`);
    return true;
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? e);
    // CTFontManagerError 104 = kCTFontManagerErrorAlreadyRegistered.
    // iOS keeps font registrations alive across hot reloads / CMD+R.
    // expo-font's session tracker loses them, but the font IS usable.
    if (msg.includes('104') || /already.?registered/i.test(msg)) {
      console.log(`[ArabicFont] ${spec.displayName}: already registered (iOS 104) — treating as success`);
      return true;
    }
    console.warn(`[ArabicFont] ${spec.displayName}: Font.loadAsync failed —`, msg);
    return false;
  }
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Tries each candidateUrl for this spec in order.
 * Returns true when a valid font file lands on disk.
 * Cleans up partial/corrupt downloads before trying the next URL.
 */
async function downloadFont(spec: FontSpec): Promise<boolean> {
  const path = FONTS_DIR + spec.filename;

  for (const url of spec.candidateUrls) {
    console.log(`[ArabicFont] ${spec.displayName}: downloading from ${url}`);
    try {
      const result = await withTimeout(
        FileSystem.downloadAsync(url, path),
        spec.downloadTimeoutMs,
        `${spec.displayName} download`,
      );

      if (result.status !== 200) {
        console.warn(`[ArabicFont] ${spec.displayName}: HTTP ${result.status} from ${url}`);
        await FileSystem.deleteAsync(path, { idempotent: true });
        continue;
      }

      if (!(await isValidFont(path))) {
        const info = await FileSystem.getInfoAsync(path).catch(() => null);
        console.warn(
          `[ArabicFont] ${spec.displayName}: file too small (${info?.size ?? 0} bytes) — likely an error page`,
        );
        await FileSystem.deleteAsync(path, { idempotent: true });
        continue;
      }

      const info = await FileSystem.getInfoAsync(path);
      console.log(`[ArabicFont] ${spec.displayName}: saved to disk (${info.size} bytes) ✓`);
      return true;
    } catch (e) {
      console.warn(`[ArabicFont] ${spec.displayName}: error on ${url} —`, (e as Error).message);
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    }
  }

  console.warn(`[ArabicFont] ${spec.displayName}: all candidate URLs failed`);
  return false;
}

// ── Core routine ──────────────────────────────────────────────────────────────

async function _run(): Promise<void> {
  try {
    await ensureDir();

    // ── Step 1: Restore from last session (no network, instant) ─────────────
    const raw = await AsyncStorage.getItem(META_KEY);
    if (raw) {
      try {
        const meta = JSON.parse(raw) as CachedMeta;
        const spec = FONT_SPECS.find(s => s.family === meta.family);
        if (spec) {
          console.log(`[ArabicFont] Cache hit: restoring ${spec.displayName}`);
          const ok = await registerFont(spec);
          if (ok) {
            _setState({ status: 'ready', family: spec.family });
            // Cached font is ready. Fall through to step 2 only if a higher
            // priority font might now be available (i.e. cached font is not #1).
          } else {
            console.warn(`[ArabicFont] Cached file invalid — clearing cache and re-downloading`);
            await AsyncStorage.removeItem(META_KEY);
          }
        }
      } catch {
        await AsyncStorage.removeItem(META_KEY);
      }
    }

    // ── Step 2: Try to get the highest-priority font not yet loaded ──────────
    const activePriority = _state.family
      ? FONT_SPECS.findIndex(s => s.family === _state.family)
      : Infinity;

    // Only attempt step 2 if there is a higher-priority font to try.
    // If the cached font is already the top priority, skip entirely.
    if (activePriority > 0) {
      for (let i = 0; i < FONT_SPECS.length; i++) {
        // Already have this priority or better — nothing to improve.
        if (i >= activePriority) {
          console.log(`[ArabicFont] Already using best available priority: ${FONT_SPECS[activePriority]?.displayName}`);
          break;
        }

        const spec = FONT_SPECS[i];
        console.log(`[ArabicFont] Priority ${i + 1}/${FONT_SPECS.length}: trying ${spec.displayName}`);
        // Only mark as downloading if we don't already have a working font.
        // This avoids overwriting 'ready' with 'downloading' for a lower-priority attempt.
        if (_state.status !== 'ready') _setState({ status: 'downloading' });

        // If already on disk (e.g. downloaded in a previous session but not
        // the cached-active font), skip download and just register.
        const alreadyCached = await isValidFont(FONTS_DIR + spec.filename);
        const ok = alreadyCached
          ? await registerFont(spec)
          : (await downloadFont(spec)) && (await registerFont(spec));

        if (ok) {
          _setState({ status: 'ready', family: spec.family });
          await AsyncStorage.setItem(META_KEY, JSON.stringify({
            family:       spec.family,
            filename:     spec.filename,
            downloadedAt: Date.now(),
          } satisfies CachedMeta));
          console.log(`[ArabicFont] Active font: ${spec.displayName} ✓`);
          break;
        }

        console.warn(`[ArabicFont] ${spec.displayName} failed — moving to next priority`);
      }

      // If step 2 attempts failed but step 1 had already set a ready font,
      // restore the ready status (downloading state must not linger).
      if (_state.family && _state.status !== 'ready') {
        _setState({ status: 'ready' });
      }
    }

    // ── Step 3: Silently cache remaining backups (fire-and-forget) ───────────
    // These are used if the active font's file disappears on the next launch.
    // Skip fonts whose download is known to fail this session (not on disk and
    // priority < activePriority means we just tried and failed above).
    for (const spec of FONT_SPECS) {
      if (spec.family === _state.family) continue;
      if (await isValidFont(FONTS_DIR + spec.filename)) continue;
      // Don't retry fonts that are higher priority than the active one — they
      // were just attempted in step 2 and failed. No point retrying immediately.
      const specPriority = FONT_SPECS.findIndex(s => s.family === spec.family);
      if (specPriority < activePriority) continue;
      console.log(`[ArabicFont] Background-caching backup: ${spec.displayName}`);
      downloadFont(spec).catch(() => {});
    }

    if (_state.status !== 'ready') {
      console.log('[ArabicFont] No font available — system Arabic font will be used');
      _setState({ status: 'failed', family: null });
    }
  } catch (e) {
    console.warn('[ArabicFont] Unexpected error in font loader:', (e as Error)?.message);
    _setState({ status: 'failed', family: null });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the background font loading process.
 *
 * Returns the shared Promise — every caller (any number of ArabicText
 * instances) receives the same promise. Only the first call triggers _run().
 * Safe to call multiple times from multiple components simultaneously.
 */
export function init(): Promise<void> {
  if (!_initPromise) _initPromise = _run();
  return _initPromise;
}

export function getState(): ArabicFontState {
  return _state;
}

/**
 * Subscribe to state changes.
 * Returns an unsubscribe function — call it in useEffect cleanup.
 */
export function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
