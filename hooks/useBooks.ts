import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BOOKS_DATA, BASE_URL, BookData } from '../data/books';

const BOOKS_KEY = 'andalus_books_state';

type BookState = {
  isFavorite: boolean;
  bookmarks: number[];
  lastReadPage: number;
  pageCount: number | null;
  lastOpenedAt: number;
};

type BooksState = Record<string, BookState>;

export type Book = BookData & BookState & {
  pdfPath: string;
  progressPercent: number;
};

function defaultState(): BookState {
  return { isFavorite: false, bookmarks: [], lastReadPage: 1, pageCount: null, lastOpenedAt: 0 };
}

function mergeBooks(data: BookData[], state: BooksState): Book[] {
  return data.map(b => {
    const s = state[b.id] ?? defaultState();
    const progress =
      s.pageCount && s.lastReadPage > 1
        ? Math.min(Math.round(((s.lastReadPage - 1) / s.pageCount) * 100), 100)
        : 0;
    return {
      ...b,
      ...s,
      pdfPath: BASE_URL + encodeURIComponent(b.file),
      progressPercent: progress,
    };
  });
}

// Module-level cache — survives tab switches (component unmount/remount)
let _cachedState: BooksState | null = null;

export function useBooks() {
  const [state, setState] = useState<BooksState>(_cachedState ?? {});

  useEffect(() => {
    if (_cachedState !== null) return; // already loaded — skip AsyncStorage read
    AsyncStorage.getItem(BOOKS_KEY).then(raw => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          _cachedState = parsed;
          setState(parsed);
        } catch {}
      } else {
        _cachedState = {};
      }
    });
  }, []);

  const persist = useCallback((next: BooksState) => {
    _cachedState = next;
    AsyncStorage.setItem(BOOKS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setState(prev => {
      const s = prev[id] ?? defaultState();
      const next = { ...prev, [id]: { ...s, isFavorite: !s.isFavorite } };
      persist(next);
      return next;
    });
  }, [persist]);

  const setLastReadPage = useCallback((id: string, page: number, total: number) => {
    setState(prev => {
      const s = prev[id] ?? defaultState();
      const next = { ...prev, [id]: { ...s, lastReadPage: page, pageCount: total } };
      persist(next);
      return next;
    });
  }, [persist]);

  const addBookmark = useCallback((id: string, page: number) => {
    setState(prev => {
      const s = prev[id] ?? defaultState();
      if (s.bookmarks.includes(page)) return prev;
      const next = { ...prev, [id]: { ...s, bookmarks: [...s.bookmarks, page].sort((a, b) => a - b) } };
      persist(next);
      return next;
    });
  }, [persist]);

  const removeBookmark = useCallback((id: string, page: number) => {
    setState(prev => {
      const s = prev[id] ?? defaultState();
      const next = { ...prev, [id]: { ...s, bookmarks: s.bookmarks.filter(p => p !== page) } };
      persist(next);
      return next;
    });
  }, [persist]);

  const markOpened = useCallback((id: string) => {
    setState(prev => {
      const s = prev[id] ?? defaultState();
      const next = { ...prev, [id]: { ...s, lastOpenedAt: Date.now() } };
      persist(next);
      return next;
    });
  }, [persist]);

  const books = useMemo(() => mergeBooks(BOOKS_DATA, state), [state]);

  return {
    books,
    toggleFavorite,
    setLastReadPage,
    addBookmark,
    removeBookmark,
    markOpened,
  };
}
