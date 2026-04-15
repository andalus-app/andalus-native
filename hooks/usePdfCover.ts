import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const COVER_CACHE_VERSION = 1;
const MEM_CACHE: Record<string, string> = {};

function cacheKey(bookId: string, pdfUrl: string) {
  return `pdfcover_v${COVER_CACHE_VERSION}_${bookId}_${pdfUrl.split('/').pop()}`;
}

type QueueItem = {
  key: string;
  pdfUrl: string;
  resolve: (dataUrl: string | null) => void;
};

let queue: QueueItem[] = [];
let processing = false;
let webViewReady = false;
let webViewRef: { current: any } | null = null;
let pendingResolve: ((dataUrl: string | null) => void) | null = null;

export function registerCoverWebView(ref: { current: any }) {
  webViewRef = ref;
}

// Called from WebView onMessage handler
export function onCoverMessage(raw: string) {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'ready') {
      webViewReady = true;
      processNext();
      return;
    }
    if (msg.type === 'cover' || msg.type === 'error') {
      const result = msg.type === 'cover' ? (msg.dataUrl as string) : null;
      if (pendingResolve) {
        pendingResolve(result);
        pendingResolve = null;
      }
      processing = false;
      processNext();
    }
  } catch {}
}

function processNext() {
  if (!webViewReady || processing || queue.length === 0 || !webViewRef?.current) return;
  const item = queue.shift()!;
  processing = true;
  pendingResolve = (dataUrl) => { item.resolve(dataUrl); };
  // Must end with `; true;` — WebView requires truthy return from injectJavaScript
  const js = `window._renderCover("${item.pdfUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"); true;`;
  webViewRef.current.injectJavaScript(js);
}

function enqueue(key: string, pdfUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    queue.push({ key, pdfUrl, resolve });
    processNext();
  });
}

// Batch-preloads all cover keys from AsyncStorage into MEM_CACHE in one call.
// Call this once when the e-books screen mounts so all cached covers are
// instantly available (no per-item async read) before the list renders.
export async function preloadCoverCache(books: Array<{ id: string; pdfPath: string }>) {
  const keys = books.map(b => cacheKey(b.id, b.pdfPath));
  const uncached = keys.filter(k => !MEM_CACHE[k]);
  if (!uncached.length) return;
  try {
    const pairs = await AsyncStorage.multiGet(uncached);
    for (const [key, value] of pairs) {
      if (value) MEM_CACHE[key] = value;
    }
  } catch {}
}

export type CoverStatus = 'loading' | 'done' | 'error';

export function usePdfCover(bookId: string, pdfUrl: string): { status: CoverStatus; dataUrl: string | null } {
  const key = cacheKey(bookId, pdfUrl);
  const [status,  setStatus]  = useState<CoverStatus>(() => MEM_CACHE[key] ? 'done' : 'loading');
  const [dataUrl, setDataUrl] = useState<string | null>(() => MEM_CACHE[key] || null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (MEM_CACHE[key]) return;
    let cancelled = false;

    async function load() {
      try {
        const stored = await AsyncStorage.getItem(key);
        if (stored) {
          MEM_CACHE[key] = stored;
          if (!cancelled && mounted.current) { setDataUrl(stored); setStatus('done'); }
          return;
        }
      } catch {}

      const result = await enqueue(key, pdfUrl);
      if (cancelled || !mounted.current) return;
      if (result) {
        MEM_CACHE[key] = result;
        AsyncStorage.setItem(key, result).catch(() => {});
        setDataUrl(result);
        setStatus('done');
      } else {
        setStatus('error');
      }
    }

    load();
    return () => { cancelled = true; };
  }, [key, pdfUrl]);

  return { status, dataUrl };
}
