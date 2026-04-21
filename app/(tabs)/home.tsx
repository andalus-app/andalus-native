import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Linking, Image, useWindowDimensions, Animated, PanResponder, Modal, StyleSheet, AppState, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path } from 'react-native-svg';
import HidayahLogo from '../../components/HidayahLogo';
import DagensKoranversCard from '../../components/DagensKoranversCard';
import NextPrayerCard from '../../components/NextPrayerCard';
import DagensHadithCard from '../../components/DagensHadithCard';
import SvgIcon from '../../components/SvgIcon';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ThemeToggle from '../../components/ThemeToggle';
import { useTheme } from '../../context/ThemeContext';
import { useYoutubeLive } from '../../hooks/useYoutubeLive';
import { useYoutubePlayer } from '../../context/YoutubePlayerContext';
import { useBanners, Banner } from '../../context/BannerContext';
import { useBookingNotif, BookingNotif, PendingBooking } from '../../context/BookingNotifContext';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Storage } from '../../services/storage';
import { fetchActiveAnnouncements, Announcement } from '../../services/announcementsApi';
import AdminPinModal, { EligibleAdminUser } from '../../components/AdminPinModal';
// Push notifications for announcements are sent exclusively by the Supabase Edge
// Function (announcement-notification). The app must NOT schedule a local
// notification — doing so produces a duplicate every time.


const SWIPE_THRESHOLD = 80;


function BannerCard({ banner, onDismiss, theme: T }: { banner: Banner; onDismiss: () => void; theme: any }) {
  const { width } = useWindowDimensions();
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateX, { toValue: -width, duration: 260, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 0,      duration: 220, useNativeDriver: true }),
    ]).start(() => onDismiss());
  }, [width, onDismiss]);

  const snapBack = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) translateX.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -SWIPE_THRESHOLD || g.vx < -0.6) {
          Animated.parallel([
            Animated.timing(translateX, { toValue: -width, duration: 220, useNativeDriver: true }),
            Animated.timing(opacity,    { toValue: 0,      duration: 180, useNativeDriver: true }),
          ]).start(() => onDismiss());
        } else {
          snapBack();
        }
      },
      onPanResponderTerminate: () => snapBack(),
    })
  ).current;

  return (
    <Animated.View
      style={{ transform: [{ translateX }], opacity, marginBottom: 10 }}
      {...panResponder.panHandlers}
    >
      <View style={{
        backgroundColor: T.card,
        borderRadius: 14,
        borderWidth: 0.5,
        borderColor: T.border,
        padding: 14,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{
            width: 28, height: 28, borderRadius: 14,
            backgroundColor: T.accent + '22',
            alignItems: 'center', justifyContent: 'center',
            marginTop: 1, flexShrink: 0,
          }}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill={T.accent}>
              <Path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </Svg>
          </View>

          <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: T.text }}>
            {banner.title}
          </Text>

          <TouchableOpacity
            onPress={dismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginTop: 2, flexShrink: 0 }}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill={T.textMuted}>
              <Path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </Svg>
          </TouchableOpacity>
        </View>

        {banner.linkUrl && banner.linkText && (
          <TouchableOpacity
            onPress={() => Linking.openURL(banner.linkUrl!)}
            activeOpacity={0.7}
            style={{ marginTop: 6, marginLeft: 38 }}
          >
            <Text style={{ fontSize: 14, color: T.accent, textDecorationLine: 'underline' }}>
              {banner.linkText}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

type YoutubeCardProps = {
  stream: import('../../hooks/useYoutubeLive').YTStream | null;
  isLive: boolean;
  isUpcoming: boolean;
};

function YoutubeCard({ stream, isLive, isUpcoming }: YoutubeCardProps) {
  const { theme: T } = useTheme();
  const { width } = useWindowDimensions();
  const { videoId: activeVideoId, isPlaying, play, stop, inlineFrame, setInlineFrame } = useYoutubePlayer();

  // Ref on the thumbnail container — used to measure its screen position for the
  // single background WebView to reposition itself at.
  const thumbRef = useRef<View>(null);

  // watchingVideo = the single background WebView is showing at this card's position.
  const isThisActive  = activeVideoId === stream?.videoId;
  const watchingVideo = isThisActive && inlineFrame !== null;

  // Open the single WebView in inline mode at this card's screen coordinates.
  // Both state updates (play + setInlineFrame) land in the same React render via
  // automatic batching, so the WebView mounts directly at the inline position.
  const openVideo = useCallback(() => {
    if (!stream) return;
    thumbRef.current?.measureInWindow((x, y, w, h) => {
      play(stream.videoId);
      setInlineFrame({ top: y, left: x, width: w, height: h });
    });
  }, [stream, play, setInlineFrame]);

  // When the user switches tabs: move the WebView off-screen (background audio mode).
  // Audio continues — the single WebView stays alive off-screen.
  useFocusEffect(useCallback(() => {
    return () => {
      if (isThisActive && inlineFrame !== null) {
        setInlineFrame(null);
      }
    };
  }, [isThisActive, inlineFrame, setInlineFrame]));

  // Pulsing animation — only runs when live
  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isLive) { pulseAnim.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => { loop.stop(); pulseAnim.setValue(0); };
  }, [isLive]);

  const ringScale   = useMemo(() => pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }), [pulseAnim]);
  const ringOpacity = useMemo(() => pulseAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.75, 0.2, 0] }), [pulseAnim]);
  const dotScale    = useMemo(() => pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.25, 1] }), [pulseAnim]);

  // No stream — render nothing
  if (!stream) return null;

  // Only show upcoming streams within 6 hours of scheduled start.
  // Streams further away are noise — the card appears when it's actually relevant.
  if (
    stream.status === 'upcoming' &&
    stream.scheduledStart &&
    new Date(stream.scheduledStart).getTime() > Date.now() + 6 * 60 * 60_000
  ) {
    return null;
  }

  // Hide upcoming streams whose scheduled time has passed by more than 90 minutes.
  if (
    stream.status === 'upcoming' &&
    stream.scheduledStart &&
    new Date(stream.scheduledStart).getTime() < Date.now() - 90 * 60_000
  ) {
    return null;
  }

  const cardWidth     = width - 32;
  const THUMB_HEIGHT  = 182;
  const isThisPlaying = isThisActive && isPlaying;
  const isThisPaused  = isThisActive && !isPlaying && !watchingVideo;

  let timeLabel: string | null = null;
  if (isUpcoming && stream.scheduledStart) {
    const d = new Date(stream.scheduledStart);
    timeLabel = d.toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <View style={{ marginBottom: 12, borderRadius: 16, overflow: 'hidden', borderWidth: 0.5, borderColor: T.border }}>
      {/* Thumbnail area — always shown. The single background WebView overlays this
          area at root level when in inline mode (inlineFrame set). The card itself
          just shows the thumbnail / background-playing indicator. */}
      <View ref={thumbRef} style={{ width: cardWidth, height: THUMB_HEIGHT, backgroundColor: '#000' }}>
        <TouchableOpacity
          onPress={() => { if (!watchingVideo) openVideo(); }}
          activeOpacity={0.85}
          style={{ width: cardWidth, height: THUMB_HEIGHT }}
        >
          {(stream.thumbnailLocal ?? stream.thumbnail) ? (
            <Image
              source={{ uri: stream.thumbnailLocal ?? stream.thumbnail! }}
              style={{ width: cardWidth, height: THUMB_HEIGHT }}
              resizeMode="cover"
            />
          ) : (
            <View style={{ width: cardWidth, height: THUMB_HEIGHT, backgroundColor: '#111' }} />
          )}

          {/* Slight dim when audio is playing in background */}
          {isThisPlaying && (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} />
          )}

          {/* LIVE badge */}
          {isLive && (
            <View style={{
              position: 'absolute', top: 10, left: 10,
              flexDirection: 'row', alignItems: 'center', gap: 7,
              backgroundColor: '#FF3B30', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5,
            }}>
              <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View style={{
                  position: 'absolute',
                  width: 10, height: 10, borderRadius: 5,
                  backgroundColor: '#fff',
                  transform: [{ scale: ringScale }],
                  opacity: ringOpacity,
                }} />
                <Animated.View style={{
                  width: 8, height: 8, borderRadius: 4,
                  backgroundColor: '#fff',
                  transform: [{ scale: dotScale }],
                }} />
              </View>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 }}>LIVE</Text>
            </View>
          )}

          {/* Upcoming badge */}
          {isUpcoming && (
            <View style={{
              position: 'absolute', top: 10, left: 10,
              backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
            }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                {timeLabel ? `Sänds ${timeLabel}` : 'Kommer snart'}
              </Text>
            </View>
          )}

          {/* Play button overlay */}
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: 'rgba(0,0,0,0.55)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="#fff">
                <Path d="M8 5v14l11-7z" />
              </Svg>
            </View>
          </View>

          {/* "Spelar i bakgrunden" indicator */}
          {isThisPlaying && (
            <View style={{
              position: 'absolute', bottom: 10, right: 10,
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6,
              paddingHorizontal: 8, paddingVertical: 4,
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#34C759' }} />
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>Spelar ljud</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Bottom info bar */}
      <View style={{ backgroundColor: T.card, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="#FF3B30">
          <Path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.04 0 12 0 12s0 3.96.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.96 24 12 24 12s0-3.96-.5-5.81zM9.75 15.5V8.5l6.5 3.5-6.5 3.5z" />
        </Svg>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: T.text }} numberOfLines={2}>
          {stream.title}
        </Text>
        {isThisPaused && (
          <TouchableOpacity onPress={() => play(stream.videoId)} activeOpacity={0.7}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: T.accent }}>Återuppta</Text>
          </TouchableOpacity>
        )}
        {isThisActive && !isThisPaused && !watchingVideo && (
          <TouchableOpacity onPress={stop} activeOpacity={0.7}>
            <Text style={{ fontSize: 11, fontWeight: '500', color: T.textMuted }}>Stoppa</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function statusColor(status: BookingNotif['status'], isDark: boolean) {
  switch (status) {
    case 'approved':      return isDark ? '#34C759' : '#1A8C3A';
    case 'rejected':      return '#FF3B30';
    case 'cancelled':     return '#FF9500';
    case 'edited':        return isDark ? '#64B5F6' : '#1565C0';
    case 'pending':       return '#FF9500';
    case 'edit_pending':  return isDark ? '#64B5F6' : '#1565C0';
    default:              return '#8E8E93';
  }
}
function statusLabel(status: BookingNotif['status']) {
  switch (status) {
    case 'approved':      return 'Godkänd';
    case 'rejected':      return 'Nekad';
    case 'cancelled':     return 'Avbokad';
    case 'edited':        return 'Ändrad';
    case 'pending':       return 'Ny bokning';
    case 'edit_pending':  return 'Ändrad';
    default:              return status;
  }
}
function fmtDate(iso: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}/${m}/${y}`;
}

function BookingBellPanel({
  visible, onClose, pendingCount, cancelledCount, pendingBookings, bookingNotifs, onDismissNotif, onDismissAll, onMarkAllSeen, onNavigateToBooking, isAdmin, isDark, T,
}: {
  visible: boolean; onClose: () => void;
  pendingCount: number; cancelledCount: number; pendingBookings: PendingBooking[]; bookingNotifs: BookingNotif[];
  onDismissNotif: (id: string, status: string) => void;
  onDismissAll: () => void;
  onMarkAllSeen: () => void;
  onNavigateToBooking: (view?: string, extra?: { bookingId?: string; filter?: string; date?: string }) => void;
  isAdmin: boolean; isDark: boolean; T: any;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(600)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const dragY     = useRef(new Animated.Value(0)).current;
  const sheetY    = useRef(Animated.add(slideAnim, dragY)).current;

  useEffect(() => {
    if (visible) {
      dragY.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 320, useNativeDriver: true }),
        Animated.timing(fadeAnim,  { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 600, duration: 260, useNativeDriver: true }),
      Animated.timing(fadeAnim,  { toValue: 0,   duration: 220, useNativeDriver: true }),
    ]).start(() => onClose());
  }, [onClose]);

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { dragY.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 110 || g.vy > 0.5) { dismiss(); }
      else { Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start(); }
    },
  })).current;

  const isEmpty = isAdmin
    ? (pendingCount === 0 && cancelledCount === 0)
    : bookingNotifs.length === 0;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }, { opacity: fadeAnim }]}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismiss} />
      </Animated.View>
      <Animated.View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        maxHeight: '78%',
        backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        overflow: 'hidden',
        transform: [{ translateY: sheetY }],
      }}>
        <BlurView
          intensity={isDark ? 50 : 70}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: isDark ? 'rgba(28,28,30,0.92)' : 'rgba(242,242,247,0.92)' }} />

        {/* Drag handle */}
        <View {...panResponder.panHandlers} style={{ paddingTop: 10, paddingBottom: 4, alignItems: 'center' }}>
          <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)' }} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 10 }}>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: T.text }}>Bokningsnotiser</Text>
          {/* Rensa — user only, clears individual notifs */}
          {!isAdmin && bookingNotifs.length > 0 && (
            <TouchableOpacity
              onPress={onDismissAll}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginRight: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: T.accentGlow }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: T.accent }}>Rensa</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill={T.textMuted}>
              <Path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </Svg>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 20 }}
          showsVerticalScrollIndicator={false}
        >
          {isEmpty ? (
            <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
              <Svg width={36} height={36} viewBox="0 0 24 24" fill={T.textMuted}>
                <Path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
              </Svg>
              <Text style={{ fontSize: 14, color: T.textMuted, textAlign: 'center' }}>
                Inga bokningsnotiser
              </Text>
            </View>
          ) : isAdmin ? (
            <>
              {pendingBookings.map(pb => (
                <TouchableOpacity
                  key={pb.id}
                  activeOpacity={0.75}
                  onPress={() => { dismiss(); onNavigateToBooking(undefined, { bookingId: pb.id, date: pb.startDate }); }}
                  style={{
                    backgroundColor: T.card, borderRadius: 14, borderWidth: 0.5,
                    borderColor: '#FF9500' + '66', padding: 14, marginBottom: 8,
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}
                >
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF9500', flexShrink: 0 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#FF9500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                      VÄNTAR PÅ GODKÄNNANDE
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: T.text }} numberOfLines={1}>
                      {pb.activity}
                    </Text>
                    {pb.timeSlot || pb.name ? (
                      <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 1 }}>
                        {pb.timeSlot}{pb.name ? ' · ' + pb.name : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill={T.textMuted}>
                    <Path d="M9 18l6-6-6-6" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>
              ))}
              {cancelledCount > 0 && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => { dismiss(); onNavigateToBooking('admin', { filter: 'cancelled' }); }}
                  style={{
                    backgroundColor: T.card, borderRadius: 14, borderWidth: 0.5,
                    borderColor: (isDark ? '#64B5F6' : '#1565C0') + '66', padding: 14, marginBottom: 8,
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}
                >
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: isDark ? '#64B5F6' : '#1565C0', flexShrink: 0 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#64B5F6' : '#1565C0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                      AVBOKNING
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: T.text }}>
                      {cancelledCount} {cancelledCount === 1 ? 'bokning har avbokats' : 'bokningar har avbokats'} av användare
                    </Text>
                  </View>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill={T.textMuted}>
                    <Path d="M9 18l6-6-6-6" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>
              )}
            </>
          ) : (
            bookingNotifs.map(notif => (
              <TouchableOpacity
                key={notif.id}
                activeOpacity={0.75}
                onPress={() => { dismiss(); onNavigateToBooking('my-bookings', { bookingId: notif.id }); }}
                style={{
                  backgroundColor: T.card,
                  borderRadius: 14, borderWidth: 0.5,
                  borderColor: notif.isNew ? (statusColor(notif.status, isDark) + '55') : T.border,
                  padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 12,
                }}>
                <View style={{
                  width: 10, height: 10, borderRadius: 5,
                  backgroundColor: statusColor(notif.status, isDark),
                  marginTop: 5, flexShrink: 0,
                }} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: T.text, flex: 1 }} numberOfLines={1}>
                      {notif.activity}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: statusColor(notif.status, isDark), marginLeft: 8 }}>
                      {statusLabel(notif.status)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 2 }}>
                    {fmtDate(notif.startDate)}{notif.timeSlot ? ' · ' + notif.timeSlot : ''}
                  </Text>
                  {notif.adminComment ? (
                    <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 3, fontStyle: 'italic' }} numberOfLines={2}>
                      {notif.adminComment}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation(); onDismissNotif(notif.id, notif.status); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginTop: 2, flexShrink: 0 }}
                >
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill={T.textMuted}>
                    <Path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </Svg>
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

export default function HomeScreen() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const { banners, dismissBanner, markAllRead, refresh } = useBanners();
  const { pendingCount, cancelledCount, pendingBookings, bookingNotifs, totalUnread: bookingUnread, isAdmin, isLoggedIn, dismissNotif, markAllSeen, refresh: refreshBookingNotif } = useBookingNotif();
  const { stream, isLive, isUpcoming, refresh: refreshYoutube } = useYoutubeLive();
  const readTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef        = useRef<ScrollView>(null);
  const youtubeCardYRef  = useRef<number>(0);

  // ── Admin triple-tap state ─────────────────────────────────────────────────
  // Tap count and debounce timer live in refs so they never trigger a re-render.
  const tapCountRef     = useRef(0);
  const tapTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adminPinVisible,   setAdminPinVisible]   = useState(false);
  const [adminEligibleUser, setAdminEligibleUser] = useState<EligibleAdminUser | null>(null);

  // ── Announcement state ────────────────────────────────────────────────────
  const [bannerAnnouncements, setBannerAnnouncements] = useState<Announcement[]>([]);
  // Queue of unseen popups — index 0 is the front/top card shown to the user.
  const [popupQueue,          setPopupQueue]          = useState<Announcement[]>([]);
  // ID of the announcement banner that should pulse (set when user taps push notification)
  const [pulsingId,           setPulsingId]           = useState<string | null>(null);

  // ── Preferred name (greeting) ─────────────────────────────────────────────
  const [preferredName,    setPreferredName]    = useState<string | null>(null);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameInput,        setNameInput]        = useState('');

  const handleSaveName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    await AsyncStorage.setItem('andalus_preferred_name', trimmed);
    setPreferredName(trimmed);
    setNameModalVisible(false);
  }, [nameInput]);

  const openNameModal = useCallback(() => {
    setNameInput(preferredName ?? '');
    setNameModalVisible(true);
  }, [preferredName]);

  // On focus: immediately refresh booking notifs (status updates need to be instant).
  // Banner refresh is NOT triggered on every focus — that was causing a storm of
  // network requests during rapid tab-switching, hitting different CDN edge servers
  // that returned stale (empty) data and flickering the banners away.
  // Instead, a 30 s interval polls banners while on this screen.
  // The initial load and app-foreground cases are handled in BannerContext itself.
  useFocusEffect(useCallback(() => {
    refreshBookingNotif();
    // Reload name on every focus so edits made in Settings are reflected instantly.
    AsyncStorage.getItem('andalus_preferred_name').then(n => setPreferredName(n || null));
    // If the user tapped a YouTube LIVE notification, scroll to the YouTube card.
    AsyncStorage.getItem('islamnu_live_notif_tap').then(tap => {
      if (!tap) return;
      AsyncStorage.removeItem('islamnu_live_notif_tap').catch(() => {});
      // Delay lets the layout settle before scrolling.
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: youtubeCardYRef.current - 16, animated: true });
      }, 350);
    });
    const interval = setInterval(refresh, 30 * 1000);
    return () => clearInterval(interval);
  }, [refresh, refreshBookingNotif]));

  // Mark all visible banners as read after 3 s on this screen
  useEffect(() => {
    if (banners.length === 0) return;
    readTimerRef.current = setTimeout(() => {
      markAllRead(banners.map(b => b.id));
    }, 3000);
    return () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
    };
  }, [banners.map(b => b.id).join(',')]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // force=true bypasses the 30 s rate limit — the user explicitly asked to refresh.
    // refreshYoutube triggers an immediate YouTube fetch (clears pending poll timer).
    refreshYoutube();
    Promise.all([refresh(true), refreshBookingNotif()]).finally(() => setRefreshing(false));
  }, [refresh, refreshBookingNotif, refreshYoutube]);

  const openBell = useCallback(() => {
    setBellOpen(true);
  }, []);

  const closeBell = useCallback(() => {
    setBellOpen(false);
    markAllSeen();
    refreshBookingNotif();
  }, [markAllSeen, refreshBookingNotif]);

  const dismissAllNotifs = useCallback(async () => {
    await Promise.all(bookingNotifs.map(n => dismissNotif(n.id, n.status)));
  }, [bookingNotifs, dismissNotif]);

  // ── Triple-tap eligibility check ─────────────────────────────────────────
  // Only queries Supabase when 3 taps are detected; silent on failure so the
  // gesture leaves no visible trace for non-admin users.
  const checkAdminEligibility = useCallback(async () => {
    const userId = Storage.getItem('islamnu_user_id');
    if (!userId) return;

    const { data } = await supabase
      .from('app_users')
      .select('id, name, phone, pin_hash, auth_user_id')
      .eq('id', userId)
      .eq('role', 'admin')
      .not('auth_user_id', 'is', null)
      .is('deleted_at', null)
      .maybeSingle();

    if (!data?.pin_hash || !data?.auth_user_id) return; // not eligible — silent

    setAdminEligibleUser({
      id:           data.id,
      name:         data.name,
      phone:        data.phone,
      pin_hash:     data.pin_hash,
      auth_user_id: data.auth_user_id,
    });
    setAdminPinVisible(true);
  }, []);

  const handleLogoTap = useCallback(() => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      checkAdminEligibility();
      return;
    }
    // Reset counter if the 3-tap window (3 s) expires
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 3000);
  }, [checkAdminEligibility]);

  const handleAdminPinSuccess = useCallback(() => {
    setAdminPinVisible(false);
    router.push('/admin-announcements');
  }, [router]);

  const handleAdminPinCancel = useCallback(() => {
    setAdminPinVisible(false);
    setAdminEligibleUser(null);
  }, []);

  // ── Fetch active announcements ────────────────────────────────────────────
  const loadAnnouncements = useCallback(async () => {
    const all    = await fetchActiveAnnouncements();
    const bList  = all.filter(a => a.display_type === 'banner');
    const pList  = all.filter(a => a.display_type === 'popup');

    setBannerAnnouncements(bList);

    // ── Notification tap deep link ─────────────────────────────────────────
    // _layout.tsx writes the tapped announcementId here when the user opens the
    // app via a push notification. We read it once, clear it, then react:
    //   • banner  → pulse the card 3× (scale 1→1.06→1)
    //   • popup   → force-show the popup (bypass "already seen" check)
    const tappedId = await AsyncStorage.getItem('islamnu_notif_tap');
    if (tappedId) {
      await AsyncStorage.removeItem('islamnu_notif_tap');
      const tapped = all.find(a => a.id === tappedId);
      if (tapped) {
        if (tapped.display_type === 'banner') {
          setPulsingId(tappedId);
          return; // skip normal popup logic — nothing else to do for banners
        } else if (tapped.display_type === 'popup') {
          setPopupQueue([tapped]);
          return; // force show — skip normal unseen check
        }
      }
    }

    // ── Normal popup logic: collect all unseen popups into the stack ─────────
    if (pList.length > 0) {
      const seenRaw  = Storage.getItem('islamnu_seen_popups');
      const seenList: { id: string; updated_at: string }[] = seenRaw ? JSON.parse(seenRaw) : [];
      const unseenAll = pList.filter(p => {
        const entry = seenList.find(s => s.id === p.id);
        return !entry || entry.updated_at !== p.updated_at;
      });
      if (unseenAll.length > 0) {
        setPopupQueue(unseenAll);
      }
    }
  }, []);

  // Load on tab focus (initial load + tab-switch refresh)
  useFocusEffect(useCallback(() => { loadAnnouncements(); }, [loadAnnouncements]));

  // ── Real-time: instant update when admin creates/activates an announcement ─
  useEffect(() => {
    const channel = supabase
      .channel('announcements-home')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => { loadAnnouncements(); },
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [loadAnnouncements]);

  // ── 60-second poll: catches scheduled starts_at times arriving ────────────
  // (Supabase real-time won't fire when only time passes without a DB change)
  useEffect(() => {
    const pollRef = { timer: null as ReturnType<typeof setInterval> | null };

    const start = () => {
      pollRef.timer = setInterval(() => { loadAnnouncements(); }, 60_000);
    };
    const stop = () => {
      if (pollRef.timer) { clearInterval(pollRef.timer); pollRef.timer = null; }
    };

    start();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { loadAnnouncements(); start(); }
      else stop();
    });

    return () => { stop(); sub.remove(); };
  }, [loadAnnouncements]);

  const dismissPopup = useCallback(async () => {
    const top = popupQueue[0];
    if (!top) return;
    // Persist seen state so this popup is not shown again unless content changes
    const seenRaw  = Storage.getItem('islamnu_seen_popups');
    const seenList: { id: string; updated_at: string }[] = seenRaw ? JSON.parse(seenRaw) : [];
    const updated  = [
      ...seenList.filter(s => s.id !== top.id),
      { id: top.id, updated_at: top.updated_at },
    ];
    await Storage.setItem('islamnu_seen_popups', JSON.stringify(updated));
    // Pop top card — modal closes automatically when queue becomes empty
    setPopupQueue(q => q.slice(1));
  }, [popupQueue]);

  const navigateToBooking = useCallback((view?: string, extra?: { bookingId?: string; filter?: string; date?: string }) => {
    let url = '/booking';
    const params: string[] = [];
    if (view) params.push(`view=${view}`);
    if (extra?.bookingId) params.push(`bookingId=${extra.bookingId}`);
    if (extra?.filter) params.push(`filter=${extra.filter}`);
    if (extra?.date) params.push(`date=${extra.date}`);
    if (params.length > 0) url += '?' + params.join('&');
    router.push(url as any);
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={{ paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center' }}>
        {/* Triple-tap triggers hidden admin access — no visual feedback intentional */}
        <TouchableOpacity onPress={handleLogoTap} activeOpacity={1} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
          <HidayahLogo size={52} />
        </TouchableOpacity>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: '700', color: T.text, textAlign: 'center' }}>Hem</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isLoggedIn && <TouchableOpacity onPress={openBell} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill={T.textMuted}>
              <Path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
            </Svg>
            {bookingUnread > 0 && (
              <View style={{
                position: 'absolute', top: 2, right: 2,
                minWidth: 14, height: 14, borderRadius: 7,
                backgroundColor: '#FF3B30',
                alignItems: 'center', justifyContent: 'center',
                paddingHorizontal: 2,
              }}>
                <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800', lineHeight: 10 }}>
                  {bookingUnread > 99 ? '99' : String(bookingUnread)}
                </Text>
              </View>
            )}
          </TouchableOpacity>}
          <ThemeToggle />
        </View>
      </View>
      <BookingBellPanel
        visible={bellOpen}
        onClose={closeBell}
        pendingCount={pendingCount}
        cancelledCount={cancelledCount}
        pendingBookings={pendingBookings}
        bookingNotifs={bookingNotifs}
        onDismissNotif={dismissNotif}
        onDismissAll={dismissAllNotifs}
        onMarkAllSeen={markAllSeen}
        onNavigateToBooking={navigateToBooking}
        isAdmin={isAdmin}
        isDark={isDark}
        T={T}
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />}
      >
        {/* ── Greeting ── */}
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: T.text, letterSpacing: -0.2 }} numberOfLines={1} adjustsFontSizeToFit>
            {preferredName
              ? `As-salāmo ʿalaykom, ${preferredName}`
              : 'As-salāmo ʿalaykom'
            }
          </Text>
          {!preferredName && (
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={openNameModal}
              hitSlop={{ top: 4, bottom: 8, left: 0, right: 16 }}
            >
              <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 5 }}>
                Vad vill du att vi ska kalla dig? ›
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Dagens Koranvers */}
        <DagensKoranversCard />

        {/* Nästa bön */}
        <NextPrayerCard />

        {/* Dagens Hadith */}
        <DagensHadithCard />

        {/* ── Fortsätt ── */}
        {(() => {
          // 2 full cards + ~40 px peek of third card, aligned to screen edge.
          // marginHorizontal: -16 breaks out of the parent ScrollView's paddingHorizontal.
          const CARD_W = Math.floor((screenWidth - 72) / 2); // ~159 px on 390 w
          const GAP    = 8;
          const ITEMS  = [
            { title: 'Läs Koranen',         subtitle: 'Öppna Koranen',   icon: 'quran'       as const, route: '/quran'  },
            { title: 'Läs åminnelser',      subtitle: 'Hisnul Muslim',    icon: 'dhikr'       as const, route: '/dhikr'  },
            { title: 'Lär dig Allahs namn', subtitle: 'Asma ul-Husna',   icon: 'allahs-namn' as const, route: '/asmaul' },
          ] as const;

          return (
            <View style={{ marginTop: 4, marginBottom: 4 }}>
              <Text style={{
                fontSize: 12, fontWeight: '600', color: T.textMuted,
                letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10,
              }}>
                Fortsätt
              </Text>

              {/* Negative margin lets the scroll row bleed to screen edges */}
              <View style={{ marginHorizontal: -16 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  // Snap[0]: card 1+2 visible, card 3 peeks.
                  // Snap[1]: iOS clamps to max offset → cards 2+3 fully visible.
                  snapToOffsets={[0, CARD_W + GAP]}
                  snapToAlignment="start"
                  contentContainerStyle={{ paddingLeft: 16, paddingRight: 20 }}
                >
                  {ITEMS.map((item, index) => (
                    <TouchableOpacity
                      key={item.route}
                      activeOpacity={0.7}
                      onPress={() => router.push(item.route as any)}
                      style={{
                        width: CARD_W,
                        backgroundColor: T.card,
                        borderRadius: 14,
                        borderWidth: 0.5,
                        borderColor: T.border,
                        padding: 14,
                        marginRight: index < ITEMS.length - 1 ? GAP : 0,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 3 },
                        shadowOpacity: 0.08,
                        shadowRadius: 10,
                      }}
                    >
                      <View style={{
                        width: 30, height: 30, borderRadius: 9,
                        backgroundColor: T.accentGlow,
                        alignItems: 'center', justifyContent: 'center',
                        marginBottom: 9,
                      }}>
                        <SvgIcon name={item.icon} size={16} color={T.accent} />
                      </View>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: T.text, lineHeight: 19 }}>
                        {item.title}
                      </Text>
                      <Text style={{ fontSize: 12, fontWeight: '400', color: T.textMuted, marginTop: 3 }}>
                        {item.subtitle}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          );
        })()}

        <View onLayout={e => { youtubeCardYRef.current = e.nativeEvent.layout.y; }}>
          <YoutubeCard stream={stream} isLive={isLive} isUpcoming={isUpcoming} />
        </View>

        {/* Admin — individual pending booking cards, one per booking */}
        {isAdmin && pendingBookings.map(pb => (
          <TouchableOpacity
            key={pb.id}
            activeOpacity={0.75}
            onPress={() => navigateToBooking(undefined, { bookingId: pb.id, date: pb.startDate })}
            style={{
              backgroundColor: T.card, borderRadius: 14, borderWidth: 0.5,
              borderColor: '#FF9500' + '66', marginBottom: 10, overflow: 'hidden',
              flexDirection: 'row',
            }}
          >
            <View style={{ width: 4, backgroundColor: '#FF9500' }} />
            <View style={{ flex: 1, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: T.text, flex: 1 }} numberOfLines={1}>
                  {pb.activity}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#FF9500', marginLeft: 8 }}>
                  VÄNTAR
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: T.textMuted }}>
                {pb.startDate ? (() => {
                  const [y, m, d] = pb.startDate.split('-').map(Number);
                  const dt = new Date(y, m - 1, d);
                  return dt.getDate() + ' ' + ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'][dt.getMonth()] + ' ' + dt.getFullYear();
                })() : ''}{pb.timeSlot ? ' · ' + pb.timeSlot : ''}
              </Text>
              {pb.name ? <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{pb.name}</Text> : null}
            </View>
            <View style={{ justifyContent: 'center', paddingRight: 14 }}>
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Path d="M9 18l6-6-6-6" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </TouchableOpacity>
        ))}
        {isAdmin && cancelledCount > 0 && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => navigateToBooking('admin', { filter: 'cancelled' })}
            style={{
              backgroundColor: T.card, borderRadius: 14, borderWidth: 0.5,
              borderColor: (isDark ? '#64B5F6' : '#1565C0') + '66', padding: 14, marginBottom: 10,
              flexDirection: 'row', alignItems: 'center', gap: 12,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: (isDark ? '#64B5F6' : '#1565C0') + '22', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill={isDark ? '#64B5F6' : '#1565C0'}>
                <Path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </Svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#64B5F6' : '#1565C0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                AVBOKNING
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: T.text }}>
                {cancelledCount} {cancelledCount === 1 ? 'bokning har avbokats' : 'bokningar har avbokats'} av användare
              </Text>
            </View>
            <Svg width={16} height={16} viewBox="0 0 24 24">
              <Path d="M9 18l6-6-6-6" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        )}

        {/* User individual booking notification cards */}
        {!isAdmin && bookingNotifs.map(notif => (
          <TouchableOpacity
            key={notif.id}
            activeOpacity={0.75}
            onPress={() => navigateToBooking('my-bookings', { bookingId: notif.id })}
            style={{
              backgroundColor: T.card, borderRadius: 14, borderWidth: 0.5,
              borderColor: notif.isNew ? (statusColor(notif.status, isDark) + '55') : T.border,
              marginBottom: 10, overflow: 'hidden',
              flexDirection: 'row',
            }}
          >
            {/* Color accent left border */}
            <View style={{ width: 4, backgroundColor: statusColor(notif.status, isDark) }} />
            <View style={{ flex: 1, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: T.text, flex: 1 }} numberOfLines={1}>
                  {notif.activity}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: statusColor(notif.status, isDark), marginLeft: 8 }}>
                  {statusLabel(notif.status)}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: T.textMuted }}>
                {fmtDate(notif.startDate)}{notif.timeSlot ? ' · ' + notif.timeSlot : ''}
              </Text>
              {notif.adminComment ? (
                <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 4, fontStyle: 'italic' }} numberOfLines={2}>
                  {notif.adminComment}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); dismissNotif(notif.id, notif.status); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ padding: 14, justifyContent: 'flex-start', paddingTop: 16 }}
            >
              <Svg width={16} height={16} viewBox="0 0 24 24" fill={T.textMuted}>
                <Path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </Svg>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}

        {/* ── Supabase announcement banners ── */}
        {bannerAnnouncements.map(a => (
          <AnnouncementBannerCard
            key={a.id}
            announcement={a}
            T={T}
            isDark={isDark}
            isPulsing={a.id === pulsingId}
            onPulseEnd={() => setPulsingId(null)}
          />
        ))}

        {banners.map(b => (
          <BannerCard key={b.id} banner={b} onDismiss={() => dismissBanner(b.id)} theme={T} />
        ))}

      </ScrollView>

      {/* ── Admin PIN modal ── */}
      {adminEligibleUser && (
        <AdminPinModal
          visible={adminPinVisible}
          user={adminEligibleUser}
          onSuccess={handleAdminPinSuccess}
          onCancel={handleAdminPinCancel}
          isDark={isDark}
          T={T}
        />
      )}

      {/* ── Announcement popup modal — stacked card deck ── */}
      {popupQueue.length > 0 && (
        <Modal
          visible
          transparent={false}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={dismissPopup}
        >
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {/* ── Back card peeks (rendered first = behind front card) ── */}
            {popupQueue.length >= 3 && (
              <View style={{
                position: 'absolute', bottom: 0, left: 28, right: 28, height: 22,
                borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: 'hidden',
                backgroundColor: '#1a1a1a',
              }}>
                {popupQueue[2]?.image_url && (
                  <Image source={{ uri: popupQueue[2].image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                )}
              </View>
            )}
            {popupQueue.length >= 2 && (
              <View style={{
                position: 'absolute', bottom: 0, left: 14, right: 14, height: 38,
                borderTopLeftRadius: 14, borderTopRightRadius: 14, overflow: 'hidden',
                backgroundColor: '#111',
              }}>
                {popupQueue[1]?.image_url && (
                  <Image source={{ uri: popupQueue[1].image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                )}
              </View>
            )}

            {/* ── Front card — tappable, sits above peek strips ── */}
            {(() => {
              const front = popupQueue[0];
              // Leave room at bottom so peek strips are visible
              const bottomInset = popupQueue.length >= 3 ? 44 : popupQueue.length >= 2 ? 28 : 0;
              return (
                <TouchableOpacity
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: bottomInset }}
                  activeOpacity={1}
                  onPress={dismissPopup}
                >
                  {front.image_url ? (
                    <Image source={{ uri: front.image_url }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg }]} />
                  )}

                  {/* Dot indicators — only shown when multiple cards */}
                  {popupQueue.length > 1 && (
                    <View style={{
                      position: 'absolute', top: 56, left: 0, right: 0,
                      flexDirection: 'row', justifyContent: 'center', gap: 6,
                    }}>
                      {popupQueue.map((_, i) => (
                        <View key={i} style={{
                          width: i === 0 ? 18 : 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: i === 0 ? '#fff' : 'rgba(255,255,255,0.38)',
                        }} />
                      ))}
                    </View>
                  )}

                  {/* X button — offset down when dots are shown */}
                  <TouchableOpacity
                    onPress={dismissPopup}
                    activeOpacity={0.8}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={{
                      position: 'absolute',
                      top: popupQueue.length > 1 ? 76 : 56,
                      right: 20,
                      width: 32, height: 32, borderRadius: 16,
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                      stroke="#fff" strokeWidth={2.5} strokeLinecap="round">
                      <Path d="M18 6L6 18M6 6l12 12" />
                    </Svg>
                  </TouchableOpacity>

                  {/* Text overlay — blocks tap-to-dismiss from firing through text */}
                  {(front.title || front.message || front.link_url) && (
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => {}}
                      style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}
                    >
                      <View style={{ paddingHorizontal: 24, paddingBottom: 32, paddingTop: 80 }}>
                        <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: 20 }}>
                          {!!front.title && (
                            <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: front.message ? 8 : 0 }}>
                              {front.title}
                            </Text>
                          )}
                          {front.message ? (
                            <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 21 }}>
                              {front.message}
                            </Text>
                          ) : null}
                          {front.link_url && front.link_text ? (
                            <TouchableOpacity onPress={() => Linking.openURL(front.link_url!)} style={{ marginTop: 10 }}>
                              <Text style={{ fontSize: 14, color: '#5AC8FA', textDecorationLine: 'underline' }}>
                                {front.link_text}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })()}
          </View>
        </Modal>
      )}

      {/* ── Preferred name modal ── */}
      <Modal
        visible={nameModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNameModalVisible(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
          activeOpacity={1}
          onPress={() => setNameModalVisible(false)}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{
            backgroundColor: T.card,
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            paddingBottom: Platform.OS === 'ios' ? 34 : 20,
            borderWidth: 0.5, borderBottomWidth: 0, borderColor: T.border,
          }}>
            {/* Drag handle */}
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, alignSelf: 'center', marginTop: 10, marginBottom: 14 }} />
            {/* Header */}
            <View style={{ paddingHorizontal: 20, marginBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: T.text }}>
                Vad vill du att vi ska kalla dig?
              </Text>
              <TouchableOpacity
                onPress={() => setNameModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.accentGlow, alignItems: 'center', justifyContent: 'center', marginLeft: 12 }}
              >
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 6L6 18M6 6l12 12" stroke={T.textMuted} strokeWidth={2.2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>
            <View style={{ height: 0.5, backgroundColor: T.border, marginTop: 10, marginBottom: 16 }} />
            {/* Input + action */}
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              <TextInput
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Skriv ditt namn"
                placeholderTextColor={T.textMuted}
                autoFocus
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleSaveName}
                style={{
                  backgroundColor: T.bg,
                  borderRadius: 12,
                  borderWidth: 0.5,
                  borderColor: T.border,
                  paddingHorizontal: 14,
                  paddingVertical: 13,
                  fontSize: 16,
                  color: T.text,
                }}
              />
              <TouchableOpacity
                onPress={handleSaveName}
                activeOpacity={0.8}
                style={{
                  backgroundColor: nameInput.trim() ? T.accent : T.border,
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Spara</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Announcement banner card ────────────────────────────────────────────────────
function AnnouncementBannerCard({
  announcement: a, T, isDark, isPulsing = false, onPulseEnd,
}: {
  announcement: Announcement; T: any; isDark: boolean;
  isPulsing?: boolean; onPulseEnd?: () => void;
}) {
  // Logo column width + gap — matches the existing Google Sheets BannerCard layout
  const LOGO_SIZE   = 28;
  const GAP         = 10;
  const TEXT_INDENT = LOGO_SIZE + GAP; // 38 — same as BannerCard link text indent

  // Scale animation triggered when the user taps the push notification for this banner.
  // Runs 3× (scale 1→1.06→1, 180ms each direction) then stops and resets the parent state.
  const scaleAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isPulsing) return;
    const pulse = Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.06, duration: 180, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 180, useNativeDriver: true }),
    ]);
    Animated.sequence([pulse, pulse, pulse]).start(() => {
      scaleAnim.setValue(1);
      onPulseEnd?.();
    });
  }, [isPulsing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], marginBottom: 10 }}>
      <View style={{
        backgroundColor: T.card, borderRadius: 14,
        borderWidth: 0.5, borderColor: T.border,
        overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08, shadowRadius: 12,
      }}>
        {a.image_url ? (
          <Image source={{ uri: a.image_url }} style={{ width: '100%', height: 160 }} resizeMode="cover" />
        ) : null}
        <View style={{ padding: 14 }}>
          {/* Logo + title row — identical structure to BannerCard */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: GAP }}>
            <View style={{ width: LOGO_SIZE, height: LOGO_SIZE, flexShrink: 0, marginTop: 1 }}>
              <HidayahLogo size={LOGO_SIZE} />
            </View>
            <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20, color: T.text }}>
              {a.title}
            </Text>
          </View>
          {/* Message indented to match title left edge */}
          {a.message ? (
            <Text style={{ fontSize: 13, color: T.textMuted, lineHeight: 19, marginTop: 4, marginLeft: TEXT_INDENT }}>
              {a.message}
            </Text>
          ) : null}
          {/* Link — same pattern as Google Sheets BannerCard */}
          {a.link_url && a.link_text ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(a.link_url!)}
              activeOpacity={0.7}
              style={{ marginTop: 6, marginLeft: TEXT_INDENT }}
            >
              <Text style={{ fontSize: 14, color: T.accent, textDecorationLine: 'underline' }}>
                {a.link_text}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}
