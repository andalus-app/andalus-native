import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SavedPage = {
  id: string;
  pageNumber: number;
  surahId: number;
  surahName: string;
  createdAt: number;
};

const STORAGE_KEY = 'andalus_quran_saved_pages';

export function useQuranSavedPages() {
  const [savedPages, setSavedPages] = useState<SavedPage[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!mountedRef.current || !raw) return;
        try { setSavedPages(JSON.parse(raw) as SavedPage[]); } catch { /* corrupt */ }
      })
      .catch(() => undefined);
    return () => { mountedRef.current = false; };
  }, []);

  const persist = useCallback((next: SavedPage[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const savePage = useCallback((page: Omit<SavedPage, 'id' | 'createdAt'>) => {
    setSavedPages((prev) => {
      if (prev.some((p) => p.pageNumber === page.pageNumber)) return prev;
      const next: SavedPage[] = [
        { ...page, id: `sp_${Date.now()}_${Math.random().toString(36).slice(2)}`, createdAt: Date.now() },
        ...prev,
      ];
      persist(next);
      return next;
    });
  }, [persist]);

  const removeSavedPage = useCallback((id: string) => {
    setSavedPages((prev) => {
      const next = prev.filter((p) => p.id !== id);
      persist(next);
      return next;
    });
  }, [persist]);

  const isPageSaved = useCallback(
    (pageNumber: number) => savedPages.some((p) => p.pageNumber === pageNumber),
    [savedPages],
  );

  return { savedPages, savePage, removeSavedPage, isPageSaved };
}
