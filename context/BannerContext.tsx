import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTGcOPYCS6v4m4cGWDhbJs_PZRWysSbseKBq7mF6bqbnlmEpEMB7yQDrV9hm2rTXDZnkUDeDinIT04A/pub?gid=0&single=true&output=csv';
const BANNERS_DISMISSED_KEY = 'banners_dismissed_v3';
const BANNERS_READ_KEY      = 'banners_read_v1';
// v2: Banner now includes endDate for expiry-aware CDN-miss protection.
const BANNERS_CACHE_KEY     = 'banners_cache_v2';

// Minimum ms between network fetches. Prevents rapid tab-switching from firing
// a storm of requests that hit different (potentially stale) CDN edge servers.
const MIN_FETCH_INTERVAL_MS = 30_000;

// endDate is stored so we can distinguish genuine expiry from a bad network
// response (Google Sheets CDN inconsistency).
export type Banner = {
  id: string;
  title: string;
  linkText?: string;
  linkUrl?: string;
  endDate: string; // ISO "YYYY-MM-DD"
};

function parseCSVRow(row: string): string[] {
  const result: string[] = []; let cur = '', inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') { if (inQuote && row[i+1] === '"') { cur += '"'; i++; } else inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim()); return result;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseCSV(csv: string): Banner[] {
  const today = todayISO();
  return csv.trim().split('\n').slice(1).flatMap((row, i) => {
    if (!row.trim()) return [];
    const [message, start, end, activeFlag, linkText, linkUrl] = parseCSVRow(row);
    if (!message || activeFlag?.toUpperCase() !== 'TRUE') return [];
    if (today < start || today > end) return [];
    const isValidUrl = (s: string) => !!(s && (s.startsWith('http://') || s.startsWith('https://')));
    return [{
      id: `${i}-${message.slice(0, 12)}`,
      title: message,
      endDate: end,
      linkText: linkText || undefined,
      linkUrl: isValidUrl(linkUrl) ? linkUrl : undefined,
    }];
  });
}

type BannerContextType = {
  banners: Banner[];
  hasUnread: boolean;
  dismissBanner: (id: string) => Promise<void>;
  markAllRead: (ids: string[]) => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
};

const BannerContext = createContext<BannerContextType | null>(null);

export function BannerProvider({ children }: { children: React.ReactNode }) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  // Load cache instantly on mount, then refresh from network in background.
  useEffect(() => {
    (async () => {
      try {
        const [rawCache, rawDismissed, rawRead] = await Promise.all([
          AsyncStorage.getItem(BANNERS_CACHE_KEY),
          AsyncStorage.getItem(BANNERS_DISMISSED_KEY),
          AsyncStorage.getItem(BANNERS_READ_KEY),
        ]);
        const cached: Banner[] = rawCache ? JSON.parse(rawCache) : [];
        const dismissedSet = new Set<string>(rawDismissed ? JSON.parse(rawDismissed) : []);
        const readSet      = new Set<string>(rawRead      ? JSON.parse(rawRead)      : []);
        const today = todayISO();
        setReadIds(readSet);
        // Filter by both dismissal and expiry when restoring from cache.
        setBanners(cached.filter(b => !dismissedSet.has(b.id) && b.endDate >= today));
      } catch {}
    })();
  }, []);

  const abortRef       = useRef<AbortController | null>(null);
  // Timestamp of the last SUCCESSFUL network fetch (response was valid CSV, not HTML).
  // Used to rate-limit refresh() so rapid tab-switches don't fire a storm of requests.
  const lastFetchTsRef = useRef<number>(0);

  const refresh = useCallback(async (force = false) => {
    const now = Date.now();

    // Rate limit: if a successful fetch happened less than MIN_FETCH_INTERVAL_MS ago
    // AND this is not a forced refresh (pull-to-refresh), skip the network call.
    // This prevents rapid tab-switching from hitting different CDN edge servers that
    // may serve stale (empty) versions of the sheet.
    if (!force && now - lastFetchTsRef.current < MIN_FETCH_INTERVAL_MS) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      const res = await fetch(`${SHEET_URL}&t=${now}`, { cache: 'no-store', signal });
      if (!res.ok) return;
      const text = await res.text();
      if (signal.aborted) return;

      // Guard 1: Google Sheets sometimes returns an HTML redirect/error page.
      // Discard — do not touch state.
      if (text.trimStart()[0] === '<') return;

      // Record a successful (non-HTML) fetch so rate limiting works correctly.
      lastFetchTsRef.current = Date.now();

      const all = parseCSV(text);

      const [rawDismissed, rawRead] = await Promise.all([
        AsyncStorage.getItem(BANNERS_DISMISSED_KEY),
        AsyncStorage.getItem(BANNERS_READ_KEY),
      ]);
      if (signal.aborted) return;

      const dismissedSet = new Set<string>(rawDismissed ? JSON.parse(rawDismissed) : []);
      const readSet      = new Set<string>(rawRead      ? JSON.parse(rawRead)      : []);
      const visible      = all.filter(b => !dismissedSet.has(b.id));

      setReadIds(readSet);

      // Guard 2: Google Sheets CDN can return an older (empty) version of the sheet
      // when different edge servers are out of sync. If the network result is empty
      // but we have banners that haven't expired, keep them rather than wiping the UI.
      //
      // Banners are only cleared when:
      //   a) network returns non-empty data (authoritative), OR
      //   b) network returns empty AND all current banners are genuinely expired, OR
      //   c) user explicitly dismisses via dismissBanner().
      setBanners(prev => {
        if (visible.length > 0) return visible;
        const today = todayISO();
        const stillValid = prev.filter(b => !dismissedSet.has(b.id) && b.endDate >= today);
        return stillValid.length > 0 ? stillValid : visible;
      });

      // Only persist to cache when we have an authoritative non-empty result.
      if (visible.length > 0) {
        await AsyncStorage.setItem(BANNERS_CACHE_KEY, JSON.stringify(visible));
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }, []);

  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    // Initial fetch — no rate limit on first load.
    refresh(true);

    // Re-fetch when app comes back to foreground.
    const sub = AppState.addEventListener('change', next => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        refresh();
      }
      appStateRef.current = next;
    });

    // Poll every 60 seconds while app is open.
    const poll = setInterval(refresh, 60 * 1000);

    return () => { sub.remove(); clearInterval(poll); };
  }, []);

  const dismissBanner = useCallback(async (id: string) => {
    setBanners(prev => prev.filter(b => b.id !== id));
    setReadIds(prev => { const s = new Set(prev); s.add(id); return s; });
    try {
      const raw = await AsyncStorage.getItem(BANNERS_DISMISSED_KEY);
      const dismissed: string[] = raw ? JSON.parse(raw) : [];
      dismissed.push(id);
      await AsyncStorage.setItem(BANNERS_DISMISSED_KEY, JSON.stringify(dismissed));
    } catch {}
  }, []);

  const markAllRead = useCallback(async (ids?: string[]) => {
    setReadIds(prev => {
      const s = new Set(prev);
      (ids ?? []).forEach(id => s.add(id));
      return s;
    });
    try {
      const raw = await AsyncStorage.getItem(BANNERS_READ_KEY);
      const read: string[] = raw ? JSON.parse(raw) : [];
      const merged = [...new Set([...read, ...(ids ?? [])])];
      await AsyncStorage.setItem(BANNERS_READ_KEY, JSON.stringify(merged));
    } catch {}
  }, []);

  const value = useMemo(() => ({
    banners,
    hasUnread: banners.some(b => !readIds.has(b.id)),
    dismissBanner,
    markAllRead,
    refresh,
  }), [banners, readIds, dismissBanner, markAllRead, refresh]);

  return <BannerContext.Provider value={value}>{children}</BannerContext.Provider>;
}

export function useBanners() {
  const ctx = useContext(BannerContext);
  if (!ctx) throw new Error('useBanners must be used within BannerProvider');
  return ctx;
}
