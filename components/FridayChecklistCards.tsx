import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Animated, Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { useApp } from '../context/AppContext';
import { useRouter } from 'expo-router';
import SvgIcon from './SvgIcon';

let _stopFridayAudio: (() => void) | null = null;

const SALAH_AUDIO_URL =
  'https://fra1.digitaloceanspaces.com/islamnu/dhikr/remembrance/audio/98.mp3';

const GOLD = '#c9a84c';

// ── Audio play button ──────────────────────────────────────────────────────────

function FridayAudioButton() {
  const { theme: T, isDark } = useTheme();
  const mountedRef = useRef(true);
  const playerRef  = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  const stopSelf = useCallback(() => {
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch {}
      try { playerRef.current.remove(); } catch {}
      playerRef.current = null;
    }
    if (mountedRef.current) { setPlaying(false); setLoading(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (_stopFridayAudio === stopSelf) _stopFridayAudio = null;
      if (playerRef.current) {
        try { playerRef.current.pause(); } catch {}
        try { playerRef.current.remove(); } catch {}
        playerRef.current = null;
      }
    };
  }, [stopSelf]);

  const toggle = useCallback(async () => {
    if (loading) return;
    let audio: any;
    try { audio = require('expo-audio'); } catch { return; }

    if (playerRef.current) {
      if (playerRef.current.playing) {
        playerRef.current.pause();
        setPlaying(false);
        if (_stopFridayAudio === stopSelf) _stopFridayAudio = null;
        return;
      }
      if (_stopFridayAudio && _stopFridayAudio !== stopSelf) {
        _stopFridayAudio(); _stopFridayAudio = null;
      }
      playerRef.current.play();
      setPlaying(true);
      _stopFridayAudio = stopSelf;
      return;
    }

    if (_stopFridayAudio) { _stopFridayAudio(); _stopFridayAudio = null; }
    setLoading(true);
    try {
      const player = audio.createAudioPlayer({ uri: SALAH_AUDIO_URL });
      playerRef.current = player;
      _stopFridayAudio = stopSelf;
      player.play();
      if (mountedRef.current) setPlaying(true);
      player.addListener('playbackStatusUpdate', (s: any) => {
        if (s.didJustFinish) {
          try { playerRef.current?.remove(); } catch {}
          playerRef.current = null;
          if (_stopFridayAudio === stopSelf) _stopFridayAudio = null;
          if (mountedRef.current) setPlaying(false);
        }
      });
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [loading, stopSelf]);

  const btnBg     = isDark ? 'rgba(102,132,104,0.18)' : 'rgba(36,100,93,0.13)';
  const btnBorder = isDark ? 'rgba(102,132,104,0.28)' : 'rgba(36,100,93,0.24)';

  return (
    <TouchableOpacity
      onPress={toggle}
      activeOpacity={0.65}
      style={{
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: btnBg,
        borderWidth: 0.75,
        borderColor: btnBorder,
        alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {loading ? (
        <View style={{
          width: 8, height: 8, borderRadius: 4,
          borderWidth: 1.5, borderColor: T.accent, opacity: 0.7,
        }} />
      ) : playing ? (
        <Svg width={11} height={11} viewBox="0 0 24 24" fill={T.accent}>
          <Path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </Svg>
      ) : (
        <Svg width={11} height={11} viewBox="0 0 24 24" fill={T.accent}>
          <Path d="M8 5v14l11-7z" />
        </Svg>
      )}
    </TouchableOpacity>
  );
}

// ── Card 1: Salah over the Prophet ────────────────────────────────────────────

function SalahCard({
  T, isDark, onPress,
}: { T: any; isDark: boolean; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 0.975, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  const bodyColor  = isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.82)';
  const cardBg     = isDark ? T.card : '#F8F7F5';
  const cardBorder = isDark ? T.border : 'rgba(0,0,0,0.08)';

  return (
    <Animated.View style={{
      transform: [{ scale: scaleAnim }],
      backgroundColor: cardBg,
      borderRadius: 14,
      borderWidth: 0.5,
      borderColor: cardBorder,
      marginBottom: 8,
      shadowColor: isDark ? '#000' : '#8A8A8A',
      shadowOffset: { width: 0, height: isDark ? 2 : 1 },
      shadowOpacity: isDark ? 0.06 : 0.10,
      shadowRadius: isDark ? 6 : 8,
      elevation: 2,
    }}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={{ padding: 14 }}
      >
        {/* Outer row: content left, play button right — vertically centered */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {/* Content column */}
          <View style={{ flex: 1 }}>
            {/* Icon + title on the same row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: isDark ? 'rgba(102,132,104,0.14)' : 'rgba(36,100,93,0.09)',
                alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Text style={{ fontSize: 15, color: isDark ? '#fff' : T.text, fontWeight: '700', lineHeight: 20 }}>
                  ﷺ
                </Text>
              </View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                style={{ flex: 1, fontSize: 13, fontWeight: '700', color: T.text, lineHeight: 18 }}
              >
                {`Sänd mycket salah över Profeten ﷺ idag`}
              </Text>
            </View>

            {/* Inline text block */}
            <View style={{ gap: 3 }}>
              <Text style={{ fontSize: 12, color: bodyColor, lineHeight: 17 }}>
                Det är extra rekommenderat på fredagar.
              </Text>
              <Text style={{ fontSize: 12, color: bodyColor, fontStyle: 'italic', lineHeight: 17 }}>
                Allāhumma ṣalli wa sallim ʿalā nabiyyinā Muḥammad
              </Text>
              <Text style={{ fontSize: 11, color: bodyColor, lineHeight: 16 }}>
                Översättning: “Må Allâh hylla och sända välsignelser över Muhammad”
              </Text>
            </View>
          </View>

          {/* Play button — right edge, centered vertically to whole card */}
          <FridayAudioButton />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Card 2: Surah Al-Kahf ─────────────────────────────────────────────────────

function AlKahfCard({
  T, isDark, onPress,
}: { T: any; isDark: boolean; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 0.975, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  const cardBg     = isDark ? T.card : '#F8F7F5';
  const cardBorder = isDark ? T.border : 'rgba(0,0,0,0.08)';

  return (
    <Animated.View style={{
      transform: [{ scale: scaleAnim }],
      backgroundColor: cardBg,
      borderRadius: 14,
      borderWidth: 0.5,
      borderColor: cardBorder,
      marginBottom: 8,
      shadowColor: isDark ? '#000' : '#8A8A8A',
      shadowOffset: { width: 0, height: isDark ? 2 : 1 },
      shadowOpacity: isDark ? 0.06 : 0.10,
      shadowRadius: isDark ? 6 : 8,
      elevation: 2,
    }}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={{ padding: 14 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {/* Quran icon — same as tab bar */}
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: isDark ? 'rgba(201,168,76,0.11)' : 'rgba(201,168,76,0.10)',
            alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <SvgIcon name="quran" size={20} color={GOLD} />
          </View>

          <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '700', color: T.text, lineHeight: 18 }}>
            Har du läst Surah Al-Kahf idag?
          </Text>

          {/* Subtle chevron — signals tappability */}
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M9 18l6-6-6-6"
              stroke={T.textMuted}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>

        <View style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 12, color: T.textMuted, lineHeight: 17 }}>
            Det är starkt rekommenderat att läsa Surah Al-Kahf på fredagar.
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Card 3: Dhul-Hijjah offerslakt reminder ───────────────────────────────────

const DHUL_HIJJAH_SHARE_TEXT =
  'För dig som ska göra offerslakten\n\n' +
  'Profeten \u{FDFA} sade:\n\n' +
  '"När de tio (dagarna i Dhul-Hijjah) börjar, och någon av er har för avsikt att offra (udhiyah), ' +
  'då ska han inte ta från sitt hår, sina naglar eller något från sin hud förrän han har offrat."\n\n' +
  '[Muslim]\n\n' +
  'Förbuden gäller från och med solnedgången kvällen innan första Dhul-Hijjah-dagen till dess att slakten är utförd.\n\n' +
  'Du bör:\n' +
  '❌ Inte klippa naglar\n' +
  '❌ Inte raka eller klippa hår på kroppen eller huvudet\n' +
  '❌ Inte ta bort hud (t.ex. genom rakning eller skalning)\n\n' +
  'Detta gäller bara den i familjen som offerslaktar (eller betalar för att någon annan gör det).';

function DhulHijjahReminderCard({ T, isDark }: { T: any; isDark: boolean }) {
  const handleShare = useCallback(async () => {
    try {
      await Share.share({ message: DHUL_HIJJAH_SHARE_TEXT });
    } catch {
      // Share cancelled or unavailable — silent
    }
  }, []);

  const cardBg     = isDark ? T.card : '#F8F7F5';
  const cardBorder = isDark ? T.border : 'rgba(0,0,0,0.08)';
  const bodyColor  = isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.82)';
  const mutedColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';

  return (
    <View style={{
      backgroundColor: cardBg,
      borderRadius: 14,
      borderWidth: 0.5,
      borderColor: cardBorder,
      marginBottom: 8,
      shadowColor: isDark ? '#000' : '#8A8A8A',
      shadowOffset: { width: 0, height: isDark ? 2 : 1 },
      shadowOpacity: isDark ? 0.06 : 0.10,
      shadowRadius: isDark ? 6 : 8,
      elevation: 2,
      padding: 14,
    }}>
      {/* Header: title + share button */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: T.text, lineHeight: 18 }}>
          För dig som ska göra offerslakten
        </Text>
        <TouchableOpacity
          onPress={handleShare}
          activeOpacity={0.65}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ marginLeft: 10, marginTop: 1 }}
        >
          <SvgIcon name="share" size={16} color={T.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Inline intro */}
      <Text style={{ fontSize: 12, color: bodyColor, lineHeight: 17, marginBottom: 5 }}>
        Profeten ﷺ sade:
      </Text>

      {/* Italic hadith quote */}
      <Text style={{ fontSize: 12, color: bodyColor, fontStyle: 'italic', lineHeight: 18, marginBottom: 5 }}>
        {'"När de tio (dagarna i Dhul-Hijjah) börjar, och någon av er har för avsikt att offra (udhiyah), ' +
         'då ska han inte ta från sitt hår, sina naglar eller något från sin hud förrän han har offrat."'}
      </Text>

      {/* Source */}
      <Text style={{ fontSize: 11, color: mutedColor, lineHeight: 15, marginBottom: 9 }}>
        [Muslim]
      </Text>

      {/* Clarification */}
      <Text style={{ fontSize: 12, color: bodyColor, lineHeight: 17, marginBottom: 11 }}>
        Förbuden gäller från och med solnedgången kvällen innan första Dhul-Hijjah-dagen till dess att slakten är utförd.
      </Text>

      <View style={{ height: 0.5, backgroundColor: dividerColor, marginBottom: 9 }} />

      {/* Section label */}
      <Text style={{
        fontSize: 10, fontWeight: '700', color: T.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
      }}>
        Du bör:
      </Text>

      {/* Prohibition list */}
      <Text style={{ fontSize: 12, color: bodyColor, lineHeight: 20 }}>
        {'❌ Inte klippa naglar\n❌ Inte raka eller klippa hår på kroppen eller huvudet\n❌ Inte ta bort hud (t.ex. genom rakning eller skalning)'}
      </Text>

      <View style={{ height: 0.5, backgroundColor: dividerColor, marginTop: 10, marginBottom: 9 }} />

      {/* Closing note */}
      <Text style={{ fontSize: 11, color: mutedColor, lineHeight: 16, fontStyle: 'italic' }}>
        Detta gäller bara den i familjen som offerslaktar (eller betalar för att någon annan gör det).
      </Text>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Props = { fajr: Date | null; maghrib: Date | null; now: Date; testMode?: boolean; testDayTen?: boolean };

export default function FridayChecklistCards({ fajr, maghrib, now, testMode = false, testDayTen = false }: Props) {
  const { theme: T, isDark } = useTheme();
  const { hijriDate } = useApp();
  const router = useRouter();

  const dhulHijjahDay = useMemo(() => {
    if (testDayTen) return 10;
    if (testMode) return 2;
    if (!hijriDate || hijriDate.month?.number !== 12) return 0;
    const d = parseInt(String(hijriDate.day), 10);
    return isNaN(d) ? 0 : d;
  }, [hijriDate, testMode, testDayTen]);

  const isFriday = now.getDay() === 5;
  const inFridayWindow =
    isFriday && fajr !== null && maghrib !== null && now >= fajr && now < maghrib;
  const isDhulHijjah = dhulHijjahDay >= 1 && dhulHijjahDay <= 10;

  if (!inFridayWindow && !isDhulHijjah) return null;

  return (
    <View style={{ marginTop: 8, marginBottom: 4 }}>
      <Text style={{
        fontSize: 12, fontWeight: '600', color: T.textMuted,
        letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 11,
      }}>
        Dagens Påminnelse
      </Text>

      {inFridayWindow ? (
        <>
          <SalahCard
            T={T} isDark={isDark}
            onPress={() => router.push(
              '/dhikr?dhikrId=morgon-och-kvall-aminnelser-under-morgon-och-kvall-allah-upphoj-och-bevara-var-profet-muhammed' as any,
            )}
          />
          {isDhulHijjah ? (
            <DhulHijjahReminderCard T={T} isDark={isDark} />
          ) : (
            <AlKahfCard
              T={T} isDark={isDark}
              onPress={() => router.push('/quran?page=293' as any)}
            />
          )}
        </>
      ) : (
        <DhulHijjahReminderCard T={T} isDark={isDark} />
      )}
    </View>
  );
}
