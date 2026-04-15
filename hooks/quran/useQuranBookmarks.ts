import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Bookmark = {
  id: string;
  pageNumber: number;
  surahId: number;
  verseKey?: string;
  note?: string;
  createdAt: number;
};

// Do not change this key — it may be in use on devices.
const STORAGE_KEY = 'andalus_quran_bookmarks';

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useQuranBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!mountedRef.current || !raw) return;
        try {
          setBookmarks(JSON.parse(raw) as Bookmark[]);
        } catch {
          // Corrupt storage — start empty
        }
      })
      .catch(() => undefined);

    return () => { mountedRef.current = false; };
  }, []);

  const persist = useCallback((next: Bookmark[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const addBookmark = useCallback(
    (bm: Omit<Bookmark, 'id' | 'createdAt'>) => {
      setBookmarks((prev) => {
        // Don't add duplicate page bookmarks
        if (prev.some((b) => b.pageNumber === bm.pageNumber && b.verseKey === bm.verseKey)) {
          return prev;
        }
        const next: Bookmark[] = [
          { ...bm, id: `bm_${Date.now()}_${Math.random().toString(36).slice(2)}`, createdAt: Date.now() },
          ...prev,
        ];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeBookmark = useCallback(
    (id: string) => {
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.id !== id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateNote = useCallback(
    (id: string, note: string) => {
      setBookmarks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, note } : b));
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const isBookmarked = useCallback(
    (pageNumber: number, verseKey?: string) =>
      bookmarks.some((b) => b.pageNumber === pageNumber && b.verseKey === verseKey),
    [bookmarks],
  );

  return { bookmarks, addBookmark, removeBookmark, updateNote, isBookmarked };
}
