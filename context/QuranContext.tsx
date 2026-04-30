import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';

import { surahForPage, SURAH_INDEX, type SurahInfo } from '../data/surahIndex';
import { useQuranSettings, QuranSettings, ReadingMode } from '../hooks/quran/useQuranSettings';
import { saveLastPage, getCachedLastPage, whenLastPageReady } from '../services/quranLastPage';
import { useQuranBookmarks, Bookmark } from '../hooks/quran/useQuranBookmarks';

// ── Types ─────────────────────────────────────────────────────────────────────

export type { ReadingMode };

export type AudioCommands = {
  loadAndPlay: (surahId: number) => void;
  // continuous=true enables auto-advance to subsequent surahs (Spela vidare mode).
  loadAndPlayFromVerse: (surahId: number, startVerseKey: string, stopAtVerseKey: string | null, continuous?: boolean) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

// Verse selected by long-press — drives menu display and selection highlight.
export type LongPressedVerse = {
  verseKey: string;
  pageLastVerseKey: string; // last verse on the page where the long-press occurred
};

type QuranContextValue = {
  // Navigation
  currentPage: number;
  currentSurahId: number;
  goToPage: (page: number) => void;
  goToSurah: (surahId: number) => void;
  goToVerse: (verseKey: string, pageNumber: number) => void;

  // Chrome visibility (header + player + page picker)
  chromeVisible: boolean;
  toggleChrome: () => void;
  showChrome: () => void;

  // Contents menu (full-screen, replaces sidebar drawer)
  contentsMenuOpen: boolean;
  openContentsMenu: () => void;
  closeContentsMenu: () => void;

  // Settings panel
  settingsPanelOpen: boolean;
  toggleSettingsPanel: () => void;
  closeSettingsPanel: () => void;

  // Search modal
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;

  // Reciter selector modal
  reciterSelectorOpen: boolean;
  openReciterSelector: () => void;
  closeReciterSelector: () => void;

  // Settings
  settings: QuranSettings;
  updateSettings: (partial: Partial<QuranSettings>) => void;
  toggleReadingMode: () => void;

  // Bookmarks
  bookmarks: Bookmark[];
  addBookmark: (bm: Omit<Bookmark, 'id' | 'createdAt'>) => void;
  removeBookmark: (id: string) => void;
  updateNote: (id: string, note: string) => void;
  isBookmarked: (pageNumber: number, verseKey?: string) => boolean;
  // Navigate to a bookmark: goes to the page
  goToBookmark: (pageNumber: number, verseKey?: string) => void;

  // Audio bridge — QuranAudioPlayer registers these on mount
  audioCommandsRef: React.MutableRefObject<AudioCommands | null>;
  // Settings panel registers its cache-refresh function here so the audio
  // player can notify it after a background download completes.
  audioCacheRefreshRef: React.MutableRefObject<(() => void) | null>;

  // Playback sync — active verse key being recited right now (null when stopped)
  activeVerseKey: string | null;
  // Called by QuranAudioPlayer on every status tick with the current verse + its page.
  // Triggers highlight update and auto page advance when the page changes.
  setPlaybackVerse: (verseKey: string | null, pageNumber: number | null) => void;

  // Long-press verse selection — set by page/verse views, cleared by VerseActionsMenu
  longPressedVerse: LongPressedVerse | null;
  setLongPressedVerse: (v: LongPressedVerse | null) => void;

  // Surah navigation scroll target — set by goToSurah, consumed + cleared by QuranVerseView.
  // pageNumber is included so only the matching QuranVerseView instance acts on it;
  // other pre-rendered pages (isActive=false siblings) ignore it without clearing it.
  pendingSurahScroll: { surahId: number; pageNumber: number } | null;
  clearPendingSurahScroll: () => void;

  // Initial verse highlight — set when opened via a deep-link (e.g. from Asmaul Husna).
  // QuranVerseView scrolls to the verse, then clears this.
  pendingVerseHighlight: { verseKey: string; pageNumber: number } | null;
  clearPendingVerseHighlight: () => void;

  // Khatmah day range — set when the user navigates to a specific Khatmah day.
  // Drives start/end verse markers rendered on the Mushaf page view.
  khatmahRange: { startVerseKey: string; endVerseKey: string; dayNumber: number } | null;
  setKhatmahRange: (range: { startVerseKey: string; endVerseKey: string; dayNumber: number } | null) => void;

  // Clear the explicit surah override (call when user manually scrolls to a new page)
  clearExplicitSurah: () => void;
};

// ── Context ───────────────────────────────────────────────────────────────────

const QuranContext = createContext<QuranContextValue | null>(null);

export function useQuranContext(): QuranContextValue {
  const ctx = useContext(QuranContext);
  if (!ctx) throw new Error('useQuranContext must be used inside QuranProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode;
};

// Hoisted to app root (see app/_layout.tsx) so its state — including the audio
// player commands ref, current page, and reading mode — survives navigation
// away from /quran. This is what enables Quran audio to keep playing in the
// background while the user browses other tabs / the home screen, and to be
// stopped only when the user comes back to the Quran reader.
//
// Deep-link entries (Asmaul Husna verse tap, in-Quran search, push notifications)
// no longer pass props here. They use goToPage / goToVerse imperatively from
// app/quran.tsx's effect once the route mounts.
export function QuranProvider({ children }: Props) {
  // Lazy-init from the synchronous last-page cache (warmed at app import).
  // Falls back to page 1 if the cache hasn't resolved yet.
  const [currentPage, setCurrentPage] = useState<number>(() => getCachedLastPage());
  const [chromeVisible, setChromeVisible] = useState(true);
  const [activeVerseKey, setActiveVerseKey] = useState<string | null>(null);
  const [longPressedVerse, setLongPressedVerseState] = useState<LongPressedVerse | null>(null);
  const [pendingSurahScroll, setPendingSurahScroll] = useState<{ surahId: number; pageNumber: number } | null>(null);
  const [pendingVerseHighlight, setPendingVerseHighlight] = useState<{ verseKey: string; pageNumber: number } | null>(null);

  // Explicit surah override — set when user navigates via goToSurah (sidebar, search).
  // Uses a REF (not state) to avoid race conditions with React's batched render cycle.
  // Solves the multi-surah-per-page ambiguity (e.g. page 604 has surahs 112-114).
  // Cleared only on manual user scroll via clearExplicitSurah().
  const explicitSurahIdRef = useRef<number | null>(null);
  // Counter bumped every time explicitSurahIdRef changes, so useMemo re-fires.
  const [explicitSurahVersion, setExplicitSurahVersion] = useState(0);

  // Always-current ref so setPlaybackVerse can compare without becoming unstable.
  // Pattern from CLAUDE.md: refs for values needed inside stable callbacks.
  const currentPageRef = useRef(currentPage);
  const [contentsMenuOpen, setContentsMenuOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [reciterSelectorOpen, setReciterSelectorOpen] = useState(false);

  // Keep currentPageRef in sync every render
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  // Once-only sync: the lazy-init useState read getCachedLastPage() may have
  // returned the default of 1 because the AsyncStorage load hadn't resolved
  // yet. Now that QuranProvider mounts at app root (before the user navigates),
  // wait for the async load and update state if the user hasn't navigated and
  // the cached value differs. Without this, the saveLastPage debounce below
  // would persist "1" over the real last page.
  const [initialSyncDone, setInitialSyncDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    whenLastPageReady().then((cached) => {
      if (cancelled) return;
      setCurrentPage((prev) => (prev === 1 && cached !== 1 ? cached : prev));
      setInitialSyncDone(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Persist last visited page so the next launch reopens here.
  // saveLastPage updates the in-memory cache immediately (no flash on next open)
  // and writes to AsyncStorage. Debounced 400ms so rapid swipes only write once.
  // Skipped until the initial sync has run, otherwise we'd overwrite the stored
  // value with the lazy-init default of 1 before the cache resolves.
  useEffect(() => {
    if (!initialSyncDone) return;
    const timer = setTimeout(() => saveLastPage(currentPage), 400);
    return () => clearTimeout(timer);
  }, [currentPage, initialSyncDone]);

  // Helper to clear the explicit surah override (called on manual scroll)
  const clearExplicitSurah = useCallback(() => {
    if (explicitSurahIdRef.current !== null) {
      explicitSurahIdRef.current = null;
      setExplicitSurahVersion((v) => v + 1);
    }
  }, []);

  const { settings, updateSettings, setReadingModeSession } = useQuranSettings();
  const { bookmarks, addBookmark, removeBookmark, updateNote, isBookmarked } =
    useQuranBookmarks();

  // Audio bridge: QuranAudioPlayer writes here on mount; other components call through it
  const audioCommandsRef = useRef<AudioCommands | null>(null);
  // Cache refresh bridge: QuranSettingsPanel registers its refresh function here
  const audioCacheRefreshRef = useRef<(() => void) | null>(null);

  const currentSurahId = useMemo(() => {
    // explicitSurahVersion is only here to trigger re-computation when the ref changes
    void explicitSurahVersion;
    const explicit = explicitSurahIdRef.current;
    if (explicit !== null) {
      // Validate: is the current page within range for this surah?
      const idx = SURAH_INDEX.findIndex((s: SurahInfo) => s.id === explicit);
      if (idx >= 0) {
        const surah = SURAH_INDEX[idx];
        const nextSurah = SURAH_INDEX[idx + 1];
        // When multiple surahs share the same firstPage (e.g. 112/113/114 all on page 604),
        // nextSurah.firstPage - 1 would be LESS than surah.firstPage, making the range
        // invalid and always failing. Math.max ensures lastPage >= firstPage in all cases.
        const lastPage = nextSurah
          ? Math.max(surah.firstPage, nextSurah.firstPage - 1)
          : 604;
        if (currentPage >= surah.firstPage && currentPage <= lastPage) {
          return explicit;
        }
      }
      // Page is outside surah range — clear the override
      explicitSurahIdRef.current = null;
    }
    return surahForPage(currentPage).id;
  }, [currentPage, explicitSurahVersion]);

  const goToPage = useCallback((page: number) => {
    const clamped = Math.min(604, Math.max(1, page));
    setCurrentPage(clamped);
    setContentsMenuOpen(false);
  }, []);

  // Stable callback — audio player calls this ~every 250ms during playback.
  // Uses currentPageRef (not currentPage state) to avoid stale closures in the
  // long-lived status update callback registered by QuranAudioPlayer.
  const setPlaybackVerse = useCallback(
    (verseKey: string | null, pageNumber: number | null) => {
      setActiveVerseKey(verseKey);
      if (
        pageNumber !== null &&
        pageNumber > 0 &&
        pageNumber !== currentPageRef.current
      ) {
        goToPage(pageNumber);
      }
    },
    [goToPage],
  );

  const clearPendingSurahScroll = useCallback(() => setPendingSurahScroll(null), []);
  const clearPendingVerseHighlight = useCallback(() => setPendingVerseHighlight(null), []);

  const goToSurah = useCallback(
    (surahId: number) => {
      const surah = SURAH_INDEX.find((s: SurahInfo) => s.id === surahId);
      if (surah) {
        explicitSurahIdRef.current = surahId;
        setExplicitSurahVersion((v) => v + 1);
        setPendingSurahScroll({ surahId, pageNumber: surah.firstPage });
        goToPage(surah.firstPage);
      }
    },
    [goToPage],
  );

  // Navigate to a specific verse: switch to verse-by-verse mode, go to its page,
  // and scroll to the verse (pendingVerseHighlight consumed by QuranVerseView).
  //
  // Session-only mode switch: setReadingModeSession does NOT persist to AsyncStorage.
  // Reason: this is invoked by deep-link entries (Asmaul Husna verse tap, in-Quran
  // search results) where verse mode is the right view for THIS action only — it
  // must not become the persisted default for the next time the user opens the
  // Quran tab manually. Persisting it caused page 604 (three short surahs sharing
  // one Mushaf page) to render three full SurahHeaderCards in verse mode on the
  // next manual entry, blocking the JS thread for ~10s.
  const goToVerse = useCallback(
    (verseKey: string, pageNumber: number) => {
      setReadingModeSession('verse');
      goToPage(pageNumber);
      setPendingVerseHighlight({ verseKey, pageNumber });
    },
    [goToPage, setReadingModeSession],
  );

  // Chrome
  const toggleChrome = useCallback(() => setChromeVisible((v) => !v), []);
  const showChrome = useCallback(() => setChromeVisible(true), []);

  // Contents menu
  const openContentsMenu = useCallback(() => {
    setChromeVisible(true);
    setContentsMenuOpen(true);
  }, []);
  const closeContentsMenu = useCallback(() => setContentsMenuOpen(false), []);

  // Settings panel
  const toggleSettingsPanel = useCallback(
    () => setSettingsPanelOpen((v) => !v),
    [],
  );
  const closeSettingsPanel = useCallback(() => setSettingsPanelOpen(false), []);

  // Search
  const openSearch = useCallback(() => {
    setChromeVisible(true);
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Reciter selector
  const openReciterSelector = useCallback(() => setReciterSelectorOpen(true), []);
  const closeReciterSelector = useCallback(() => setReciterSelectorOpen(false), []);

  // Khatmah day range markers
  const [khatmahRange, setKhatmahRange] = useState<{
    startVerseKey: string;
    endVerseKey:   string;
    dayNumber:     number;
  } | null>(null);

  // Long-press verse selection
  const setLongPressedVerse = useCallback((v: LongPressedVerse | null) => {
    setLongPressedVerseState(v);
  }, []);

  // Navigate to a bookmarked page — all bookmarked verses on the page are always highlighted
  const goToBookmark = useCallback(
    (pageNumber: number, verseKey?: string) => {
      goToPage(pageNumber);
      setContentsMenuOpen(false);
    },
    [goToPage],
  );

  // Reading mode toggle
  const toggleReadingMode = useCallback(() => {
    updateSettings({
      readingMode: settings.readingMode === 'page' ? 'verse' : 'page',
    });
  }, [settings.readingMode, updateSettings]);

  const value = useMemo<QuranContextValue>(
    () => ({
      currentPage,
      currentSurahId,
      goToPage,
      goToSurah,
      goToVerse,
      chromeVisible,
      toggleChrome,
      showChrome,
      contentsMenuOpen,
      openContentsMenu,
      closeContentsMenu,
      settingsPanelOpen,
      toggleSettingsPanel,
      closeSettingsPanel,
      searchOpen,
      openSearch,
      closeSearch,
      reciterSelectorOpen,
      openReciterSelector,
      closeReciterSelector,
      settings,
      updateSettings,
      toggleReadingMode,
      bookmarks,
      addBookmark,
      removeBookmark,
      updateNote,
      isBookmarked,
      goToBookmark,
      audioCommandsRef,
      audioCacheRefreshRef,
      activeVerseKey,
      setPlaybackVerse,
      longPressedVerse,
      setLongPressedVerse,
      pendingSurahScroll,
      clearPendingSurahScroll,
      pendingVerseHighlight,
      clearPendingVerseHighlight,
      khatmahRange,
      setKhatmahRange,
      clearExplicitSurah,
    }),
    [
      currentPage,
      currentSurahId,
      goToPage,
      goToSurah,
      goToVerse,
      chromeVisible,
      toggleChrome,
      showChrome,
      contentsMenuOpen,
      openContentsMenu,
      closeContentsMenu,
      settingsPanelOpen,
      toggleSettingsPanel,
      closeSettingsPanel,
      searchOpen,
      openSearch,
      closeSearch,
      reciterSelectorOpen,
      openReciterSelector,
      closeReciterSelector,
      settings,
      updateSettings,
      toggleReadingMode,
      bookmarks,
      addBookmark,
      removeBookmark,
      updateNote,
      isBookmarked,
      goToBookmark,
      activeVerseKey,
      setPlaybackVerse,
      longPressedVerse,
      setLongPressedVerse,
      pendingSurahScroll,
      clearPendingSurahScroll,
      pendingVerseHighlight,
      clearPendingVerseHighlight,
      khatmahRange,
      setKhatmahRange,
      clearExplicitSurah,
    ],
  );

  return <QuranContext.Provider value={value}>{children}</QuranContext.Provider>;
}
