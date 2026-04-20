import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, ScrollView,
  Animated, Easing, PanResponder, Dimensions, StyleSheet, ActivityIndicator, Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import BackButton from '../components/BackButton';
import Svg, { Path, Rect, Polygon } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { pauseYoutubePlayer } from '../context/YoutubePlayerContext';
import { DhikrCategoryIcon } from '../components/DhikrCategoryIcon';
import DhikrWellbeingView from '../components/dhikr/DhikrWellbeingView';
import {
  GRUPPER,
  ALL_DHIKR,
  dhikrKey,
  groupCount,
  type DhikrPost,
  type Delpost,
  type GruppUndersida,
  type Grupp,
} from '../data/dhikrRepository';
import { searchDhikr } from '../services/wellbeingSearch';
import ArabicText from '../components/ArabicText';
import QCFVerseText from '../components/QCFVerseText';

// Global stopper — ensures only one AudioPlayer plays at a time across the whole screen.
// When a player starts, it registers its stop function here. Any subsequent play call
// first invokes the registered stopper before creating a new player.
let _stopActiveAudio: (() => void) | null = null;
const STORAGE_FAV = 'dhikr-favorites-v1';
const SCREEN_W    = Dimensions.get('window').width;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtTime = (s: number) => (!s || isNaN(s)) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ─── Slide screen wrapper ─────────────────────────────────────────────────────
// Manages the slide-in/out animation + edge-swipe gesture for sub-views
function useSlideIn(onClose: () => void) {
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;
  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0, duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);
  const edgePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gs) =>
      evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
    onPanResponderMove: (_, gs) => { if (gs.dx > 0) translateX.setValue(gs.dx); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > SCREEN_W * 0.35 || gs.vx > 0.5) {
        Animated.timing(translateX, { toValue: SCREEN_W, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onClose);
      } else {
        Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    },
  })).current;
  const shadowOpacity = translateX.interpolate({ inputRange: [0, SCREEN_W * 0.5], outputRange: [0.2, 0], extrapolate: 'clamp' });
  const goBack = useCallback(() => {
    Animated.timing(translateX, { toValue: SCREEN_W, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onClose);
  }, [onClose]);
  return { translateX, edgePan, shadowOpacity, goBack };
}

// ─── Audio player component ────────────────────────────────────────────────────
function AudioPlayer({ url, T, isDark }: { url: string; T: any; isDark: boolean }) {
  const playerRef  = useRef<any>(null);
  const barRef     = useRef(0);
  const mountedRef = useRef(true);
  const repeatRef  = useRef(false);
  const [playing,  setPlaying]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(false);
  const [cur,      setCur]      = useState(0);
  const [dur,      setDur]      = useState(0);
  const [repeat,   setRepeat]   = useState(false);

  // stopSelf: stops + removes this player and clears its state.
  // Registered in _stopActiveAudio so other players can preempt it.
  const stopSelf = useCallback(() => {
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch {}
      try { playerRef.current.remove(); } catch {}
      playerRef.current = null;
    }
    if (mountedRef.current) { setPlaying(false); setLoading(false); setCur(0); }
  }, []);

  // Unmount cleanup + global deregistration.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (_stopActiveAudio === stopSelf) _stopActiveAudio = null;
      // pause() before remove() — remove() alone does not stop active playback.
      if (playerRef.current) {
        try { playerRef.current.pause(); } catch {}
        try { playerRef.current.remove(); } catch {}
        playerRef.current = null;
      }
    };
  }, [stopSelf]);

  // Reset when URL changes (different dhikr card opened).
  useEffect(() => {
    if (_stopActiveAudio === stopSelf) _stopActiveAudio = null;
    // pause() before remove() — remove() alone does not stop active playback.
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch {}
      try { playerRef.current.remove(); } catch {}
      playerRef.current = null;
    }
    if (mountedRef.current) { setPlaying(false); setCur(0); setDur(0); setError(false); setLoading(false); }
  }, [url, stopSelf]);

  const toggle = async () => {
    if (loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let audio: any;
    try { audio = require('expo-audio'); } catch { return; }

    if (playerRef.current) {
      const p = playerRef.current;
      if (p.playing) {
        p.pause();
        setPlaying(false);
        if (_stopActiveAudio === stopSelf) _stopActiveAudio = null;
        return;
      }
      // Resume: stop any other player that started while this was paused.
      if (_stopActiveAudio && _stopActiveAudio !== stopSelf) { _stopActiveAudio(); _stopActiveAudio = null; }
      p.play();
      setPlaying(true);
      _stopActiveAudio = stopSelf;
      return;
    }

    // New player: preempt whoever is currently playing (including YouTube live).
    if (_stopActiveAudio) { _stopActiveAudio(); _stopActiveAudio = null; }
    pauseYoutubePlayer();

    setLoading(true);
    try {
      await audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true });
      const player = audio.createAudioPlayer({ uri: url });
      playerRef.current = player;
      _stopActiveAudio = stopSelf;
      player.play();
      if (mountedRef.current) setPlaying(true);
      player.addListener('playbackStatusUpdate', (s: any) => {
        if (s.currentTime !== undefined) setCur(s.currentTime);
        if (s.duration !== undefined && s.duration > 0) setDur(s.duration);
        if (s.didJustFinish) {
          if (repeatRef.current && playerRef.current) {
            try { playerRef.current.seekTo(0); playerRef.current.play(); } catch {}
            if (mountedRef.current) setCur(0);
          } else {
            if (mountedRef.current) { setPlaying(false); setCur(0); }
            if (_stopActiveAudio === stopSelf) _stopActiveAudio = null;
          }
        }
      });
    } catch {
      if (mountedRef.current) setError(true);
      if (_stopActiveAudio === stopSelf) _stopActiveAudio = null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const seek = (x: number) => {
    if (!barRef.current || !dur || !playerRef.current) return;
    const pos = (x / barRef.current) * dur;
    try { playerRef.current.seekTo(pos); setCur(pos); } catch {}
  };

  const pct = dur > 0 ? Math.min((cur / dur) * 100, 100) : 0;
  const barBg = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
  const bg    = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  const toggleRepeat = useCallback(() => {
    Haptics.selectionAsync();
    const next = !repeatRef.current;
    repeatRef.current = next;
    setRepeat(next);
  }, []);

  const repeatColor = repeat ? T.accent : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)');

  return (
    <View style={{ marginTop: 14, backgroundColor: bg, borderRadius: 12, padding: 12 }}>
      {/* Controls row: play — bar — repeat */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity onPress={toggle} disabled={!!error}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: error ? '#c0392b' : T.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> :
           error ? <Text style={{ color: '#fff', fontSize: 11 }}>✕</Text> :
           playing ? (
             <Svg width={11} height={12} viewBox="0 0 11 12">
               <Rect x={0} y={0} width={4} height={12} rx={1} fill="#fff" />
               <Rect x={7} y={0} width={4} height={12} rx={1} fill="#fff" />
             </Svg>
           ) : (
             <Svg width={11} height={12} viewBox="0 0 11 12">
               <Path d="M0 0L11 6L0 12Z" fill="#fff" />
             </Svg>
           )}
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}
          onLayout={e => { barRef.current = e.nativeEvent.layout.width; }}
          onPress={e => seek(e.nativeEvent.locationX)}>
          <View style={{ height: 3, borderRadius: 3, backgroundColor: barBg }}>
            <View style={{ height: '100%', width: `${pct}%` as any, borderRadius: 3, backgroundColor: T.accent }} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={toggleRepeat} activeOpacity={0.7}
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path
              d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"
              stroke={repeatColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>
      </View>
      {/* Time labels below */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
        <Text style={{ fontSize: 11, fontWeight: '500', color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)' }}>{fmtTime(cur)}</Text>
        <Text style={{ fontSize: 11, fontWeight: '500', color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)' }}>{fmtTime(dur)}</Text>
      </View>
    </View>
  );
}

// ─── Repetition badge with rotating icon ─────────────────────────────────────
function RepetitionBadge({ text, T, isDark }: { text: string; T: any; isDark: boolean }) {
  const rotation = useRef(new Animated.Value(0)).current;
  const rotDeg   = useRef(0);

  useEffect(() => {
    const run = () => {
      Animated.sequence([
        Animated.delay(5000),
        Animated.timing(rotation, {
          toValue: rotDeg.current + 180,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          rotDeg.current += 180;
          run();
        }
      });
    };
    run();
    return () => rotation.stopAnimation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const iconRotate = rotation.interpolate({
    inputRange:  [0, 360],
    outputRange: ['0deg', '360deg'],
    extrapolate: 'extend',
  });

  return (
    <View style={{ flexDirection: 'row', marginBottom: 10 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 7,
        backgroundColor: isDark ? 'rgba(36,100,93,0.32)' : 'rgba(36,100,93,0.14)',
        borderWidth: 1,
        borderColor: T.accent,
        borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
      }}>
        <Animated.View style={{ transform: [{ rotate: iconRotate }] }}>
          <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M1 4v6h6M23 20v-6h-6" /><Path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </Svg>
        </Animated.View>
        <Text style={{ fontSize: 12, fontWeight: '700', color: T.accent }}>
          {text}
        </Text>
      </View>
    </View>
  );
}

// ─── Dhikr detail card ────────────────────────────────────────────────────────
function DhikrCard({ d, T, isDark, favorites, onToggleFav }: {
  d: DhikrPost; T: any; isDark: boolean;
  favorites: string[];
  onToggleFav: (k: string) => void;
}) {
  const key   = dhikrKey(d);
  const isFav = favorites.includes(key);

  const chipBg      = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)';
  const dividerCol  = T.border;

  const share = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let parts: string[];
    if (d.delposter && d.delposter.length > 0) {
      parts = [d.titel, d.lases_info, d.kallhanvisning].filter(Boolean) as string[];
      for (const dp of d.delposter) {
        parts.push(...[dp.titel, dp.arabisk_text, dp.translitteration, dp.svensk_text, dp.kallhanvisning].filter(Boolean) as string[]);
      }
    } else {
      parts = [d.titel, d.arabisk_text, d.translitteration, d.svensk_text, d.kallhanvisning].filter(Boolean) as string[];
    }
    Share.share({ title: d.titel, message: parts.join('\n\n') });
  };

  // Chip above, text below — full width for content
  function ContentRow({ chip, chipAccent, children }: { chip: string; chipAccent?: boolean; children: React.ReactNode }) {
    return (
      <View style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: chipAccent ? T.accentGlow : chipBg, alignSelf: 'flex-start', marginBottom: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: '600', color: chipAccent ? T.accent : (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)') }}>{chip}</Text>
        </View>
        <View>{children}</View>
      </View>
    );
  }

  const rows = [
    d.arabisk_text     ? 'ara' : null,
    d.translitteration ? 'tra' : null,
    d.svensk_text      ? 'swe' : null,
  ].filter(Boolean) as string[];

  return (
    <View style={{ marginBottom: 16 }}>
      {/* Title + actions */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: d.lases_info ? 8 : 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: T.text, lineHeight: 24 }}>{d.titel}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
            <View style={{ backgroundColor: T.accentGlow, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 }}>
              <Text style={{ fontSize: 10, color: T.accent, fontWeight: '600' }}>{d._kategori}</Text>
            </View>
            <Text style={{ fontSize: 11, color: T.textMuted }}>›</Text>
            <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 }}>
              <Text style={{ fontSize: 10, color: T.textMuted, fontWeight: '500' }}>{d._undersida}</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onToggleFav(key); }} style={{ padding: 6 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill={isFav ? '#f5a623' : 'none'} stroke={isFav ? '#f5a623' : T.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </Svg>
        </TouchableOpacity>
        <TouchableOpacity onPress={share} style={{ padding: 6 }}>
          <Svg width={18} height={20} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M20 13V17.5C20 20.5577 16 20.5 12 20.5C8 20.5 4 20.5577 4 17.5V13M12 3L12 15M12 3L16 7M12 3L8 7" />
          </Svg>
        </TouchableOpacity>
      </View>

      {/* Repetition badge — shown above the card when lases_info is set */}
      {!!d.lases_info && (
        <RepetitionBadge text={d.lases_info} T={T} isDark={isDark} />
      )}

      {/* Content box — all sections stacked */}
      <View style={{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 16, overflow: 'hidden' }}>
        {d.delposter && d.delposter.length > 0 ? (
          // ── Grouped rendering ──────────────────────────────────────────────────
          <>
            {/* Parent source — general hadith context */}
            {!!d.kallhanvisning && (
              <>
                {!!d.lases_info && <View style={{ height: 1, backgroundColor: dividerCol, marginHorizontal: 16 }} />}
                <ContentRow chip="Källa">
                  <Text style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)', lineHeight: 18 }}>{d.kallhanvisning}</Text>
                </ContentRow>
              </>
            )}

            {/* Each delposter as its own block */}
            {d.delposter.map((dp: Delpost, di: number) => {
              const dpRows = [
                dp.arabisk_text     ? 'ara' : null,
                dp.translitteration ? 'tra' : null,
                dp.svensk_text      ? 'swe' : null,
              ].filter(Boolean) as string[];
              return (
                <View key={di}>
                  <View style={{ height: 1, backgroundColor: dividerCol, marginHorizontal: 16 }} />
                  {/* Sub-title */}
                  <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: T.text }}>{dp.titel}</Text>
                  </View>
                  {/* Arabic, transliteration, swedish */}
                  {dpRows.map((row, ri) => (
                    <View key={row}>
                      {ri > 0 && <View style={{ height: 1, backgroundColor: dividerCol, marginHorizontal: 16 }} />}
                      {row === 'ara' && (
                        <ContentRow chip="عربي" chipAccent>
                          {dp.qcf_page && dp.qcf_glyphs
                            ? <QCFVerseText
                                page={dp.qcf_page}
                                glyphs={dp.qcf_glyphs}
                                showBismillah={dp.qcf_bismillah}
                                fallbackText={dp.arabisk_text}
                                color={T.text}
                              />
                            : <ArabicText style={{ fontSize: 22, lineHeight: 46, color: T.text, textAlign: 'right', writingDirection: 'rtl' }}>{dp.arabisk_text}</ArabicText>
                          }
                        </ContentRow>
                      )}
                      {row === 'tra' && (
                        <ContentRow chip="Uttal">
                          <Text style={{ fontSize: 14, lineHeight: 26, color: T.text }}>{dp.translitteration}</Text>
                        </ContentRow>
                      )}
                      {row === 'swe' && (
                        <ContentRow chip="Svenska">
                          <Text style={{ fontSize: 14, lineHeight: 26, color: T.text, fontStyle: 'italic' }}>{dp.svensk_text}</Text>
                        </ContentRow>
                      )}
                    </View>
                  ))}
                  {/* Per-delposter source */}
                  {!!dp.kallhanvisning && (
                    <>
                      <View style={{ height: 1, backgroundColor: dividerCol, marginHorizontal: 16 }} />
                      <ContentRow chip="Källa">
                        <Text style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)', lineHeight: 18 }}>{dp.kallhanvisning}</Text>
                      </ContentRow>
                    </>
                  )}
                </View>
              );
            })}
          </>
        ) : (
          // ── Normal rendering ────────────────────────────────────────────────────
          <>
            {rows.map((row, i) => (
              <View key={row}>
                {i > 0 && <View style={{ height: 1, backgroundColor: dividerCol, marginHorizontal: 16 }} />}
                {row === 'ara' && (
                  <ContentRow chip="عربي" chipAccent>
                    {d.qcf_page && d.qcf_glyphs
                      ? <QCFVerseText
                          page={d.qcf_page}
                          glyphs={d.qcf_glyphs}
                          showBismillah={d.qcf_bismillah}
                          fallbackText={d.arabisk_text}
                          color={T.text}
                        />
                      : <ArabicText style={{ fontSize: 22, lineHeight: 46, color: T.text, textAlign: 'right', writingDirection: 'rtl' }}>{d.arabisk_text}</ArabicText>
                    }
                  </ContentRow>
                )}
                {row === 'tra' && (
                  <ContentRow chip="Uttal">
                    <Text style={{ fontSize: 14, lineHeight: 26, color: T.text }}>{d.translitteration}</Text>
                  </ContentRow>
                )}
                {row === 'swe' && (
                  <ContentRow chip="Svenska">
                    <Text style={{ fontSize: 14, lineHeight: 26, color: T.text, fontStyle: 'italic' }}>{d.svensk_text}</Text>
                  </ContentRow>
                )}
              </View>
            ))}

            {/* hadiths — structured hadith texts each with their own source chip */}
            {!!d.hadiths && d.hadiths.length > 0 && d.hadiths.map((h, i) => (
              <View key={i}>
                <View style={{ height: 1, backgroundColor: dividerCol, marginHorizontal: 16 }} />
                <ContentRow chip="Hadith">
                  <Text style={{ fontSize: 13, lineHeight: 22, color: T.text }}>{h.text}</Text>
                </ContentRow>
                <View style={{ height: 1, backgroundColor: dividerCol, marginHorizontal: 16 }} />
                <ContentRow chip="Källa">
                  <Text style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)', lineHeight: 18 }}>{h.kalla}</Text>
                </ContentRow>
              </View>
            ))}

            {/* Source */}
            {!!d.kallhanvisning && (
              <>
                <View style={{ height: 1, backgroundColor: dividerCol, marginHorizontal: 16 }} />
                <ContentRow chip="Källa">
                  <Text style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)', lineHeight: 18 }}>{d.kallhanvisning}</Text>
                </ContentRow>
              </>
            )}
          </>
        )}

        {/* Audio player */}
        {!!d.mp3_url && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 14 }}>
            <View style={{ height: 1, backgroundColor: dividerCol, marginBottom: 12 }} />
            <AudioPlayer url={d.mp3_url} T={T} isDark={isDark} />
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Accordion sub-section ────────────────────────────────────────────────────
function AccordionSection({ us, isOpen, onToggle, onSelectDhikr, favorites, T, isDark }: {
  us: GruppUndersida; isOpen: boolean; onToggle: () => void;
  onSelectDhikr: (d: DhikrPost, siblings: DhikrPost[]) => void;
  favorites: string[]; T: any; isDark: boolean;
}) {
  const hasFav    = us.dhikr_poster.some(d => favorites.includes(dhikrKey(d)));
  const hasAudio  = us.dhikr_poster.some(d => d.mp3_url);
  const rowBg     = isDark ? 'rgba(255,255,255,0.025)' : T.accentGlow;
  const badgeBg   = T.accentGlow;
  const openBg    = T.accentGlow;
  const openAnim = useRef(new Animated.Value(isOpen ? 1 : 0)).current;

  useEffect(() => {
    const anim = Animated.spring(openAnim, {
      toValue: isOpen ? 1 : 0,
      useNativeDriver: false,
      tension: 120, friction: 16,
    });
    anim.start();
    return () => {
      anim.stop();
      // stopAnimation clears the internal tracking nodes created by interpolate(),
      // preventing the "onAnimatedValueUpdate with no listeners" warning.
      openAnim.stopAnimation();
    };
  }, [isOpen, openAnim]);

  const maxHeight  = openAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 2000] });
  const chevRotate = openAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: T.border }}>
      {/* Header */}
      <TouchableOpacity onPress={() => { Haptics.selectionAsync(); onToggle(); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, backgroundColor: isOpen ? openBg : T.bg }}>
        <View style={{ width: 3, height: 36, borderRadius: 2, backgroundColor: isOpen ? T.accent : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)') }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: isOpen ? T.accent : T.text, lineHeight: 20 }}>{us.titel}</Text>
          <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{us.dhikr_poster.length} dhikr</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {hasFav && (
            <Svg width={11} height={11} viewBox="0 0 24 24" fill="#f5a623">
              <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </Svg>
          )}
          {hasAudio && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: T.accent }} />}
          <Animated.View style={{ transform: [{ rotate: chevRotate }] }}>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none"
              stroke={isOpen ? T.accent : T.textMuted} strokeWidth={2.2} strokeLinecap="round">
              <Path d="M9 18l6-6-6-6" />
            </Svg>
          </Animated.View>
        </View>
      </TouchableOpacity>

      {/* Animated content */}
      <Animated.View style={{ maxHeight, overflow: 'hidden' }}>
        <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 16 }} />
          {us.dhikr_poster.map((d, i) => {
            const k = dhikrKey(d);
            const isFav = favorites.includes(k);
            return (
              <TouchableOpacity key={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectDhikr(d, us.dhikr_poster); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 31, paddingRight: 16, backgroundColor: rowBg, borderBottomWidth: 1, borderBottomColor: T.border }}>
                <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: badgeBg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: T.accent }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: T.text, lineHeight: 20 }}>{d.titel}</Text>
                  {!!d.arabisk_text && (
                    <ArabicText style={{ fontSize: 13, color: T.textMuted, marginTop: 3, textAlign: 'right' }} numberOfLines={1}>{d.arabisk_text}</ArabicText>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  {isFav && <Svg width={11} height={11} viewBox="0 0 24 24" fill="#f5a623"><Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Svg>}
                  {!!d.mp3_url && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: T.accent }} />}
                  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={2.2} strokeLinecap="round">
                    <Path d="M9 18l6-6-6-6" />
                  </Svg>
                </View>
              </TouchableOpacity>
            );
          })}
      </Animated.View>
    </View>
  );
}

// ─── Grid card ────────────────────────────────────────────────────────────────
function GridCard({ g, count, onPress, T, isDark }: { g: Grupp; count: number; onPress: () => void; T: any; isDark: boolean }) {
  const iconBg = T.accentGlow;
  return (
    <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={{ flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 18, alignItems: 'center', justifyContent: 'center', padding: 20, paddingTop: 22, gap: 12, marginBottom: 10 }}>
      <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
        <DhikrCategoryIcon id={g.id} color={T.accent} size={36} />
      </View>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: T.text, textAlign: 'center', lineHeight: 17 }}>{g.namn}</Text>
        <Text style={{ fontSize: 10, color: T.textMuted, marginTop: 3 }}>{count} dhikr</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── List row ─────────────────────────────────────────────────────────────────
function ListRow({ g, count, onPress, T, isDark }: { g: Grupp; count: number; onPress: () => void; T: any; isDark: boolean }) {
  const iconBg = T.accentGlow;
  return (
    <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 13, marginBottom: 8 }}>
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <DhikrCategoryIcon id={g.id} color={T.accent} size={24} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: T.text }}>{g.namn}</Text>
        <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{count} dhikr</Text>
      </View>
      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={2} strokeLinecap="round">
        <Path d="M9 18l6-6-6-6" />
      </Svg>
    </TouchableOpacity>
  );
}

// ─── Category detail view (slides over home) ──────────────────────────────────
function CatDetailView({ g, onClose, onSelectDhikr, favorites, T, isDark }: {
  g: Grupp; onClose: () => void;
  onSelectDhikr: (d: DhikrPost, siblings: DhikrPost[]) => void;
  favorites: string[]; T: any; isDark: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, shadowOpacity, goBack } = useSlideIn(onClose);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const count = groupCount(g);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 10, transform: [{ translateX }] }]}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, zIndex: 1, opacity: shadowOpacity, shadowColor: '#000', shadowOffset: { width: -8, height: 0 }, shadowOpacity: 1, shadowRadius: 16 }} />
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />

      {/* Header */}
      <View style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, paddingTop: 10 }}>
          <BackButton onPress={goBack} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 19, fontWeight: '800', color: T.text, letterSpacing: -0.3 }}>{g.namn}</Text>
            <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{count} dhikr</Text>
          </View>
          <DhikrCategoryIcon id={g.id} color={T.accent} size={28} />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
        {g.undersidor.map((us, ui) => (
          <AccordionSection
            key={ui} us={us} isOpen={openIdx === ui}
            onToggle={() => setOpenIdx(prev => prev === ui ? null : ui)}
            onSelectDhikr={onSelectDhikr}
            favorites={favorites} T={T} isDark={isDark}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

// ─── Dhikr detail view (slides over cat) ─────────────────────────────────────
function DhikrDetailView({ selDhikr, setSelDhikr, siblings, onClose, favorites, onToggleFav, T, isDark }: {
  selDhikr: DhikrPost; setSelDhikr: (d: DhikrPost) => void; siblings: DhikrPost[];
  onClose: () => void; favorites: string[];
  onToggleFav: (k: string) => void;
  T: any; isDark: boolean;
}) {
  const insets  = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { translateX, edgePan, shadowOpacity, goBack } = useSlideIn(onClose);
  const currIdx = siblings.findIndex(d => d === selDhikr || (d.titel === selDhikr.titel && d._undersida === selDhikr._undersida));
  const hasPrev = siblings.length > 1 && currIdx > 0;
  const hasNext = siblings.length > 1 && currIdx < siblings.length - 1;

  const navigate = (delta: number) => {
    const next = siblings[currIdx + delta];
    if (next) { Haptics.selectionAsync(); setSelDhikr(next); scrollRef.current?.scrollTo({ y: 0, animated: false }); }
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 20, transform: [{ translateX }] }]}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, zIndex: 1, opacity: shadowOpacity, shadowColor: '#000', shadowOffset: { width: -8, height: 0 }, shadowOpacity: 1, shadowRadius: 16 }} />
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />

      {/* Header */}
      <View style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, paddingTop: 10 }}>
          <BackButton onPress={goBack} />
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: T.text }} numberOfLines={1}>
            {selDhikr._kategori}
          </Text>
        </View>
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 120 }}>
        {/* Prev / Next */}
        {siblings.length > 1 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <TouchableOpacity onPress={() => navigate(-1)} disabled={!hasPrev}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: hasPrev ? 1 : 0 }}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M15 18l-6-6 6-6" />
              </Svg>
              <Text style={{ fontSize: 13, fontWeight: '600', color: T.accent }}>Föregående</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: T.textMuted }}>{currIdx + 1} / {siblings.length}</Text>
            <TouchableOpacity onPress={() => navigate(1)} disabled={!hasNext}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: hasNext ? 1 : 0 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: T.accent }}>Nästa</Text>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M9 18l6-6-6-6" />
              </Svg>
            </TouchableOpacity>
          </View>
        )}

        <DhikrCard key={dhikrKey(selDhikr)} d={selDhikr} T={T} isDark={isDark} favorites={favorites} onToggleFav={onToggleFav} />
      </ScrollView>
    </Animated.View>
  );
}

// ─── Search view ──────────────────────────────────────────────────────────────
function SearchView({ query, onSelectDhikr, onSelectGrupp, T, isDark }: {
  query: string; onSelectDhikr: (d: DhikrPost, s: DhikrPost[]) => void;
  onSelectGrupp: (g: Grupp) => void; T: any; isDark: boolean;
}) {
  const q = query.trim();
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const qn = norm(q);
  const grupper = useMemo(() => !qn ? [] : GRUPPER.filter(g => norm(g.namn).includes(qn)), [qn]);
  // Use enriched weighted search for dhikr results
  const dhikrs = useMemo(() => !qn || qn.length < 2 ? [] : searchDhikr(q, 60).map(r => r.dhikr), [q, qn]);

  if (!q) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 }}>
      <Svg width={56} height={56} viewBox="0 0 24 24" fill="none" stroke={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'} strokeWidth={1.5} strokeLinecap="round">
        <Path d="M21 21l-4.35-4.35" /><Path d="M11 19A8 8 0 1 0 11 3a8 8 0 0 0 0 16z" />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: T.text, marginBottom: 6 }}>Sök i Dhikr & Du'a</Text>
        <Text style={{ fontSize: 13, color: T.textMuted, textAlign: 'center' }}>Skriv ett ord för att söka bland kategorier, titlar och texter</Text>
      </View>
    </View>
  );

  if (grupper.length === 0 && dhikrs.length === 0) return (
    <View style={{ padding: 48, alignItems: 'center' }}>
      <Text style={{ fontSize: 14, color: T.textMuted }}>Inga träffar för "{query}"</Text>
    </View>
  );

  const iconBg = T.accentGlow;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
      {grupper.length > 0 && (
        <>
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>Kategorier</Text>
          </View>
          {grupper.map(g => (
            <TouchableOpacity key={g.id} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectGrupp(g); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
                <DhikrCategoryIcon id={g.id} color={T.accent} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: T.text }}>{g.namn}</Text>
                <Text style={{ fontSize: 11, color: T.textMuted }}>{groupCount(g)} dhikr</Text>
              </View>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={2.2} strokeLinecap="round">
                <Path d="M9 18l6-6-6-6" />
              </Svg>
            </TouchableOpacity>
          ))}
        </>
      )}
      {dhikrs.length > 0 && (
        <>
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
              Dhikr ({dhikrs.length}{dhikrs.length === 60 ? '+' : ''})
            </Text>
          </View>
          {dhikrs.map((d, i) => (
            <TouchableOpacity key={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectDhikr(d, []); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: T.text, lineHeight: 20 }}>{d.titel}</Text>
                <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{d._kategori} · {d._undersida}</Text>
              </View>
              {!!d.mp3_url && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent }} />}
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={2.2} strokeLinecap="round">
                <Path d="M9 18l6-6-6-6" />
              </Svg>
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ─── Saved (favorites grouped by category) view ───────────────────────────────
function SavedView({ favorites, onSelectDhikr, onClearFav, T }: {
  favorites: string[];
  onSelectDhikr: (d: DhikrPost, s: DhikrPost[]) => void;
  onClearFav: () => void; T: any;
}) {
  const favDhikr = ALL_DHIKR.filter(d => favorites.includes(dhikrKey(d)));

  // Group favorites by _kategori, preserving order of first appearance
  const grouped = useMemo(() => {
    const map = new Map<string, DhikrPost[]>();
    favDhikr.forEach(d => {
      const cat = d._kategori || 'Övrigt';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(d);
    });
    return Array.from(map.entries());
  }, [favorites]);

  if (favDhikr.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
        <Svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </Svg>
        <Text style={{ fontSize: 14, color: T.textMuted, textAlign: 'center' }}>Inga favoriter ännu — tryck ⭐ på en dhikr</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
      {/* Header with clear button */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
          Favoriter ({favDhikr.length})
        </Text>
        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onClearFav(); }}>
          <Text style={{ fontSize: 11, color: T.textMuted }}>Rensa alla</Text>
        </TouchableOpacity>
      </View>

      {grouped.map(([kategori, items]) => (
        <View key={kategori} style={{ marginBottom: 8 }}>
          {/* Category header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="#f5a623">
              <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </Svg>
            <Text style={{ fontSize: 11, fontWeight: '700', color: T.accent, textTransform: 'uppercase', letterSpacing: 0.8 }}>{kategori}</Text>
          </View>
          {/* Items under this category */}
          {items.map((d, i) => (
            <TouchableOpacity key={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectDhikr(d, []); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: T.text, lineHeight: 20 }}>{d.titel}</Text>
                <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{d._undersida}</Text>
              </View>
              {!!d.mp3_url && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent }} />}
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={2.2} strokeLinecap="round">
                <Path d="M9 18l6-6-6-6" />
              </Svg>
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Tab bar icons ────────────────────────────────────────────────────────────
const TABS = [
  {
    id: 'grid', label: 'Rutnät',
    icon: (color: string) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
        <Rect x={3} y={3} width={7} height={7} /><Rect x={14} y={3} width={7} height={7} />
        <Rect x={3} y={14} width={7} height={7} /><Rect x={14} y={14} width={7} height={7} />
      </Svg>
    ),
  },
  {
    id: 'list', label: 'Lista',
    icon: (color: string) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
        <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </Svg>
    ),
  },
  {
    id: 'saved', label: 'Sparade',
    icon: (color: string) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </Svg>
    ),
  },
  {
    id: 'wellbeing', label: 'Välmående',
    icon: (color: string) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
      </Svg>
    ),
  },
  {
    id: 'search', label: 'Sök',
    icon: (color: string) => (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
        <Path d="M21 21l-4.35-4.35" /><Path d="M11 19A8 8 0 1 0 11 3a8 8 0 0 0 0 16z" />
      </Svg>
    ),
  },
];

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function DhikrScreen() {
  const { theme: T, isDark } = useTheme();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const searchRef = useRef<TextInput>(null);

  const [mainTab,  setMainTab]  = useState<'grid' | 'list' | 'saved' | 'wellbeing' | 'search'>('grid');
  const [selGrupp, setSelGrupp] = useState<Grupp | null>(null);
  const [selDhikr, setSelDhikr] = useState<DhikrPost | null>(null);
  const [siblings, setSiblings] = useState<DhikrPost[]>([]);
  const [searchQ,  setSearchQ]  = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);

  // ── Wellbeing hint bubble ──────────────────────────────────────────────────
  const HINT_KEY = 'dhikr_wellbeing_hint_v2';

  const [showHint,   setShowHint]   = useState(false);
  const [hintPos,    setHintPos]    = useState({ cx: Math.round(SCREEN_W * 0.72), top: 0 });
  const hintOpacity  = useRef(new Animated.Value(0)).current;
  const hintScale    = useRef(new Animated.Value(0.85)).current;
  const heartPulse   = useRef(new Animated.Value(1)).current;
  const wellbeingRef    = useRef<View>(null);
  const insetsRef       = useRef(insets);
  const hintTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseStopTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep insetsRef in sync so the async timer closure always reads the latest value.
  useEffect(() => { insetsRef.current = insets; }, [insets]);

  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

    AsyncStorage.getItem(HINT_KEY).then(lastShownDate => {
      // Skip if already shown today
      if (cancelled || lastShownDate === today) return;

      hintTimerRef.current = setTimeout(() => {
        if (cancelled) return;

        const startHint = (cx: number) => {
          if (cancelled) return;
          setHintPos({ cx, top: insetsRef.current.top + 8 });
          setShowHint(true);

          Animated.parallel([
            Animated.spring(hintOpacity, { toValue: 1, useNativeDriver: true, bounciness: 10 }),
            Animated.spring(hintScale,   { toValue: 1, useNativeDriver: true, bounciness: 10 }),
          ]).start();

          Animated.loop(
            Animated.sequence([
              Animated.timing(heartPulse, { toValue: 1.28, duration: 550, useNativeDriver: true }),
              Animated.timing(heartPulse, { toValue: 1.00, duration: 550, useNativeDriver: true }),
            ]),
          ).start();

          // Heart returns to normal after 10 s
          pulseStopTimer.current = setTimeout(() => {
            if (cancelled) return;
            heartPulse.stopAnimation();
            Animated.timing(heartPulse, { toValue: 1, duration: 300, useNativeDriver: true }).start();
          }, 10000);

          // Auto-dismiss bubble after 15 s; record today's date
          autoDismissTimer.current = setTimeout(() => {
            if (cancelled) return;
            Animated.parallel([
              Animated.timing(hintOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
              Animated.timing(hintScale,   { toValue: 0.85, duration: 300, useNativeDriver: true }),
            ]).start(() => { if (!cancelled) setShowHint(false); });
            AsyncStorage.setItem(HINT_KEY, today).catch(() => undefined);
          }, 15000);
        };

        // Try to measure heart tab position; fall back to ~72 % of screen width.
        if (wellbeingRef.current) {
          wellbeingRef.current.measureInWindow((x, y, w) => {
            const cx = w > 0 ? Math.round(x + w / 2) : Math.round(SCREEN_W * 0.72);
            startHint(cx);
          });
        } else {
          startHint(Math.round(SCREEN_W * 0.72));
        }
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (hintTimerRef.current)     clearTimeout(hintTimerRef.current);
      if (pulseStopTimer.current)   clearTimeout(pulseStopTimer.current);
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
      hintOpacity.stopAnimation();
      hintScale.stopAnimation();
      heartPulse.stopAnimation();
    };
  }, []);

  const dismissHint = useCallback(() => {
    if (pulseStopTimer.current)   clearTimeout(pulseStopTimer.current);
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    Animated.parallel([
      Animated.timing(hintOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(hintScale,   { toValue: 0.85, duration: 180, useNativeDriver: true }),
    ]).start(() => setShowHint(false));
    heartPulse.stopAnimation();
    heartPulse.setValue(1);
    // Record today so the hint doesn't reappear until tomorrow
    AsyncStorage.setItem(HINT_KEY, new Date().toISOString().slice(0, 10)).catch(() => undefined);
  }, [hintOpacity, hintScale, heartPulse]);

  // Load favorites on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_FAV).then(raw => {
      try { setFavorites(JSON.parse(raw || '[]')); } catch {}
    });
  }, []);

  const saveFavs = (val: string[]) => AsyncStorage.setItem(STORAGE_FAV, JSON.stringify(val));

  const toggleFav = useCallback((key: string) => {
    setFavorites(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      saveFavs(next); return next;
    });
  }, []);

  const goToCat   = (g: Grupp)   => { setSelGrupp(g); };
  const goToDhikr = (d: DhikrPost, sibs: DhikrPost[]) => { setSelDhikr(d); setSiblings(sibs); };
  const closeDhikr = () => { setSelDhikr(null); setSiblings([]); };
  const closeCat   = () => { setSelGrupp(null); };

  const switchTab = (id: typeof mainTab) => { setMainTab(id); };
  const hasBadge  = favorites.length > 0;
  const activePillBg = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';

  // Disable the Stack navigator's native edge swipe when a sub-view is open.
  // Without this, iOS's gesture recognizer competes with the internal PanResponder
  // and can navigate back to the "Visa mer" screen instead of closing the sub-view.
  const hasSubView = !!selGrupp || !!selDhikr;

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <Stack.Screen options={{ gestureEnabled: !hasSubView, fullScreenGestureEnabled: false }} />
      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 }}>
          <BackButton onPress={() => router.back()} />
          <View>
            <Text style={{ fontSize: 19, fontWeight: '800', color: T.text, letterSpacing: -0.3 }}>Dhikr & Du'a</Text>
            <Text style={{ fontSize: 11, fontWeight: '500', color: T.textMuted, letterSpacing: 0.1, marginTop: 1 }}>Hisnul Muslim – Muslimens Fästning</Text>
          </View>
        </View>

        {/* Tab pills */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingBottom: 10 }}>
          {TABS.map(t => {
            const active = mainTab === t.id;
            const showBadge = t.id === 'saved' && hasBadge;
            const isWellbeing = t.id === 'wellbeing';
            const showRedHeart = isWellbeing && showHint && mainTab !== 'wellbeing';
            return (
              <View key={t.id} ref={isWellbeing ? wellbeingRef : undefined} collapsable={false}>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.selectionAsync();
                    if (isWellbeing && showHint) dismissHint();
                    switchTab(t.id as any);
                  }}
                  style={{ position: 'relative', width: 42, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? activePillBg : 'transparent' }}>
                  {showRedHeart ? (
                    <Animated.View style={{ transform: [{ scale: heartPulse }] }}>
                      <Svg width={18} height={18} viewBox="0 0 24 24" fill="#FF3B30" stroke="#FF3B30" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
                      </Svg>
                    </Animated.View>
                  ) : (
                    t.icon(active ? T.accent : T.textMuted)
                  )}
                  {showBadge && (
                    <View style={{ position: 'absolute', top: 4, right: 5, width: 7, height: 7, borderRadius: 4, backgroundColor: T.accent, borderWidth: 1.5, borderColor: T.bg }} />
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* Search bar */}
        {mainTab === 'search' && (
          <View style={{ marginHorizontal: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderColor: T.border }}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={2.2} strokeLinecap="round">
              <Path d="M21 21l-4.35-4.35" /><Path d="M11 19A8 8 0 1 0 11 3a8 8 0 0 0 0 16z" />
            </Svg>
            <TextInput
              ref={searchRef} value={searchQ} onChangeText={setSearchQ} autoFocus
              placeholder="Sök kategori, dhikr eller text…" placeholderTextColor={T.textMuted}
              style={{ flex: 1, color: T.text, fontSize: 16, padding: 0 }}
            />
            {!!searchQ && (
              <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setSearchQ(''); }}>
                <Text style={{ color: T.textMuted, fontSize: 18, lineHeight: 20 }}>×</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* ── Body ── */}
      {mainTab === 'grid' && (
        <FlatList
          data={GRUPPER}
          numColumns={2}
          keyExtractor={g => g.id}
          columnWrapperStyle={{ gap: 10, paddingHorizontal: 10 }}
          contentContainerStyle={{ padding: 10, paddingBottom: 120 }}
          renderItem={({ item: g }) => (
            <GridCard g={g} count={groupCount(g)} onPress={() => goToCat(g)} T={T} isDark={isDark} />
          )}
        />
      )}
      {mainTab === 'list' && (
        <FlatList
          data={GRUPPER}
          keyExtractor={g => g.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 120 }}
          renderItem={({ item: g }) => (
            <ListRow g={g} count={groupCount(g)} onPress={() => goToCat(g)} T={T} isDark={isDark} />
          )}
        />
      )}
      {mainTab === 'saved' && (
        <SavedView
          favorites={favorites}
          onSelectDhikr={goToDhikr}
          onClearFav={() => { setFavorites([]); saveFavs([]); }}
          T={T}
        />
      )}
      {mainTab === 'wellbeing' && (
        <DhikrWellbeingView onSelectDhikr={goToDhikr} />
      )}
      {mainTab === 'search' && (
        <SearchView query={searchQ} onSelectDhikr={goToDhikr} onSelectGrupp={goToCat} T={T} isDark={isDark} />
      )}


      {/* ── Category detail (absoluteFill, slides over home) ── */}
      {selGrupp && (
        <CatDetailView
          g={selGrupp} onClose={closeCat} onSelectDhikr={goToDhikr}
          favorites={favorites} T={T} isDark={isDark}
        />
      )}

      {/* ── Dhikr detail (absoluteFill, slides over cat) ── */}
      {selDhikr && (
        <DhikrDetailView
          selDhikr={selDhikr} setSelDhikr={setSelDhikr}
          siblings={siblings} onClose={closeDhikr}
          favorites={favorites}
          onToggleFav={toggleFav}
          T={T} isDark={isDark}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({});
