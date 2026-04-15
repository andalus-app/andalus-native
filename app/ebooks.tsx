import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  View, Text, TouchableOpacity, FlatList, ScrollView, TextInput,
  Modal, ActivityIndicator, StyleSheet, Animated, Image, PanResponder, Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Pdf from '../components/NativePdf';
import Svg, { Polygon, Rect, Defs, Pattern } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import BackButton from '../components/BackButton';
import { useBooks, Book } from '../hooks/useBooks';
import { CATEGORIES } from '../data/books';
import {
  registerCoverWebView,
  onCoverMessage,
  usePdfCover,
  preloadCoverCache,
} from '../hooks/usePdfCover';

// Serialize all orientation changes so lock/unlock always complete in issue order.
let _orientationChain: Promise<void> = Promise.resolve();
function serialOrientation(fn: () => Promise<void>) {
  _orientationChain = _orientationChain.then(fn, fn);
}

/* ─────────────────────────────────────────────────────────────
   GLOBAL PDF COVER RENDERER (single hidden WebView)
   Processes a queue of cover-render requests one at a time.
───────────────────────────────────────────────────────────── */
const PDFJS_HTML = `
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#000">
<canvas id="c"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
// window.onload fires after ALL scripts (including CDN) have executed
window.onload = function() {
  try {
    var lib = window['pdfjs-dist/build/pdf'];
    lib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    window._renderCover = function(url) {
      lib.getDocument({ url: url, withCredentials: false }).promise
        .then(function(pdf) { return pdf.getPage(1); })
        .then(function(page) {
          var vp0 = page.getViewport({ scale: 1 });
          var scale = (200 / vp0.width) * 2;
          var vp    = page.getViewport({ scale: scale });
          var canvas = document.getElementById('c');
          canvas.width  = vp.width;
          canvas.height = vp.height;
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
            .then(function() {
              window.ReactNativeWebView.postMessage(
                JSON.stringify({ type: 'cover', dataUrl: canvas.toDataURL('image/jpeg', 0.82) })
              );
            });
        })
        .catch(function(e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: String(e) }));
        });
    };
    // Signal React Native that the renderer is ready
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: String(e) }));
  }
};
</script>
</body>
</html>
`;

function CoverRendererWebView() {
  const wvRef = useRef<any>(null);
  useEffect(() => { registerCoverWebView(wvRef); }, []);
  return (
    // Zero-size absolute wrapper — keeps WebView fully out of the flex layout
    <View style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} pointerEvents="none">
    <WebView
      ref={wvRef}
      style={{ width: 200, height: 200 }}
      originWhitelist={['*']}
      source={{ html: PDFJS_HTML }}
      javaScriptEnabled
      onMessage={e => onCoverMessage(e.nativeEvent.data)}
    />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   SHARED ATOMS
───────────────────────────────────────────────────────────── */
function ProgressBar({ pct, T, h = 3 }: { pct: number; T: any; h?: number }) {
  if (!pct) return null;
  return (
    <View style={{ height: h, borderRadius: h, backgroundColor: T.border, overflow: 'hidden', marginTop: 5 }}>
      <View style={{ height: '100%', width: `${pct}%`, backgroundColor: T.accent, borderRadius: h }} />
    </View>
  );
}

function CatChip({ categoryId, T, small }: { categoryId: string; T: any; small?: boolean }) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  const label = cat ? cat.label : categoryId;
  return (
    <View style={{ backgroundColor: T.accentGlow, borderRadius: 20, paddingHorizontal: small ? 7 : 9, paddingVertical: small ? 2 : 3 }}>
      <Text style={{ fontSize: small ? 9 : 10, fontWeight: '600', color: T.accent }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   BOOK COVER — shows PDF page-1 image when ready, else CSS cover
───────────────────────────────────────────────────────────── */
function CssCover({ book, w, h, T }: { book: Book; w: number; h: number; T: any }) {
  const radius = w > 90 ? 12 : 8;
  return (
    <View style={{
      width: w, height: h, borderRadius: radius,
      backgroundColor: book.coverColor, overflow: 'hidden', flexShrink: 0,
      shadowColor: '#000', shadowOffset: { width: 0, height: w > 90 ? 12 : 5 },
      shadowOpacity: T.isDark ? 0.5 : 0.2, shadowRadius: w > 90 ? 16 : 7, elevation: 6,
    }}>
      <Svg width="100%" height="100%" viewBox="0 0 60 80" preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', opacity: 0.13 }}>
        <Defs>
          <Pattern id={`p${book.id}`} x="0" y="0" width="15" height="15" patternUnits="userSpaceOnUse">
            <Polygon points="7.5,1 14,4.5 14,10.5 7.5,14 1,10.5 1,4.5" fill="none" stroke="white" strokeWidth="0.6" />
          </Pattern>
        </Defs>
        <Rect width="60" height="80" fill={`url(#p${book.id})`} />
      </Svg>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: 'rgba(255,255,255,0.12)' }} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: w > 90 ? 8 : 5, paddingTop: w > 90 ? 24 : 16,
        backgroundColor: 'rgba(0,0,0,0.55)',
      }}>
        <Text style={{ fontSize: w > 90 ? 10 : 7.5, fontWeight: '700', color: '#fff', lineHeight: w > 90 ? 13 : 10 }}
          numberOfLines={w > 90 ? 3 : 2}>{book.title}</Text>
        {w > 90 && (
          <Text style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)', marginTop: 3 }} numberOfLines={1}>{book.author}</Text>
        )}
      </View>
      {!book.available && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)', fontWeight: '700', letterSpacing: 1.2 }}>SNART</Text>
        </View>
      )}
    </View>
  );
}

function Skeleton({ w, h, radius, T }: { w: number; h: number; radius: number; T: any }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });
  return (
    <Animated.View style={{
      width: w, height: h, borderRadius: radius,
      backgroundColor: T.isDark ? '#2C2C2E' : '#E8E8EA', opacity,
    }} />
  );
}

function BookCover({ book, w, h, T }: { book: Book; w: number; h: number; T: any }) {
  const { status, dataUrl } = usePdfCover(book.id, book.pdfPath);
  const radius = w > 90 ? 12 : 8;
  const shadow = {
    shadowColor: '#000', shadowOffset: { width: 0, height: w > 90 ? 12 : 5 },
    shadowOpacity: T.isDark ? 0.5 : 0.2, shadowRadius: w > 90 ? 16 : 7, elevation: 6,
  };

  if (status === 'done' && dataUrl) {
    return (
      <View style={[{ width: w, height: h, borderRadius: radius, overflow: 'hidden', flexShrink: 0 }, shadow]}>
        <Image source={{ uri: dataUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      </View>
    );
  }
  if (status === 'loading') {
    return <Skeleton w={w} h={h} radius={radius} T={T} />;
  }
  return <CssCover book={book} w={w} h={h} T={T} />;
}

/* ─────────────────────────────────────────────────────────────
   PDF READER — horizontal swipe page-by-page
───────────────────────────────────────────────────────────── */
function PdfReader({
  book, onClose, onSetPage, onAddBookmark, onRemoveBookmark, onToggleFav,
}: {
  book: Book; onClose: () => void;
  onSetPage: (id: string, page: number, total: number) => void;
  onAddBookmark: (id: string, page: number) => void;
  onRemoveBookmark: (id: string, page: number) => void;
  onToggleFav: (id: string) => void;
}) {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const [page, setPage]         = useState(book.lastReadPage || 1);
  const [total, setTotal]       = useState(book.pageCount || 0);
  const [controls, setControls] = useState(true);
  const [bmPanel, setBmPanel]   = useState(false);
  const [bmToast, setBmToast]   = useState(false);
  const [status, setStatus]     = useState<'loading' | 'ready' | 'error'>('loading');
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdfRef     = useRef<any>(null);
  const scaleRef   = useRef(1);

  // Unlock rotation while reading — re-lock portrait on exit.
  // Serialized to prevent lockAsync resolving after unlockAsync on quick exit+re-enter.
  useEffect(() => {
    serialOrientation(() => ScreenOrientation.unlockAsync());
    return () => {
      serialOrientation(() =>
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP),
      );
    };
  }, []);
  const isBookmarked = book.bookmarks.includes(page);

  const resetTimer = useCallback(() => {
    setControls(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setControls(false), 3500);
  }, []);

  useEffect(() => {
    resetTimer();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [resetTimer]);

  const ctrlOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(ctrlOpacity, { toValue: controls ? 1 : 0, duration: 280, useNativeDriver: true }).start();
  }, [controls, ctrlOpacity]);

  // ── goTo: same as PWA — always reset zoom before navigating ──────────────
  const goTo = useCallback((p: number) => {
    const clamped = Math.max(1, total ? Math.min(p, total) : p);
    pdfRef.current?.setPage?.(clamped);
    scaleRef.current = 1;
    resetTimer();
  }, [total, resetTimer]);

  const handleBookmark = () => {
    if (isBookmarked) { onRemoveBookmark(book.id, page); }
    else { onAddBookmark(book.id, page); setBmToast(true); setTimeout(() => setBmToast(false), 2200); }
    resetTimer();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      {/* PDF — pinch to zoom, single tap zones for navigation */}
        <Pdf
          ref={pdfRef}
          source={{ uri: book.pdfPath, cache: true }}
          page={book.lastReadPage || 1}
          horizontal
          enablePaging
          fitPolicy={0}
          style={{ flex: 1, width: '100%', backgroundColor: '#111' }}
          onScaleChanged={(s) => { scaleRef.current = s; }}
          onLoadComplete={(numberOfPages) => {
            setTotal(numberOfPages);
            setStatus('ready');
            onSetPage(book.id, page, numberOfPages);
          }}
          onPageChanged={(p, numberOfPages) => {
            setPage(p);
            onSetPage(book.id, p, numberOfPages);
          }}
          onPageSingleTap={() => {
            resetTimer();
          }}
          onError={() => setStatus('error')}
          renderActivityIndicator={() => (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={T.accent} />
              <Text style={{ color: T.textMuted, marginTop: 10, fontSize: 13 }}>Laddar…</Text>
            </View>
          )}
        />

      {/* TOP BAR */}
      <Animated.View
        pointerEvents={controls ? 'box-none' : 'none'}
        style={[styles.readerTopBar, { paddingTop: insets.top + 10, opacity: ctrlOpacity }]}
      >
        <TouchableOpacity onPress={onClose} style={styles.readerIconBtn}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '300' }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: '#fff', marginHorizontal: 8 }} numberOfLines={1}>
          {book.title}
        </Text>
        <TouchableOpacity onPress={() => { onToggleFav(book.id); resetTimer(); }} style={styles.readerIconBtn}>
          <Text style={{ fontSize: 18, color: book.isFavorite ? '#e05566' : '#fff' }}>
            {book.isFavorite ? '♥' : '♡'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setBmPanel(v => !v); resetTimer(); }} style={[styles.readerIconBtn, { marginLeft: 4 }]}>
          <Text style={{ fontSize: 16, color: bmPanel ? T.accent : '#fff' }}>🔖</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* BOOKMARKS PANEL */}
      {bmPanel && (
        <View style={[styles.bmPanel, {
          top: insets.top + 56,
          backgroundColor: T.isDark ? 'rgba(15,15,15,0.97)' : 'rgba(255,255,255,0.97)',
          borderColor: T.border,
        }]}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: T.textMuted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
            Bokmärken
          </Text>
          {book.bookmarks.length === 0 ? (
            <Text style={{ fontSize: 13, color: T.textMuted }}>Inga bokmärken ännu</Text>
          ) : book.bookmarks.map(p => (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 }}>
              <TouchableOpacity onPress={() => { goTo(p); setPage(p); setBmPanel(false); }}>
                <Text style={{ fontSize: 13, color: T.text }}>Sida {p}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onRemoveBookmark(book.id, p)}>
                <Text style={{ fontSize: 18, color: T.textMuted, lineHeight: 22 }}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* BOOKMARK TOAST */}
      {bmToast && (
        <View style={[styles.bmToast, { backgroundColor: T.accent, bottom: insets.bottom + 90 }]}>
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓ Bokmärke sparat — sida {page}</Text>
        </View>
      )}

      {/* BOTTOM CONTROLS */}
      <Animated.View
        pointerEvents={controls ? 'box-none' : 'none'}
        style={[styles.readerBottomBar, { paddingBottom: insets.bottom + 12, opacity: ctrlOpacity }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <TouchableOpacity
            onPress={() => goTo(page - 1)}
            disabled={page <= 1}
            style={[styles.navBtn, { opacity: page <= 1 ? 0.3 : 1 }]}
          >
            <Text style={{ color: '#fff', fontSize: 22, lineHeight: 26 }}>‹</Text>
          </TouchableOpacity>

          <View style={{ alignItems: 'center', minWidth: 80 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
              {page}{total ? ` / ${total}` : ''}
            </Text>
          </View>

          <TouchableOpacity onPress={handleBookmark} style={[styles.navBtn, { paddingHorizontal: 14 }]}>
            <Text style={{ fontSize: 16, color: isBookmarked ? T.accent : '#fff' }}>🔖</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => goTo(page + 1)}
            disabled={!!total && page >= total}
            style={[styles.navBtn, { opacity: total && page >= total ? 0.3 : 1 }]}
          >
            <Text style={{ color: '#fff', fontSize: 22, lineHeight: 26 }}>›</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {status === 'error' && (
        <View style={styles.errorOverlay}>
          <Text style={{ fontSize: 44 }}>📄</Text>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 12 }}>
            Kunde inte ladda PDF:en
          </Text>
          <TouchableOpacity onPress={onClose} style={{ marginTop: 20, backgroundColor: T.accent, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Stäng</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   BOOK DETAIL
───────────────────────────────────────────────────────────── */
function SectionLabel({ label, T }: { label: string; T: any }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>
      {label}
    </Text>
  );
}

const BOOK_SCREEN_W = Dimensions.get('window').width;

function BookDetail({
  book, allBooks, onBack, onRead, onToggleFav, onSelectRelated, T,
}: {
  book: Book; allBooks: Book[]; onBack: () => void;
  onRead: (page: number | null) => void;
  onToggleFav: (id: string) => void;
  onSelectRelated: (b: Book) => void;
  T: any;
}) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const translateX = useRef(new Animated.Value(BOOK_SCREEN_W)).current;

  useEffect(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start();
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [book.id]);

  const edgePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gs) =>
      evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
    onPanResponderMove: (_, gs) => { if (gs.dx > 0) translateX.setValue(gs.dx); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > BOOK_SCREEN_W * 0.35 || gs.vx > 0.5) {
        Animated.timing(translateX, { toValue: BOOK_SCREEN_W, duration: 220, useNativeDriver: true }).start(onBack);
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start();
    },
  })).current;

  const shadowOpacity = translateX.interpolate({ inputRange: [0, BOOK_SCREEN_W * 0.5], outputRange: [0.2, 0], extrapolate: 'clamp' });

  const hasProgress = book.progressPercent > 0 && book.lastReadPage > 1;
  const related = allBooks.filter(b => b.category === book.category && b.id !== book.id && b.available).slice(0, 4);
  const readingMins = book.pageCount ? Math.round(book.pageCount * 1.5) : null;
  const readingLabel = readingMins
    ? readingMins >= 60 ? `${Math.floor(readingMins / 60)} h ${readingMins % 60} min` : `${readingMins} min`
    : null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 10, transform: [{ translateX }] }]}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, zIndex: 1, opacity: shadowOpacity, shadowColor: '#000', shadowOffset: { width: -8, height: 0 }, shadowOpacity: 1, shadowRadius: 16 }} />
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />
    <ScrollView ref={scrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <View style={{ backgroundColor: book.coverColor + 'dd', paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: insets.top + 10, paddingHorizontal: 14 }}>
          <TouchableOpacity onPress={onBack} style={[styles.detailBackBtn, { backgroundColor: 'rgba(0,0,0,0.3)' }]}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>‹ Tillbaka</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onToggleFav(book.id)} style={[styles.detailBackBtn, { backgroundColor: 'rgba(0,0,0,0.3)' }]}>
            <Text style={{ fontSize: 18, color: book.isFavorite ? '#e05566' : '#fff' }}>{book.isFavorite ? '♥' : '♡'}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ alignItems: 'center', paddingTop: 24, gap: 16 }}>
          <BookCover book={book} w={140} h={196} T={T} />
          <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: '#fff', textAlign: 'center', lineHeight: 28, marginBottom: 6 }}>{book.title}</Text>
            <Text style={{ fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.95)', marginBottom: 10 }}>{book.author}</Text>
            <CatChip categoryId={book.category} T={T} />
          </View>
        </View>
      </View>

      <View style={{ padding: 16, paddingBottom: 60 }}>
        {hasProgress && (
          <View style={{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Läsframsteg</Text>
              <Text style={{ fontSize: 11, color: T.accent, fontWeight: '700' }}>{book.progressPercent}%</Text>
            </View>
            <ProgressBar pct={book.progressPercent} T={T} h={5} />
            <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>Senast på sida {book.lastReadPage}</Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22 }}>
          {book.available ? (
            <>
              <TouchableOpacity onPress={() => onRead(null)}
                style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: T.accent, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                  {hasProgress ? `Fortsätt — sida ${book.lastReadPage}` : 'Läs nu'}
                </Text>
              </TouchableOpacity>
              {hasProgress && (
                <TouchableOpacity onPress={() => onRead(1)}
                  style={{ padding: 14, borderRadius: 14, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, alignItems: 'center' }}>
                  <Text style={{ color: T.textSecondary, fontSize: 13, fontWeight: '600' }}>Från början</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <View style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, color: T.textMuted }}>Kommer snart</Text>
            </View>
          )}
        </View>

        {book.bookmarks.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <SectionLabel label="Bokmärken" T={T} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {book.bookmarks.map(p => (
                <TouchableOpacity key={p} onPress={() => onRead(p)}
                  style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: T.card, borderWidth: 1, borderColor: T.accent + '55' }}>
                  <Text style={{ color: T.accent, fontSize: 13, fontWeight: '600' }}>Sida {p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={{ marginBottom: 22 }}>
          <SectionLabel label="Om boken" T={T} />
          <Text style={{ fontSize: 15, lineHeight: 24, color: T.textSecondary, marginBottom: 14 }}>{book.longDescription}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {book.pageCount != null && (
              <Text style={{ fontSize: 13, color: T.textMuted }}>📄 <Text style={{ color: T.text, fontWeight: '600' }}>{book.pageCount}</Text> sidor</Text>
            )}
            {readingLabel && (
              <Text style={{ fontSize: 13, color: T.textMuted }}>⏱ Ca <Text style={{ color: T.text, fontWeight: '600' }}>{readingLabel}</Text> att läsa</Text>
            )}
            {book.publishedYear != null && (
              <Text style={{ fontSize: 13, color: T.textMuted }}>📅 Utgiven <Text style={{ color: T.text, fontWeight: '600' }}>{book.publishedYear}</Text></Text>
            )}
          </View>
        </View>

        {related.length > 0 && (
          <View>
            <SectionLabel label="Fler böcker i kategorin" T={T} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {related.map(b => (
                <TouchableOpacity key={b.id} onPress={() => onSelectRelated(b)} style={{ marginRight: 12 }}>
                  <BookCover book={b} w={70} h={98} T={T} />
                  <Text style={{ width: 70, fontSize: 10, color: T.textMuted, marginTop: 4, lineHeight: 14 }} numberOfLines={2}>{b.title}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </ScrollView>
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────────────────
   BOOK ROW
───────────────────────────────────────────────────────────── */
function BookRow({ book, onSelect, T }: { book: Book; onSelect: () => void; T: any }) {
  const mins = book.pageCount ? Math.round(book.pageCount * 1.5) : null;
  const timeLabel = mins ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`) : null;
  return (
    <TouchableOpacity onPress={onSelect} style={{
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
      borderRadius: 14, padding: 12, marginBottom: 10,
    }}>
      <BookCover book={book} w={64} h={90} T={T} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 3, lineHeight: 18 }} numberOfLines={2}>{book.title}</Text>
        <Text style={{ fontSize: 12, color: T.textSecondary, marginBottom: 5, fontWeight: '500' }} numberOfLines={1}>{book.author}</Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <CatChip categoryId={book.category} T={T} small />
          {book.pageCount != null && <Text style={{ fontSize: 9, color: T.textMuted }}>{book.pageCount} s.</Text>}
          {timeLabel && <Text style={{ fontSize: 9, color: T.textMuted }}>⏱ {timeLabel}</Text>}
          {!book.available && (
            <View style={{ backgroundColor: T.bgSecondary, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 9, color: T.textMuted }}>Snart</Text>
            </View>
          )}
          {book.isFavorite && <Text style={{ fontSize: 11 }}>❤️</Text>}
        </View>
        {book.progressPercent > 0 && <ProgressBar pct={book.progressPercent} T={T} />}
      </View>
      <Text style={{ color: T.textMuted, fontSize: 18, opacity: 0.35 }}>›</Text>
    </TouchableOpacity>
  );
}

/* ─────────────────────────────────────────────────────────────
   LIBRARY
───────────────────────────────────────────────────────────── */
const SORT_OPTS = [
  { id: 'az',        label: 'A – Ö' },
  { id: 'recent',    label: 'Senast öppnad' },
  { id: 'newest',    label: 'Nyast utgiven' },
  { id: 'favorites', label: 'Favoriter' },
];

function Library({ books, onSelect, T }: { books: Book[]; onSelect: (b: Book) => void; T: any }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [cat,      setCat]      = useState('all');
  const [sort,     setSort]     = useState('newest');
  const [query,    setQuery]    = useState('');
  const [sortOpen, setSortOpen] = useState(false);

  const favorites  = useMemo(() => books.filter(b => b.isFavorite), [books]);
  const inProgress = useMemo(() => books.filter(b => b.progressPercent > 0 && b.progressPercent < 100 && b.available), [books]);

  const filtered = useMemo(() => {
    let list = cat === 'all' ? books : books.filter(b => b.category === cat);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(b =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    if (sort === 'az')        return [...list].sort((a, b) => a.title.localeCompare(b.title, 'sv'));
    if (sort === 'recent')    return [...list].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
    if (sort === 'newest')    return [...list].sort((a, b) => (b.publishedYear || 0) - (a.publishedYear || 0));
    if (sort === 'favorites') return [...list].sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0));
    return list;
  }, [books, cat, query, sort]);

  const ListHeader = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {CATEGORIES.map(c => {
          const active = cat === c.id;
          return (
            <TouchableOpacity key={c.id} onPress={() => setCat(c.id)} style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
              backgroundColor: active ? T.accent : T.card,
              borderWidth: 1, borderColor: active ? T.accent : T.border, marginRight: 7,
            }}>
              <Text style={{ fontSize: 12, fontWeight: active ? '700' : '500', color: active ? '#fff' : T.textSecondary }}>
                {c.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {inProgress.length > 0 && !query && cat === 'all' && (
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 }}>
            Fortsätt läsa
          </Text>
          <FlatList
            horizontal
            data={inProgress}
            keyExtractor={b => b.id}
            showsHorizontalScrollIndicator={false}
            initialNumToRender={3}
            renderItem={({ item: b }) => (
              <TouchableOpacity onPress={() => onSelect(b)} style={{
                width: 130, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 12, marginRight: 12,
              }}>
                <BookCover book={b} w={106} h={148} T={T} />
                <Text style={{ fontSize: 11, fontWeight: '700', color: T.text, marginTop: 8, lineHeight: 15 }} numberOfLines={2}>{b.title}</Text>
                <ProgressBar pct={b.progressPercent} T={T} />
                <Text style={{ fontSize: 10, color: T.accent, marginTop: 3, fontWeight: '700' }}>Sida {b.lastReadPage}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {favorites.length > 0 && !query && cat === 'all' && (
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 }}>
            Favoriter
          </Text>
          <FlatList
            horizontal
            data={favorites}
            keyExtractor={b => b.id}
            showsHorizontalScrollIndicator={false}
            initialNumToRender={4}
            renderItem={({ item: b }) => (
              <TouchableOpacity onPress={() => onSelect(b)} style={{ marginRight: 12 }}>
                <BookCover book={b} w={70} h={98} T={T} />
                <Text style={{ width: 70, fontSize: 10, color: T.textMuted, marginTop: 4, lineHeight: 14 }} numberOfLines={2}>{b.title}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 }}>
        <Text style={{ fontSize: 10, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1.2 }}>
          {query ? `Resultat (${filtered.length})` : 'Alla böcker'}
        </Text>
        <View>
          <TouchableOpacity onPress={() => setSortOpen(v => !v)} style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
            borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
          }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: T.textMuted }}>
              ≡ {SORT_OPTS.find(s => s.id === sort)?.label}
            </Text>
          </TouchableOpacity>
          {sortOpen && (
            <View style={[styles.sortDropdown, { backgroundColor: T.card, borderColor: T.border }]}>
              {SORT_OPTS.map(opt => (
                <TouchableOpacity key={opt.id} onPress={() => { setSort(opt.id); setSortOpen(false); }}
                  style={{ padding: 10, backgroundColor: sort === opt.id ? T.accentGlow : 'transparent' }}>
                  <Text style={{ fontSize: 13, fontWeight: sort === opt.id ? '700' : '400', color: sort === opt.id ? T.accent : T.text }}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: T.bg, borderBottomWidth: 1, borderBottomColor: T.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <BackButton onPress={() => router.back()} />
          <Text style={{ fontSize: 27, fontWeight: '800', color: T.text }}>E-böcker</Text>
        </View>
        <View style={{ position: 'relative', marginBottom: 12 }}>
          <TextInput
            placeholder="Sök titel, författare, ämne…"
            placeholderTextColor={T.textMuted}
            value={query}
            onChangeText={setQuery}
            style={{ width: '100%', padding: 11, paddingLeft: 36, borderRadius: 12, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, color: T.text, fontSize: 16 }}
          />
          <Text style={{ position: 'absolute', left: 12, top: 13, color: T.textMuted, fontSize: 14 }}>🔍</Text>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <BookRow book={item} onSelect={() => { setSortOpen(false); onSelect(item); }} T={T} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        ListHeaderComponent={ListHeader}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => setSortOpen(false)}
        initialNumToRender={5}
        maxToRenderPerBatch={4}
        windowSize={5}
        removeClippedSubviews={true}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 48 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: T.text, marginBottom: 6 }}>Inga böcker hittades</Text>
            <Text style={{ fontSize: 13, color: T.textMuted }}>Prova ett annat sökord eller kategori</Text>
          </View>
        }
      />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   ROOT SCREEN
───────────────────────────────────────────────────────────── */
export default function EbooksScreen() {
  const { theme: T } = useTheme();
  const { books, toggleFavorite, setLastReadPage, addBookmark, removeBookmark, markOpened } = useBooks();
  const [view,       setView]       = useState<'library' | 'detail' | 'reader'>('library');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readerPage, setReaderPage] = useState<number | null>(null);

  const selectedBook = useMemo(() => books.find(b => b.id === selectedId) ?? null, [books, selectedId]);

  useEffect(() => {
    preloadCoverCache(books.map(b => ({ id: b.id, pdfPath: b.pdfPath })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = useCallback((book: Book) => {
    markOpened(book.id);
    setSelectedId(book.id);
    setView('detail');
  }, [markOpened]);

  const openReader = useCallback((startPage: number | null) => {
    setReaderPage(startPage);
    setView('reader');
  }, []);

  const closeReader = useCallback(() => {
    setView('detail');
    setReaderPage(null);
  }, []);

  const readerBook = useMemo(() => {
    if (!selectedBook) return null;
    if (readerPage != null) return { ...selectedBook, lastReadPage: readerPage };
    return selectedBook;
  }, [selectedBook, readerPage]);

  return (
    <View style={{ flex: 1 }}>
      {/* Single global WebView cover renderer — always mounted for queue processing */}
      <CoverRendererWebView />

      {/* Library is always rendered so it's visible behind BookDetail on swipe-back */}
      <Library books={books} onSelect={openDetail} T={T} />

      {/* BookDetail slides in as absoluteFill on top of Library */}
      {selectedBook && view !== 'library' && (
        <BookDetail
          book={selectedBook}
          allBooks={books}
          onBack={() => setView('library')}
          onRead={openReader}
          onToggleFav={toggleFavorite}
          onSelectRelated={(b) => { markOpened(b.id); setSelectedId(b.id); }}
          T={T}
        />
      )}

      {/* PDF reader in a Modal on top of everything */}
      {view === 'reader' && readerBook && (
        <Modal visible animationType="slide" onRequestClose={closeReader} supportedOrientations={['portrait', 'landscape']}>
          <PdfReader
            book={readerBook}
            onClose={closeReader}
            onSetPage={setLastReadPage}
            onAddBookmark={addBookmark}
            onRemoveBookmark={removeBookmark}
            onToggleFav={toggleFavorite}
          />
        </Modal>
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   STYLES
───────────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  readerTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    paddingHorizontal: 14, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  readerIconBtn: {
    padding: 7, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.45)',
  },
  readerBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
    paddingHorizontal: 16, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.72)',
  },
  navBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
  },
  bmPanel: {
    position: 'absolute', right: 12, zIndex: 30,
    borderWidth: 1, borderRadius: 14, padding: 12, minWidth: 170,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.6, shadowRadius: 20, elevation: 10,
  },
  bmToast: {
    position: 'absolute', alignSelf: 'center',
    borderRadius: 20, paddingHorizontal: 18, paddingVertical: 6, zIndex: 40,
  },
  errorOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  detailBackBtn: {
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  sortDropdown: {
    position: 'absolute', right: 0, top: 36, zIndex: 50,
    borderWidth: 1, borderRadius: 12, overflow: 'hidden', minWidth: 155,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 8,
  },
});
