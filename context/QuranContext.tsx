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
import { saveLastPage } from '../services/quranLastPage';
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
  // Navigate to a bookmark: goes to the page and flashes the verse for 2.5 s
  goToBookmark: (pageNumber: number, verseKey?: string) => void;
  // Currently flashing bookmark verse key (auto-clears after 2.5 s)
  bookmarkFlashKey: string | null;

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
  // QuranVerseView scrolls to the verse and flashes it, then clears this.
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
  initialPage?: number;
  initialVerseKey?: string;
  initialReadingMode?: ReadingMode;
};

export function QuranProvider({ children, initialPage = 1, initialVerseKey, initialReadingMode }: Props) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [activeVerseKey, setActiveVerseKey] = useState<string | null>(initialVerseKey ?? null);
  const [longPressedVerse, setLongPressedVerseState] = useState<LongPressedVerse | null>(null);
  const [pendingSurahScroll, setPendingSurahScroll] = useState<{ surahId: number; pageNumber: number } | null>(null);
  const [pendingVerseHighlight, setPendingVerseHighlight] = useState<{ verseKey: string; pageNumber: number } | null>(
    initialVerseKey ? { verseKey: initialVerseKey, pageNumber: initialPage } : null,
  );

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

  // Persist last visited page so QuranRoute can reopen here next time.
  // saveLastPage updates the in-memory cache immediately (no flash on next open)
  // and writes to AsyncStorage. Debounced 400ms so rapid swipes only write once.
  useEffect(() => {
    const timer = setTimeout(() => saveLastPage(currentPage), 400);
    return () => clearTimeout(timer);
  }, [currentPage]);

  // Helper to clear the explicit surah override (called on manual scroll)
  const clearExplicitSurah = useCallback(() => {
    if (explicitSurahIdRef.current !== null) {
      explicitSurahIdRef.current = null;
      setExplicitSurahVersion((v) => v + 1);
    }
  }, []);

  const { settings, updateSettings } = useQuranSettings(initialReadingMode);
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
  // and scroll/flash the verse (pendingVerseHighlight consumed by QuranVerseView).
  const goToVerse = useCallback(
    (verseKey: string, pageNumber: number) => {
      updateSettings({ readingMode: 'verse' });
      goToPage(pageNumber);
      setPendingVerseHighlight({ verseKey, pageNumber });
    },
    [goToPage, updateSettings],
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

  // Bookmark flash — set when navigating from the bookmarks list, auto-clears after 2.5 s
  const [bookmarkFlashKey, setBookmarkFlashKey] = useState<string | null>(null);
  const bookmarkFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Long-press verse selection
  const setLongPressedVerse = useCallback((v: LongPressedVerse | null) => {
    setLongPressedVerseState(v);
  }, []);

  // Navigate to a bookmarked page and flash the verse for 2.5 s
  const goToBookmark = useCallback(
    (pageNumber: number, verseKey?: string) => {
      goToPage(pageNumber);
      setContentsMenuOpen(false);
      if (bookmarkFlashTimerRef.current) clearTimeout(bookmarkFlashTimerRef.current);
      if (verseKey) {
        setBookmarkFlashKey(verseKey);
        bookmarkFlashTimerRef.current = setTimeout(() => {
          setBookmarkFlashKey(null);
        }, 2500);
      }
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
      bookmarkFlashKey,
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
      bookmarkFlashKey,
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
