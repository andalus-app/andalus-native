/**
 * booking.tsx — Lokal-bokningssystem för Andalus (React Native)
 * Port av BookingScreen.js (PWA) med full funktionalitet:
 * - Kalendervy (månadsvy + dagpanel)
 * - Inloggning (telefon → inbjudningskod → PIN-kod)
 * - Admin-panel (godkänn/avböj/radera)
 * - Upprepade bokningar + undantag
 * - Offline-kö
 * - Realtidsuppdateringar via Supabase
 */

import React, {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, StyleSheet, Alert, Animated, Easing,
  PanResponder, AppState, KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Polyline, Line, Rect } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { useBookingNotif } from '../context/BookingNotifContext';
import { supabase } from '../lib/supabase';
import { Storage, initStorage } from '../services/storage';
import * as Haptics from 'expo-haptics';
import { useOfflineBookingNative } from '../hooks/useOfflineBookingNative';
import { useLocalSearchParams, useFocusEffect, useRouter, useNavigation } from 'expo-router';
import BackButton from '../components/BackButton';

// ─── Storage keys ──────────────────────────────────────────────────────────────
const SK_ADMIN     = 'islamnu_admin_mode';
const SK_DEVICE    = 'islamnu_device_id';
const SK_PHONE     = 'islamnu_user_phone';
const SK_USER_ID   = 'islamnu_user_id';
const SK_USER_NAME = 'islamnu_user_name';
const SK_USER_ROLE = 'islamnu_user_role';
const SK_ADMIN_DEV = 'islamnu_is_admin_device';
const SK_ADMIN_SEEN = 'islamnu_bookings_admin_seen';

// ─── Constants ────────────────────────────────────────────────────────────────
const OPEN_HOUR  = 8;
const CLOSE_HOUR = 24;
const VALID_HOURS     = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);
const VALID_HOURS_END = [...VALID_HOURS, 24];
const VALID_MINUTES   = [0, 30];
const DAYS_SV   = ['M','T','O','T','F','L','S'];
const DAYS_FULL = ['Måndag','Tisdag','Onsdag','Torsdag','Fredag','Lördag','Söndag'];
const MONTHS_SV = ['Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December'];

const RECUR_OPTIONS = [
  { value: 'none',     label: 'Ingen upprepning' },
  { value: 'daily',    label: 'Varje dag' },
  { value: 'weekly',   label: 'Varje vecka' },
  { value: 'biweekly', label: 'Varannan vecka' },
  { value: 'monthly',  label: 'Varje månad' },
  { value: 'yearly',   label: 'Varje år' },
  { value: 'custom',   label: 'Anpassad (välj dagar)' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const WK_COL_W = 28; // Fixed width (px) of the week-number column in the calendar grid.

// ISO 8601 week number — correct across year and month boundaries.
// Week 1 = the week containing the year's first Thursday (Monday-start weeks).
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Sun=0 → 7 so Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);  // shift to the Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

// RFC 4122 UUID v4 — required for Supabase uuid columns.
// Math.random().toString(36) is NOT a valid UUID and will fail a uuid column constraint.
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function toISO(d: Date) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseISO(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isoToDisplay(s: string) {
  const d = parseISO(s);
  return d.getDate() + ' ' + MONTHS_SV[d.getMonth()] + ' ' + d.getFullYear();
}
function fmtTime(h: number, m: number) {
  return String(h === 24 ? 0 : h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function slotFromHM(sH: number, sM: number, eH: number, eM: number) {
  return fmtTime(sH, sM) + '–' + fmtTime(eH, eM);
}
function parseSlotParts(slot: string) {
  const [s, e] = slot.split('–');
  const p = (t: string) => { const [h, m] = t.split(':').map(Number); return { h, m }; };
  const st = p(s); const en = p(e);
  const sd = st.h + st.m / 60;
  const ed = en.h === 0 ? 24 : en.h + en.m / 60;
  return { startH: st.h, startM: st.m, endH: en.h === 0 ? 24 : en.h, endM: en.m, startDecimal: sd, endDecimal: ed, duration: ed - sd };
}
function fmtDuration(h: number) {
  if (h < 1) return '30 min';
  const f = Math.floor(h), half = h % 1 !== 0;
  return half ? f + ' tim 30 min' : f + ' tim';
}
function normalizePhone(p: string) {
  let s = (p || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('+46')) s = '0' + s.slice(3);
  return s;
}
function sha256(str: string): string {
  // Pure-JS SHA-256 — no Web Crypto API needed
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const bytes: number[] = [];
  for (let ci = 0; ci < str.length; ci++) {
    let c = str.charCodeAt(ci);
    if (c < 128) { bytes.push(c); }
    else if (c < 2048) { bytes.push((c >> 6) | 192, (c & 63) | 128); }
    else if (c >= 0xd800 && c < 0xdc00) {
      const c2 = str.charCodeAt(++ci);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      bytes.push((c>>18)|240,((c>>12)&63)|128,((c>>6)&63)|128,(c&63)|128);
    } else { bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128); }
  }
  const l = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bl = l * 8;
  bytes.push(0,0,0,0,(bl>>>24)&0xff,(bl>>>16)&0xff,(bl>>>8)&0xff,bl&0xff);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < bytes.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = (bytes[i+j*4]<<24)|(bytes[i+j*4+1]<<16)|(bytes[i+j*4+2]<<8)|bytes[i+j*4+3];
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j-15],7)^rotr(w[j-15],18)^(w[j-15]>>>3);
      const s1 = rotr(w[j-2],17)^rotr(w[j-2],19)^(w[j-2]>>>10);
      w[j] = (w[j-16]+s0+w[j-7]+s1)|0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let j = 0; j < 64; j++) {
      const t1 = (hh+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[j]+w[j])|0;
      const t2 = ((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;
      hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h[0]=(h[0]+a)|0; h[1]=(h[1]+b)|0; h[2]=(h[2]+c)|0; h[3]=(h[3]+d)|0;
    h[4]=(h[4]+e)|0; h[5]=(h[5]+f)|0; h[6]=(h[6]+g)|0; h[7]=(h[7]+hh)|0;
  }
  return h.map(n => (n>>>0).toString(16).padStart(8,'0')).join('');
}
function parseCustomDays(r: string) {
  if (!r || !r.startsWith('custom:')) return [];
  return r.slice(7).split(',').map(Number).filter(n => !isNaN(n));
}
function buildCustomRecurrence(days: number[]) {
  if (!days || days.length === 0) return 'custom:';
  return 'custom:' + [...days].sort((a, b) => a - b).join(',');
}
function fmtRecur(r: string) {
  if (!r) return 'Ingen upprepning';
  if (r.startsWith('custom:')) {
    const days = parseCustomDays(r);
    if (days.length === 0) return 'Anpassad (inga dagar valda)';
    const names = ['Måndag','Tisdag','Onsdag','Torsdag','Fredag','Lördag','Söndag'];
    return 'Anpassad: ' + days.map(d => names[d]).join(', ');
  }
  return RECUR_OPTIONS.find(o => o.value === r)?.label || r;
}
function getMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const pad = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
function generateInviteCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

// ─── Recurrence engine ────────────────────────────────────────────────────────
function applyException(booking: any, date: string, exc: any) {
  if (!exc) return { ...booking, date, _exception: null };
  return {
    ...booking, date,
    time_slot: exc.new_time_slot || booking.time_slot,
    duration_hours: exc.new_duration_hours || booking.duration_hours,
    activity: exc.new_activity || booking.activity,
    status: exc.new_status || booking.status,
    admin_comment: exc.admin_comment || booking.admin_comment,
    _exception: exc, _exception_id: exc.id,
  };
}
function expandBooking(booking: any, windowStart: string, windowEnd: string, exceptions: any[] = []) {
  const { start_date, end_date, recurrence } = booking;
  const skipDates = new Set(exceptions.filter(e => e.booking_id === booking.id && e.type === 'skip').map(e => e.exception_date));
  const editMap: Record<string, any> = {};
  exceptions.filter(e => e.booking_id === booking.id && e.type === 'edit').forEach(e => { editMap[e.exception_date] = e; });
  const dates: any[] = [];
  if (!recurrence || recurrence === 'none') {
    if (start_date >= windowStart && start_date <= windowEnd && !skipDates.has(start_date))
      dates.push(applyException(booking, start_date, editMap[start_date]));
    return dates;
  }
  let current = parseISO(start_date);
  const endD = end_date ? parseISO(end_date) : parseISO(windowEnd);
  const winEnd = parseISO(windowEnd);
  const effectiveEnd = endD < winEnd ? endD : winEnd;
  const winStart = parseISO(windowStart);
  let safety = 0;
  while (current <= effectiveEnd && safety++ < 5000) {
    const iso = toISO(current);
    if (current >= winStart && !skipDates.has(iso)) dates.push(applyException(booking, iso, editMap[iso]));
    const next = new Date(current);
    if (recurrence === 'daily') next.setDate(next.getDate() + 1);
    else if (recurrence === 'weekly') next.setDate(next.getDate() + 7);
    else if (recurrence === 'biweekly') next.setDate(next.getDate() + 14);
    else if (recurrence === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (recurrence === 'yearly') next.setFullYear(next.getFullYear() + 1);
    else if (recurrence && recurrence.startsWith('custom:')) {
      const customDays = parseCustomDays(recurrence);
      if (customDays.length === 0) break;
      next.setDate(next.getDate() + 1);
      let s2 = 0;
      while (s2++ < 14) {
        const dow = (next.getDay() + 6) % 7;
        if (customDays.includes(dow)) break;
        next.setDate(next.getDate() + 1);
      }
    } else break;
    current = next;
  }
  return dates;
}
function expandAll(bookings: any[], exceptions: any[], windowStart: string, windowEnd: string) {
  const result: any[] = [];
  for (const b of bookings) {
    if (b.status === 'cancelled' || b.status === 'rejected' || b.status === 'deleted') continue;
    result.push(...expandBooking(b, windowStart, windowEnd, exceptions));
  }
  return result;
}
function getOccurrencesForDate(bookings: any[], exceptions: any[], iso: string) {
  return expandAll(bookings, exceptions, iso, iso);
}
function getBookedBlocks(bookings: any[], exceptions: any[], iso: string, excludeId: string | null = null) {
  const occs = getOccurrencesForDate(bookings, exceptions, iso).filter(o => o.id !== excludeId);
  const blocks = new Set<number>();
  occs.forEach(o => {
    const p = parseSlotParts(o.time_slot);
    for (let i = 0; i < p.duration * 2; i++) blocks.add(p.startDecimal * 2 + i);
  });
  return blocks;
}
function hasBookingsOnDate(bookings: any[], exceptions: any[], iso: string) {
  return getOccurrencesForDate(bookings, exceptions, iso).length > 0;
}

// ─── Primitive UI ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    pending:      { label: 'Väntar',        bg: '#FF9F0A22', color: '#FF9F0A' },
    edit_pending: { label: 'Ändr. väntar',  bg: '#FF6B2222', color: '#FF6B22' },
    approved:     { label: 'Godkänd',       bg: '#34C75922', color: '#34C759' },
    rejected:     { label: 'Avböjd',        bg: '#FF3B3022', color: '#FF3B30' },
    cancelled:    { label: 'Inställd',      bg: '#8E8E9322', color: '#8E8E93' },
    edited:       { label: 'Ändrad',        bg: '#0A84FF22', color: '#0A84FF' },
  };
  const s = map[status] || { label: status, bg: '#88888822', color: '#888' };
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: s.color, fontSize: 11, fontWeight: '700' }}>{s.label}</Text>
    </View>
  );
}

function ToastView({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View style={[styles.toast, { position: 'absolute', bottom: 110, alignSelf: 'center', zIndex: 9999 }]}>
      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{message}</Text>
    </View>
  );
}

function SpinnerView({ color }: { color: string }) {
  return (
    <View style={{ justifyContent: 'center', alignItems: 'center', padding: 40 }}>
      <ActivityIndicator color={color} size="large" />
    </View>
  );
}

// ─── Offline Status Bar ────────────────────────────────────────────────────────
function OfflineStatusBar({ status, isDark, accent }: { status: string | null; isDark: boolean; accent: string }) {
  const [visible, setVisible] = useState(false);
  const [displayStatus, setDisplayStatus] = useState(status);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (status === null) {
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
    setDisplayStatus(status);
    setVisible(true);
  }, [status]);

  if (!visible) return null;

  const isSent = displayStatus === 'sent';
  const bg = isSent
    ? (isDark ? 'rgba(52,199,89,0.14)' : 'rgba(52,199,89,0.10)')
    : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(36,100,93,0.07)');
  const borderColor = isSent
    ? (isDark ? 'rgba(52,199,89,0.25)' : 'rgba(52,199,89,0.22)')
    : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(36,100,93,0.12)');
  const iconColor = isSent ? '#34C759' : accent;
  const textColor = isSent
    ? (isDark ? '#34C759' : '#1a7a3a')
    : (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(36,100,93,0.85)');
  const msg = isSent ? 'Bokning skickad' : 'Skickas automatiskt när du är online';

  return (
    <View style={{
      position: 'absolute',
      bottom: insets.bottom + 96,
      left: 20, right: 20,
      alignItems: 'center',
      zIndex: 1800,
      pointerEvents: 'none',
    } as any}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 10, paddingHorizontal: 16,
        borderRadius: 32, backgroundColor: bg,
        borderWidth: 1, borderColor,
        maxWidth: 340,
      }}>
        {isSent
          ? <Svg width={18} height={18} viewBox="0 0 18 18" fill="none"><Circle cx="9" cy="9" r="8.5" stroke={iconColor} strokeOpacity={0.25}/><Path d="M5.5 9.5l2.5 2.5 4.5-5" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></Svg>
          : <ActivityIndicator size="small" color={iconColor} />
        }
        <Text style={{ fontSize: 13, fontWeight: '500', color: textColor, flex: 1 }}>{msg}</Text>
      </View>
    </View>
  );
}

// ─── Drum Picker (native ScrollView) ─────────────────────────────────────────
function DrumPicker({
  options, value, onChange, formatFn, T,
}: {
  options: number[];
  value: number;
  onChange: (v: number) => void;
  formatFn?: (v: number) => string;
  T: any;
}) {
  const ITEM_H = 44;
  const scrollRef = useRef<ScrollView>(null);
  // Track whether the user is actively scrolling — used to guard the
  // programmatic scrollTo in useEffect so it never interrupts a live drag.
  const isScrollingRef = useRef(false);
  // Set to true when a momentum phase begins so onScrollEndDrag knows it
  // should NOT commit (onMomentumScrollEnd will handle it instead).
  const hasMomentumRef = useRef(false);
  // Timer for the slow-drag commit path (no momentum after drag ends).
  const dragEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last index that triggered haptic — avoids duplicate feedback on the same item.
  const hapticIdxRef = useRef<number>(-1);

  const idx = useMemo(() => {
    const i = options.indexOf(value);
    return i === -1 ? 0 : i;
  }, [options, value]);

  // Programmatic sync — only fires when the external value changes (e.g. a
  // tap on a list item or parent state update), never while the user is
  // actively scrolling the wheel.
  useEffect(() => {
    if (isScrollingRef.current) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: idx * ITEM_H, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [idx]);

  // Commit helper — resolves the final offset to the nearest option.
  const commit = useCallback((offsetY: number) => {
    const i = Math.round(offsetY / ITEM_H);
    const clamped = Math.max(0, Math.min(options.length - 1, i));
    onChange(options[clamped]);
  }, [options, onChange]);

  return (
    <View style={{ height: ITEM_H * 3, flex: 1, overflow: 'hidden', position: 'relative' }}>
      {/* Fade top */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_H, zIndex: 2, pointerEvents: 'none' as any }} />
      {/* Fade bottom */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_H, zIndex: 2, pointerEvents: 'none' as any }} />
      {/* Highlight bar — pointerEvents none so it never intercepts scroll touches */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: ITEM_H, left: 0, right: 0, height: ITEM_H, zIndex: 1,
          backgroundColor: T.accentGlow,
          borderTopWidth: 0.5, borderBottomWidth: 0.5,
          borderColor: T.accent + '55',
        }}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={(e) => {
          // Fire a haptic tick every time a new item crosses the center line.
          // Runs at 60 fps so even a fast flick through all 24 hours gives
          // one feedback pulse per hour — identical to the iOS alarm picker.
          const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          const clamped = Math.max(0, Math.min(options.length - 1, i));
          if (clamped !== hapticIdxRef.current) {
            hapticIdxRef.current = clamped;
            Haptics.selectionAsync();
          }
        }}
        onScrollBeginDrag={() => {
          // User started dragging — block programmatic scrollTo.
          isScrollingRef.current = true;
          hasMomentumRef.current = false;
          if (dragEndTimerRef.current) {
            clearTimeout(dragEndTimerRef.current);
            dragEndTimerRef.current = null;
          }
        }}
        onMomentumScrollBegin={() => {
          // Flick velocity detected — the momentum path will handle commit.
          hasMomentumRef.current = true;
        }}
        onMomentumScrollEnd={(e) => {
          // Primary commit path: flick / momentum scroll landed on a snap point.
          hasMomentumRef.current = false;
          isScrollingRef.current = false;
          commit(e.nativeEvent.contentOffset.y);
        }}
        onScrollEndDrag={(e) => {
          // Slow-drag path: user lifted finger without flick velocity.
          // Wait 50 ms — if momentum fires in that window, it takes over.
          // This covers the case where decelerationRate="fast" still produces
          // a tiny momentum phase that fires onMomentumScrollBegin.
          const offsetY = e.nativeEvent.contentOffset.y;
          dragEndTimerRef.current = setTimeout(() => {
            dragEndTimerRef.current = null;
            if (!hasMomentumRef.current) {
              isScrollingRef.current = false;
              commit(offsetY);
              // Snap to nearest item visually — the ScrollView may not have
              // snapped yet on slow drags, so force it.
              const i = Math.round(offsetY / ITEM_H);
              const clamped = Math.max(0, Math.min(options.length - 1, i));
              scrollRef.current?.scrollTo({ y: clamped * ITEM_H, animated: true });
            }
          }, 50);
        }}
        contentContainerStyle={{ paddingVertical: ITEM_H }}
        style={{ flex: 1 }}
      >
        {options.map((opt) => (
          <View
            key={String(opt)}
            style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{
              fontSize: opt === value ? 20 : 16,
              fontWeight: opt === value ? '700' : '400',
              color: opt === value ? T.text : T.textMuted,
            }}>
              {formatFn ? formatFn(opt) : String(opt)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Time Accordion ────────────────────────────────────────────────────────────
function TimeAccordion({
  label, hour, minute, onConfirm, onOpenChange, bookedBlocks, isStart, pairedHour, pairedMinute, T,
}: {
  label: string; hour: number; minute: number;
  onConfirm: (h: number, m: number) => void;
  onOpenChange?: (open: boolean) => void;
  bookedBlocks: Set<number>; isStart: boolean;
  pairedHour: number; pairedMinute: number; T: any;
}) {
  const [open, setOpen] = useState(false);
  const [pendingH, setPendingH] = useState(hour);
  const [pendingM, setPendingM] = useState(minute);
  const heightAnim = useRef(new Animated.Value(0)).current;

  const validHours = useMemo(() => {
    if (isStart) return VALID_HOURS;
    const sd = pairedHour + pairedMinute / 60;
    return VALID_HOURS_END.filter(h => h > sd && h <= 24);
  }, [isStart, pairedHour, pairedMinute]);

  const validMinutes = useMemo(() => {
    if (!isStart && pendingH === 24) return [0];
    return VALID_MINUTES;
  }, [isStart, pendingH]);

  useEffect(() => {
    if (!validMinutes.includes(pendingM)) setPendingM(validMinutes[0]);
  }, [validMinutes]);

  useEffect(() => {
    if (open) { setPendingH(hour); setPendingM(minute); }
  }, [open]);

  useEffect(() => {
    const anim = Animated.timing(heightAnim, {
      toValue: open ? 1 : 0,
      duration: 280,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [open]);

  const isOccupied = (h: number, m: number) => {
    if (isStart) return bookedBlocks.has((h + m / 60) * 2);
    const endBlock = (h + m / 60) * 2;
    if (endBlock === 0) return false;
    return bookedBlocks.has(endBlock - 1);
  };

  const accentText = T.isDark ? '#4ECDC4' : T.accent;
  const fmtHour = (h: number) => String(h === 24 ? 0 : h).padStart(2, '0');
  const displayTime = fmtHour(hour) + ':' + String(minute).padStart(2, '0');
  const pendingTime = fmtHour(pendingH) + ':' + String(pendingM).padStart(2, '0');
  const occ = isOccupied(pendingH, pendingM);

  const maxH = heightAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 230] });

  // Tapping the row header when the picker is open confirms the pending time and closes.
  // Tapping when closed simply opens the picker.
  const handleRowPress = () => {
    if (open) {
      onConfirm(pendingH, pendingM);
      setOpen(false);
      onOpenChange?.(false);
    } else {
      setOpen(true);
      onOpenChange?.(true);
    }
  };

  return (
    <View style={{ backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 12, overflow: 'hidden' }}>
      <TouchableOpacity
        onPress={handleRowPress}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 }}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 16, color: T.text }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{
            backgroundColor: open ? (occ ? T.error : T.accent) : (T.isDark ? 'rgba(78,205,196,0.15)' : T.accentGlow),
            borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
          }}>
            <Text style={{ color: open ? '#fff' : accentText, fontSize: 15, fontWeight: '600' }}>
              {open ? pendingTime : displayTime}
            </Text>
          </View>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Polyline points="6 9 12 15 18 9" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
        </View>
      </TouchableOpacity>

      <Animated.View style={{ maxHeight: maxH, overflow: 'hidden' }}>
        <View style={{ borderTopWidth: 0.5, borderColor: T.separator, padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <DrumPicker options={validHours} value={pendingH} onChange={setPendingH} formatFn={fmtHour} T={T} />
            <Text style={{ fontSize: 22, fontWeight: '700', color: T.text, marginHorizontal: 8 }}>:</Text>
            <DrumPicker
              options={validMinutes}
              value={validMinutes.includes(pendingM) ? pendingM : validMinutes[0]}
              onChange={setPendingM}
              formatFn={m => String(m).padStart(2, '0')}
              T={T}
            />
          </View>
          {occ && <Text style={{ textAlign: 'center', fontSize: 12, color: T.error, marginTop: 8 }}>Denna tid är upptagen</Text>}
          <TouchableOpacity
            onPress={() => { onConfirm(pendingH, pendingM); setOpen(false); onOpenChange?.(false); }}
            disabled={occ}
            style={{
              marginTop: 12, backgroundColor: occ ? T.textTertiary : T.accent,
              borderRadius: 10, padding: 11, alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Bekräfta {pendingTime}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}


// ─── Login ─────────────────────────────────────────────────────────────────────
function UserLogin({ onSuccess, T }: { onSuccess: (user: any) => void; T: any }) {
  const [step, setStep] = useState<'phone' | 'invite' | 'setpin' | 'pin'>('phone');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userData, setUserData] = useState<any>(null);
  const [setpinPhase, setSetpinPhase] = useState<'first' | 'second'>('first');
  const insets = useSafeAreaInsets();
  const lookupSeq = useRef(0);
  const pinInputRef = useRef<any>(null);

  // Auto-focus the hidden native input whenever we land on a keypad step
  useEffect(() => {
    if (step === 'invite' || step === 'setpin' || step === 'pin') {
      const t = setTimeout(() => pinInputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [step, setpinPhase]);

  // Auto-lookup: as soon as phone reaches valid length, query DB and jump to PIN
  useEffect(() => {
    const norm = normalizePhone(phone);
    if (norm.length < 8) { return; }
    const seq = ++lookupSeq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase.from('app_users')
        .select('id,name,role,invite_used,pin_hash,deleted_at')
        .eq('phone', norm).maybeSingle();
      if (lookupSeq.current !== seq) return; // stale
      setLoading(false);
      if (!data || data.deleted_at) return; // no match yet, keep typing
      setUserData({ ...data, norm });
      setError('');
      setStep(data.invite_used ? 'pin' : 'invite');
    }, 350);
    return () => clearTimeout(timer);
  }, [phone]);

  // Reset setpin phase when returning to that step
  useEffect(() => {
    if (step === 'setpin') { setSetpinPhase('first'); setNewPin(''); setNewPin2(''); }
  }, [step]);

  const handlePhoneNext = async () => {
    if (!phone.trim()) { setError('Ange ditt telefonnummer.'); return; }
    setLoading(true); setError('');
    const norm = normalizePhone(phone);
    const { data } = await supabase.from('app_users')
      .select('id,name,role,invite_used,pin_hash,deleted_at')
      .eq('phone', norm).maybeSingle();
    setLoading(false);
    if (!data || data.deleted_at) { setError('Inget konto hittades. Kontakta admin.'); return; }
    setUserData({ ...data, norm });
    setStep(data.invite_used ? 'pin' : 'invite');
  };

  // codeOverride is passed when auto-submitting on the 6th digit — at that point
  // the inviteCode state hasn't flushed yet (stale closure), so we use the live value.
  const handleInviteSubmit = async (codeOverride?: string) => {
    const code = codeOverride ?? inviteCode;
    if (code.length !== 6) { setError('Ange 6-siffrig kod.'); return; }
    if (!userData) { setError('Sessionsfel. Börja om.'); setStep('phone'); return; }
    setLoading(true); setError('');
    const { data } = await supabase.from('app_users').select('invite_code').eq('id', userData.id).maybeSingle();
    if (data?.invite_code !== code) { setLoading(false); setError('Fel kod.'); return; }
    setLoading(false); setStep('setpin');
  };

  const handleSetPin = async () => {
    if (newPin.length < 4) { setError('PIN måste vara minst 4 siffror.'); return; }
    if (newPin !== newPin2) { setError('PIN-koderna matchar inte.'); return; }
    if (!userData) { setError('Sessionsfel. Börja om.'); setStep('phone'); return; }
    setLoading(true); setError('');
    const pinHash = sha256(userData.norm + ':' + newPin);
    await supabase.from('app_users').update({ pin_hash: pinHash, invite_used: true, invite_code: null, last_login: Date.now() }).eq('id', userData.id);
    setLoading(false);
    await Storage.setItem(SK_USER_ID, userData.id);
    await Storage.setItem(SK_USER_NAME, userData.name);
    await Storage.setItem(SK_USER_ROLE, userData.role);
    await Storage.setItem(SK_PHONE, userData.norm);
    if (userData.role === 'admin') await Storage.setItem(SK_ADMIN, 'true');
    onSuccess({ id: userData.id, name: userData.name, role: userData.role });
  };

  const handlePinSubmit = async () => {
    if (!userData) { setError('Sessionsfel. Börja om.'); setStep('phone'); return; }
    setLoading(true); setError('');
    const pinHash = sha256(userData.norm + ':' + pin);
    if (pinHash !== userData.pin_hash) { setLoading(false); setError('Fel PIN-kod.'); setPin(''); return; }
    await supabase.from('app_users').update({ last_login: Date.now() }).eq('id', userData.id);
    setLoading(false);
    await Storage.setItem(SK_USER_ID, userData.id);
    await Storage.setItem(SK_USER_NAME, userData.name);
    await Storage.setItem(SK_USER_ROLE, userData.role);
    await Storage.setItem(SK_PHONE, userData.norm);
    if (userData.role === 'admin') await Storage.setItem(SK_ADMIN, 'true');
    else await Storage.removeItem(SK_ADMIN);
    onSuccess({ id: userData.id, name: userData.name, role: userData.role });
  };

  const iconBg = { width: 56, height: 56, borderRadius: 28, backgroundColor: T.accent + '22', alignItems: 'center' as const, justifyContent: 'center' as const, alignSelf: 'center' as const, marginBottom: 14 };
  const inp = { backgroundColor: T.card, borderWidth: 1, borderColor: T.borderStrong, borderRadius: 12, padding: 14, fontSize: 18, color: T.text };
  const btn = { marginTop: 16, backgroundColor: T.accent, borderRadius: 12, padding: 14, alignItems: 'center' as const };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 40 }}>
        <View style={{ maxWidth: 340, alignSelf: 'center', width: '100%', marginTop: 24 }}>

          {step === 'phone' && (
            <>
              <View style={{ alignItems: 'center', marginBottom: 24 }}>
                <View style={iconBg}>
                  <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                    <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    <Circle cx="12" cy="7" r="4" stroke={T.accent} strokeWidth="1.8"/>
                  </Svg>
                </View>
                <Text style={{ fontSize: 20, fontWeight: '700', color: T.text }}>Åtkomst för behöriga</Text>
                <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Ange ditt telefonnummer</Text>
              </View>
              <TextInput
                style={inp} value={phone} onChangeText={t => { setPhone(t); setError(''); }}
                placeholder="07X-XXX XX XX" placeholderTextColor={T.textMuted}
                selectionColor={T.accent}
                keyboardType="phone-pad" returnKeyType="done" onSubmitEditing={handlePhoneNext}
                textContentType="telephoneNumber" autoComplete="tel"
              />
              {!!error && <View style={styles.errorBox}><Text style={{ color: T.error, fontSize: 13 }}>{error}</Text></View>}
              <TouchableOpacity style={btn} onPress={handlePhoneNext} disabled={loading}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{loading ? 'Kontrollerar...' : 'Fortsätt →'}</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'invite' && (
            <>
              <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <View style={iconBg}>
                  <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                    <Rect x="3" y="11" width="18" height="11" rx="2" stroke={T.accent} strokeWidth="1.8"/>
                    <Path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round"/>
                  </Svg>
                </View>
                <Text style={{ fontSize: 20, fontWeight: '700', color: T.text }}>Välkommen, {userData?.name}</Text>
                <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Ange din 6-siffriga inbjudningskod</Text>
              </View>
              {/* Code display — 6 boxes */}
              <TouchableOpacity activeOpacity={1} onPress={() => pinInputRef.current?.focus()} style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={i} style={{
                    width: 38, height: 46, borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: i < inviteCode.length ? T.accent : T.border,
                    backgroundColor: T.card,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: T.text }}>
                      {inviteCode[i] ?? ''}
                    </Text>
                  </View>
                ))}
              </TouchableOpacity>
              {!!error && <View style={styles.errorBox}><Text style={{ color: T.error, fontSize: 13 }}>{error}</Text></View>}
              <TextInput
                ref={pinInputRef}
                value={inviteCode}
                onChangeText={v => { setInviteCode(v); setError(''); if (v.length === 6) setTimeout(() => handleInviteSubmit(v), 80); }}
                keyboardType="phone-pad"
                maxLength={6}
                caretHidden
                style={{ height: 1, opacity: 0 }}
              />
              <TouchableOpacity style={[btn, { marginTop: 8 }]} onPress={handleInviteSubmit} disabled={loading || inviteCode.length < 6}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{loading ? 'Kontrollerar...' : 'Verifiera kod →'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: 10, padding: 12, alignItems: 'center' }} onPress={() => { setStep('phone'); setError(''); setInviteCode(''); }}>
                <Text style={{ color: T.textMuted, fontSize: 13 }}>← Byt telefonnummer</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'setpin' && (
            <>
              <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <View style={iconBg}>
                  <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                    <Rect x="3" y="11" width="18" height="11" rx="2" stroke={T.accent} strokeWidth="1.8"/>
                    <Path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round"/>
                  </Svg>
                </View>
                <Text style={{ fontSize: 20, fontWeight: '700', color: T.text }}>Välj PIN-kod</Text>
                <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>
                  {setpinPhase === 'first' ? 'Ange minst 4 siffror' : 'Upprepa PIN-koden'}
                </Text>
              </View>
              {/* Dot display */}
              <TouchableOpacity activeOpacity={1} onPress={() => pinInputRef.current?.focus()} style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 8 }}>
                {Array.from({ length: 6 }).map((_, i) => {
                  const current = setpinPhase === 'first' ? newPin : newPin2;
                  return (
                    <View key={i} style={{
                      width: 14, height: 14, borderRadius: 7,
                      backgroundColor: i < current.length ? T.text : 'transparent',
                      borderWidth: 1.5,
                      borderColor: i < current.length ? T.text : T.border,
                    }} />
                  );
                })}
              </TouchableOpacity>
              {!!error && <View style={styles.errorBox}><Text style={{ color: T.error, fontSize: 13 }}>{error}</Text></View>}
              <TextInput
                ref={pinInputRef}
                value={setpinPhase === 'first' ? newPin : newPin2}
                onChangeText={v => { setError(''); if (setpinPhase === 'first') setNewPin(v); else setNewPin2(v); }}
                keyboardType="phone-pad"
                maxLength={6}
                caretHidden
                style={{ height: 1, opacity: 0 }}
              />
              {setpinPhase === 'first' ? (
                <TouchableOpacity
                  style={[btn, { marginTop: 8, opacity: newPin.length >= 4 ? 1 : 0.45 }]}
                  onPress={() => { if (newPin.length >= 4) setSetpinPhase('second'); else setError('PIN måste vara minst 4 siffror.'); }}
                  disabled={loading}
                >
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Fortsätt →</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={[btn, { marginTop: 8 }]} onPress={handleSetPin} disabled={loading}>
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{loading ? 'Sparar...' : 'Spara PIN & logga in'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ marginTop: 10, padding: 12, alignItems: 'center' }} onPress={() => { setSetpinPhase('first'); setNewPin2(''); setError(''); }}>
                    <Text style={{ color: T.textMuted, fontSize: 13 }}>← Ändra PIN</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {step === 'pin' && (
            <>
              <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <View style={iconBg}>
                  <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                    <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    <Circle cx="12" cy="7" r="4" stroke={T.accent} strokeWidth="1.8"/>
                  </Svg>
                </View>
                <Text style={{ fontSize: 20, fontWeight: '700', color: T.text }}>Välkommen, {userData?.name}</Text>
                <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Ange din PIN-kod</Text>
              </View>
              {/* Dot display */}
              <TouchableOpacity activeOpacity={1} onPress={() => pinInputRef.current?.focus()} style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 8 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={i} style={{
                    width: 14, height: 14, borderRadius: 7,
                    backgroundColor: i < pin.length ? T.text : 'transparent',
                    borderWidth: 1.5,
                    borderColor: i < pin.length ? T.text : T.border,
                  }} />
                ))}
              </TouchableOpacity>
              {!!error && <View style={styles.errorBox}><Text style={{ color: T.error, fontSize: 13 }}>{error}</Text></View>}
              <TextInput
                ref={pinInputRef}
                value={pin}
                onChangeText={v => {
                  setPin(v); setError('');
                  if (v.length >= 4 && userData?.pin_hash) {
                    const hash = sha256(userData.norm + ':' + v);
                    if (hash === userData.pin_hash) {
                      setLoading(true);
                      supabase.from('app_users').update({ last_login: Date.now() }).eq('id', userData.id).then(() => {
                        setLoading(false);
                        Storage.setItem(SK_USER_ID, userData.id);
                        Storage.setItem(SK_USER_NAME, userData.name);
                        Storage.setItem(SK_USER_ROLE, userData.role);
                        Storage.setItem(SK_PHONE, userData.norm);
                        if (userData.role === 'admin') Storage.setItem(SK_ADMIN, 'true');
                        else Storage.removeItem(SK_ADMIN);
                        onSuccess({ id: userData.id, name: userData.name, role: userData.role });
                      });
                    }
                  }
                }}
                keyboardType="phone-pad"
                maxLength={6}
                caretHidden
                style={{ height: 1, opacity: 0 }}
              />
              {!!error && (
                <TouchableOpacity style={[btn, { marginTop: 8 }]} onPress={handlePinSubmit} disabled={loading}>
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{loading ? 'Loggar in...' : 'Logga in'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={{ marginTop: 10, padding: 12, alignItems: 'center' }}
                onPress={() => { setStep('phone'); setPhone(''); setPin(''); setError(''); setUserData(null); }}>
                <Text style={{ color: T.textMuted, fontSize: 13 }}>← Byt konto</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Year View ─────────────────────────────────────────────────────────────────
function YearView({
  visible, initialYear, today, onSelectMonth, onClose, T,
}: {
  visible: boolean; initialYear: number; today: Date;
  onSelectMonth: (year: number, month: number) => void;
  onClose: () => void;
  T: any;
}) {
  const minYear = today.getFullYear();
  const maxYear = today.getFullYear() + 3;
  const [year, setYear] = useState(initialYear);
  const { width } = Dimensions.get('window');
  const slideAnim = useRef(new Animated.Value(0)).current;
  const yearAnimating = useRef(false);

  useEffect(() => {
    if (visible) setYear(initialYear);
  }, [visible, initialYear]);

  const canGoBack = year > minYear;
  const canGoForward = year < maxYear;

  const navigateYear = (dir: number) => {
    if (yearAnimating.current) return;
    const next = year + dir;
    if (next < minYear || next > maxYear) return;
    yearAnimating.current = true;
    const outX = dir > 0 ? -width : width;
    Animated.timing(slideAnim, { toValue: outX, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.quad) }).start(() => {
      setYear(next);
      slideAnim.setValue(-outX);
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start(() => { yearAnimating.current = false; });
    });
  };

  const months = useMemo(() =>
    Array.from({ length: 12 }, (_, m) => ({ month: m, grid: getMonthGrid(year, m) })),
    [year]
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: T.border }}>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Text style={{ color: T.accent, fontSize: 15, fontWeight: '600' }}>Stäng</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }}>{year}</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <TouchableOpacity
              onPress={() => navigateYear(-1)}
              disabled={!canGoBack}
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: canGoBack ? 1 : 0.3 }}
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Polyline points="15 18 9 12 15 6" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigateYear(1)}
              disabled={!canGoForward}
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: canGoForward ? 1 : 0.3 }}
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Polyline points="9 18 15 12 9 6" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            </TouchableOpacity>
          </View>
        </View>
        <Animated.ScrollView
          style={{ transform: [{ translateX: slideAnim }] }}
          contentContainerStyle={{ padding: 8, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {months.map(({ month, grid }) => {
              const isThisMonth = year === today.getFullYear() && month === today.getMonth();
              return (
                <TouchableOpacity
                  key={month}
                  onPress={() => onSelectMonth(year, month)}
                  activeOpacity={0.7}
                  style={{ width: '50%', padding: 6 }}
                >
                  <View style={{ backgroundColor: T.card, borderRadius: 12, borderWidth: 0.5, borderColor: T.border, padding: 10 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 6, color: isThisMonth ? '#FF3B30' : T.text }}>
                      {MONTHS_SV[month]}
                    </Text>
                    <View style={{ flexDirection: 'row' }}>
                      {DAYS_SV.map((d, i) => (
                        <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                          <Text style={{ fontSize: 8, fontWeight: '700', color: T.textMuted }}>{d}</Text>
                        </View>
                      ))}
                    </View>
                    {grid.map((row, ri) => (
                      <View key={ri} style={{ flexDirection: 'row' }}>
                        {row.map((d, ci) => {
                          if (!d) return <View key={ci} style={{ flex: 1, height: 16 }} />;
                          const isTodayCell = d.getTime() === today.getTime();
                          return (
                            <View key={ci} style={{ flex: 1, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                              {isTodayCell ? (
                                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' }}>
                                  <Text style={{ fontSize: 9, fontWeight: '700', color: '#fff' }}>{d.getDate()}</Text>
                                </View>
                              ) : (
                                <Text style={{ fontSize: 9, color: T.text }}>{d.getDate()}</Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.ScrollView>
      </View>
    </Modal>
  );
}

// ─── Calendar Grid ─────────────────────────────────────────────────────────────
function CalendarView({
  bookings, exceptions, selectedDate, onSelectDate, T,
}: {
  bookings: any[]; exceptions: any[];
  selectedDate: Date; onSelectDate: (d: Date) => void; T: any;
}) {
  const { width } = Dimensions.get('window');
  const today = useMemo(() => { const t = new Date(); t.setHours(0,0,0,0); return t; }, []);
  const [anchor, setAnchor] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));

  useEffect(() => {
    const needed = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    if (needed.getTime() !== anchor.getTime()) {
      setAnchor(needed);
    }
  }, [selectedDate]);
  const monthGrid = useMemo(() => getMonthGrid(anchor.getFullYear(), anchor.getMonth()), [anchor]);

  const wS = useMemo(() => toISO(anchor), [anchor]);
  const wE = useMemo(() => {
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return toISO(last);
  }, [anchor]);

  const bookedDays = useMemo(() => {
    const set = new Set<number>();
    expandAll(bookings, exceptions, wS, wE).forEach(o => set.add(parseInt(o.date.split('-')[2])));
    return set;
  }, [bookings, exceptions, wS, wE]);

  const isCurrentMonth = anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();

  const monthTranslateX = useRef(new Animated.Value(0)).current;
  const monthOpacity    = useRef(new Animated.Value(1)).current;
  const gridTranslateX  = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);
  const [showYearView, setShowYearView] = useState(false);

  const navigate = (dir: number) => {
    if (animating.current) return;
    animating.current = true;
    const outX = dir > 0 ? -width : width;
    Animated.parallel([
      Animated.timing(monthOpacity,    { toValue: 0,         duration: 100, useNativeDriver: true }),
      Animated.timing(monthTranslateX, { toValue: outX * 0.35, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
      Animated.timing(gridTranslateX,  { toValue: outX,        duration: 180, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
    ]).start(() => {
      setAnchor(prev => {
        const next = new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
        const isCurr = next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth();
        onSelectDate(isCurr ? today : next);
        return next;
      });
      monthTranslateX.setValue(-outX * 0.35);
      monthOpacity.setValue(0);
      gridTranslateX.setValue(-outX);
      Animated.parallel([
        Animated.timing(monthOpacity,    { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(monthTranslateX, { toValue: 0, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.timing(gridTranslateX,  { toValue: 0, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      ]).start(() => { animating.current = false; });
    });
  };

  const goToToday = () => {
    setAnchor(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelectDate(today);
  };

  const swipePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 12 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
    onPanResponderMove: (_, gs) => {
      if (!animating.current) gridTranslateX.setValue(gs.dx * 0.3);
    },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > 50) navigate(-1);
      else if (gs.dx < -50) navigate(1);
      else Animated.spring(gridTranslateX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    },
  })).current;

  return (
    <View style={{ backgroundColor: T.bg, paddingBottom: 4 }} {...swipePan.panHandlers}>
      {/* Header row 1: year (opens YearView) + nav arrows */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 }}>
        <TouchableOpacity onPress={() => setShowYearView(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
            <Polyline points="15 18 9 12 15 6" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
          <Text style={{ fontSize: 15, fontWeight: '700', color: T.accent }}>{anchor.getFullYear()}</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <TouchableOpacity onPress={() => navigate(-1)} style={[styles.navBtn, { borderColor: T.border }]}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Polyline points="15 18 9 12 15 6" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigate(1)} style={[styles.navBtn, { borderColor: T.border }]}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Polyline points="9 18 15 12 9 6" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        </View>
      </View>
      {/* Header row 2: large animated month name */}
      <Animated.Text style={{ fontSize: 26, fontWeight: '800', color: T.text, paddingHorizontal: 16, paddingBottom: 6, transform: [{ translateX: monthTranslateX }], opacity: monthOpacity }}>
        {MONTHS_SV[anchor.getMonth()]}
      </Animated.Text>

      {/* Day headers — week-number spacer + day initials */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 8, marginBottom: 2 }}>
        <View style={{ width: WK_COL_W }} />
        {DAYS_SV.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: T.textMuted, letterSpacing: 0.3 }}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Grid */}
      <Animated.View style={{ transform: [{ translateX: gridTranslateX }] }}>
        {monthGrid.map((row, ri) => {
          // Use the first non-null date in the row to determine the ISO week number.
          // This is always the Monday-aligned date, ensuring correctness across month and year boundaries.
          const firstDate = row.find(d => d !== null) ?? null;
          const weekNum = firstDate ? getISOWeek(firstDate) : null;
          return (
            <View key={ri} style={{ flexDirection: 'row', paddingHorizontal: 8, alignItems: 'center' }}>
              {/* Week number — subtle, integrated, always aligned with the row */}
              <View style={{ width: WK_COL_W, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 }}>
                <Text style={{
                  fontSize: 10, fontWeight: '500',
                  color: T.textMuted,
                  opacity: T.isDark ? 0.45 : 0.55,
                  letterSpacing: 0.2,
                }}>
                  {weekNum ?? ''}
                </Text>
              </View>
              {row.map((d, ci) => {
                if (!d) return <View key={ci} style={{ flex: 1 }} />;
                const isToday = d.getTime() === today.getTime();
                const isSel   = toISO(d) === toISO(selectedDate);
                const hasB    = bookedDays.has(d.getDate());
                // Priority: selected > today > plain
                const chipBg    = isSel ? T.accent : isToday ? '#FF3B30' : 'transparent';
                const chipColor = isSel || isToday ? '#fff' : T.text;
                return (
                  <TouchableOpacity
                    key={ci}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}
                    onPress={() => { onSelectDate(d); setAnchor(new Date(d.getFullYear(), d.getMonth(), 1)); }}
                    activeOpacity={0.7}
                  >
                    {/* iOS 26-style circular chip — equal width/height, full borderRadius */}
                    <View style={{
                      width: 36, height: 36, borderRadius: 18,
                      alignItems: 'center', justifyContent: 'center',
                      backgroundColor: chipBg,
                    }}>
                      <Text style={{
                        fontSize: 15,
                        fontWeight: isSel || isToday ? '700' : '400',
                        color: chipColor,
                      }}>{d.getDate()}</Text>
                    </View>
                    {/* Booking dot — always occupies same space (4px) to keep rows uniform */}
                    <View style={{
                      width: 4, height: 4, borderRadius: 2, marginTop: 2,
                      backgroundColor: hasB ? (isSel || isToday ? '#fff' : T.accent) : 'transparent',
                    }} />
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </Animated.View>

      {/* Legend + Idag button */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent }} />
            <Text style={{ fontSize: 11, color: T.textMuted, fontWeight: '500' }}>Bokad</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' }} />
            <Text style={{ fontSize: 11, color: T.textMuted, fontWeight: '500' }}>Idag</Text>
          </View>
        </View>
        {/* Show Idag when:
            - viewing a different month (need to navigate back), OR
            - in current month but a date other than today is selected */}
        {(!isCurrentMonth || toISO(selectedDate) !== toISO(today)) && (
          <TouchableOpacity
            onPress={goToToday}
            style={{ borderRadius: 14, paddingHorizontal: 12, height: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF3B30' }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Idag</Text>
          </TouchableOpacity>
        )}
      </View>

      <YearView
        visible={showYearView}
        initialYear={anchor.getFullYear()}
        today={today}
        onSelectMonth={(y, m) => {
          const target = new Date(y, m, 1);
          setAnchor(target);
          const isCurr = target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth();
          onSelectDate(isCurr ? today : target);
          setShowYearView(false);
        }}
        onClose={() => setShowYearView(false)}
        T={T}
      />
    </View>
  );
}

// ─── Day Panel ─────────────────────────────────────────────────────────────────
function DayPanel({
  date, bookings, exceptions, myBookingIds, isAdmin, onAdd, onCancelOccurrence, onAdminDelete, onPressRow, T,
}: {
  date: Date; bookings: any[]; exceptions: any[];
  myBookingIds: Set<string>; isAdmin: boolean;
  onAdd: () => void;
  onCancelOccurrence: (booking: any, date: string | null) => void;
  onAdminDelete: (occ: any) => void;
  onPressRow: (occ: any, booking: any) => void;
  T: any;
}) {
  const iso = toISO(date);
  const isToday = iso === toISO(new Date());
  const isPast = iso < toISO(new Date());
  const [showPastTooltip, setShowPastTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const occs = useMemo(() =>
    getOccurrencesForDate(bookings, exceptions, iso)
      .sort((a, b) => {
        const aStart = parseSlotParts(a.time_slot || '').startDecimal || 0;
        const bStart = parseSlotParts(b.time_slot || '').startDecimal || 0;
        return aStart - bStart;
      }),
    [bookings, exceptions, iso]);

  const handleAddPress = useCallback(() => {
    if (isPast) {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      setShowPastTooltip(true);
      tooltipTimer.current = setTimeout(() => setShowPastTooltip(false), 2500);
    } else {
      onAdd();
    }
  }, [isPast, onAdd]);

  useEffect(() => () => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); }, []);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 0.5, borderColor: T.separator }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: T.textMuted }}>
          {DAYS_FULL[(date.getDay() + 6) % 7]}, {isoToDisplay(iso)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {(Storage.getItem(SK_USER_ID) || isAdmin) && (
            <View>
              <TouchableOpacity
                onPress={handleAddPress}
                style={{
                  width: 34, height: 34, borderRadius: 17,
                  backgroundColor: isPast ? T.cardSecondary : T.accent,
                  alignItems: 'center', justifyContent: 'center',
                }}
                activeOpacity={isPast ? 0.5 : 0.7}
              >
                <Text style={{ color: isPast ? T.textMuted : '#fff', fontSize: 22, fontWeight: '300', lineHeight: 26 }}>+</Text>
              </TouchableOpacity>
              {showPastTooltip && (
                <View style={{
                  position: 'absolute', right: 0, top: 40,
                  backgroundColor: T.card, borderRadius: 10,
                  borderWidth: 0.5, borderColor: T.border,
                  paddingHorizontal: 12, paddingVertical: 8,
                  shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
                  zIndex: 100, minWidth: 210,
                }}>
                  <Text style={{ fontSize: 13, color: T.text, fontWeight: '500' }}>
                    Bokning kan endast göras för{'\n'}dagens datum och framåt.
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}>
        {occs.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={{ fontSize: 15, color: T.textMuted }}>Inga bokningar detta datum</Text>
          </View>
        ) : (
          occs.map((occ, idx) => {
            const booking = bookings.find(b => b.id === occ.id);
            if (!booking) return null;
            const isOwn = myBookingIds.has(occ.id);
            const canDelete = isOwn || isAdmin;
            return (
              <DayPanelRow
                key={occ.id + '_' + occ.date + '_' + idx}
                occ={occ} booking={booking}
                isOwn={isOwn} isAdmin={isAdmin}
                canDelete={canDelete}
                onCancel={() => onCancelOccurrence(booking, booking.recurrence !== 'none' ? occ.date : null)}
                onAdminDelete={() => onAdminDelete(occ)}
                onPress={() => onPressRow(occ, booking)}
                T={T}
              />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ─── Booking Detail Modal ──────────────────────────────────────────────────────
function BookingDetailModal({
  occ, booking, isAdmin, isOwn, onClose, onCancel, onApprove, onReject, onDelete, onDeleteOccurrence, T,
}: {
  occ: any; booking: any; isAdmin: boolean; isOwn: boolean;
  onClose: () => void;
  onCancel: () => void;
  onApprove: (id: string, comment: string) => void;
  onReject: (id: string, comment: string) => void;
  onDelete: (id: string, reason: string) => void;
  onDeleteOccurrence: (bookingId: string, date: string, reason: string) => void;
  T: any;
}) {
  const [comment, setComment] = useState('');
  const [actionMode, setActionMode] = useState<'approve' | 'reject' | null>(null);
  const [cancelMode, setCancelMode] = useState<'occurrence' | 'series' | 'single' | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const slideAnim = useRef(new Animated.Value(600)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const dragY     = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(Animated.add(slideAnim, dragY)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 340, useNativeDriver: true, easing: (t: number) => 1 - Math.pow(1 - t, 3) }),
      Animated.timing(fadeAnim,  { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(dragY,    { toValue: 600, duration: 260, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 0,   duration: 220, useNativeDriver: true }),
    ]).start(() => onClose());
  }, [onClose]);

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { dragY.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 110 || g.vy > 0.5) {
        dismiss();
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start();
      }
    },
  })).current;

  const status = occ.status || booking.status;
  const isPending = status === 'pending' || status === 'edit_pending';
  const canCancel = isOwn && (status === 'approved' || status === 'pending' || status === 'edited');

  const inp = { backgroundColor: T.cardElevated, borderWidth: 0.5, borderColor: T.border, borderRadius: 10, padding: 12, fontSize: 15, color: T.text, marginTop: 8 };

  const Row = ({ label, value }: { label: string; value: string }) => value ? (
    <View style={{ flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 0.5, borderColor: T.separator }}>
      <Text style={{ fontSize: 13, color: T.textMuted, width: 100 }}>{label}</Text>
      <Text style={{ fontSize: 13, color: T.text, flex: 1, fontWeight: '500' }}>{value}</Text>
    </View>
  ) : null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismiss} />
        </Animated.View>
        <Animated.View style={{ backgroundColor: T.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 40, transform: [{ translateY: sheetTranslateY }] }}>
        {/* Handle bar — drag down to dismiss */}
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }} {...panResponder.panHandlers}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.borderStrong }} />
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 36 }} />
        </View>

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}>
          <View style={{ flex: 1 }}>
            {(isAdmin || isOwn) ? (
              <Text style={{ fontSize: 18, fontWeight: '800', color: T.text, letterSpacing: -0.3 }}>{occ.activity}</Text>
            ) : (
              <Text style={{ fontSize: 18, fontWeight: '800', color: T.text, letterSpacing: -0.3 }}>{occ.time_slot}</Text>
            )}
            <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 2 }}>
              {DAYS_FULL[(parseISO(occ.date).getDay() + 6) % 7]}, {isoToDisplay(occ.date)}
            </Text>
          </View>
          <StatusBadge status={status} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Info rows */}
          <View style={{ backgroundColor: T.card, borderRadius: 14, paddingHorizontal: 14, borderWidth: 0.5, borderColor: T.border, marginBottom: 16 }}>
            <Row label="Tid" value={occ.time_slot} />
            <Row label="Bokad av" value={occ.name || ''} />
            {(isAdmin || isOwn) && <Row label="Längd" value={booking.duration_hours ? fmtDuration(booking.duration_hours) : ''} />}
            {isAdmin && <Row label="Telefon" value={booking.phone || ''} />}
            {(isAdmin || isOwn) && booking.recurrence && booking.recurrence !== 'none' && (
              <Row label="Upprepning" value={fmtRecur(booking.recurrence)} />
            )}
            {(isAdmin || isOwn) && booking.end_date && <Row label="Slutdatum" value={isoToDisplay(booking.end_date)} />}
            {(isAdmin || isOwn) && occ.notes ? <Row label="Anteckningar" value={occ.notes} /> : null}
            {isAdmin && occ.admin_comment ? <Row label="Admin-komm." value={occ.admin_comment} /> : null}
            {(isAdmin || isOwn) && (
            <View style={{ paddingVertical: 10 }}>
              <Text style={{ fontSize: 13, color: T.textMuted }}>Skapad</Text>
              <Text style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>
                {booking.created_at ? new Date(booking.created_at).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' }) : '–'}
              </Text>
            </View>
            )}
          </View>

          {/* Admin comment input (for approve/reject flow) */}
          {actionMode && (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>
                {actionMode === 'approve' ? 'Kommentar till godkännande (valfritt)' : 'Anledning till avböjning (valfritt)'}
              </Text>
              <TextInput
                style={inp}
                value={comment}
                onChangeText={setComment}
                placeholder="Skriv en kommentar..."
                placeholderTextColor={T.textTertiary}
                multiline
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 12, borderWidth: 0.5, borderColor: T.border, alignItems: 'center' }} onPress={() => setActionMode(null)}>
                  <Text style={{ color: T.text, fontWeight: '600' }}>Avbryt</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, padding: 13, borderRadius: 12, backgroundColor: actionMode === 'approve' ? '#34C759' : T.error, alignItems: 'center' }}
                  onPress={() => { actionMode === 'approve' ? onApprove(booking.id, comment) : onReject(booking.id, comment); onClose(); }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{actionMode === 'approve' ? 'Godkänn' : 'Avböj'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Admin actions */}
          {isAdmin && isPending && !actionMode && (
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: '#34C75922', borderRadius: 12, padding: 13, alignItems: 'center' }} onPress={() => setActionMode('approve')}>
                <Text style={{ color: '#34C759', fontWeight: '700' }}>✓ Godkänn</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: '#FF3B3022', borderRadius: 12, padding: 13, alignItems: 'center' }} onPress={() => setActionMode('reject')}>
                <Text style={{ color: '#FF3B30', fontWeight: '700' }}>✗ Avböj</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Admin avboka — only for approved/edited, not pending */}
          {isAdmin && !actionMode && (booking.status === 'approved' || booking.status === 'edited') && (
            cancelMode ? (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 6 }}>
                  {cancelMode === 'occurrence' ? 'Orsak till avbokning av tillfälle (obligatorisk)' : 'Orsak till avbokning (obligatorisk)'}
                </Text>
                <TextInput
                  style={{ backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 10, padding: 10, fontSize: 14, color: T.text, marginBottom: 8, height: 64, textAlignVertical: 'top' }}
                  value={cancelReason}
                  onChangeText={setCancelReason}
                  placeholder="Ange orsak..."
                  placeholderTextColor={T.textMuted}
                  multiline
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={{ flex: 1, padding: 12, borderRadius: 12, borderWidth: 0.5, borderColor: T.border, alignItems: 'center' }} onPress={() => { setCancelMode(null); setCancelReason(''); }}>
                    <Text style={{ color: T.text, fontWeight: '600' }}>Avbryt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: cancelReason.trim() ? '#FF3B30' : '#FF3B3044', alignItems: 'center' }}
                    disabled={!cancelReason.trim()}
                    onPress={() => {
                      const r = cancelReason.trim();
                      if (cancelMode === 'occurrence') { onDeleteOccurrence(booking.id, occ.date, r); }
                      else { onDelete(booking.id, r); }
                      setCancelMode(null); setCancelReason(''); onClose();
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Bekräfta avbokning</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : booking.recurrence && booking.recurrence !== 'none' ? (
              <View style={{ gap: 8, marginBottom: 10 }}>
                <TouchableOpacity
                  style={{ borderWidth: 0.5, borderColor: T.error + '55', borderRadius: 12, padding: 13, alignItems: 'center' }}
                  onPress={() => { setCancelMode('occurrence'); setCancelReason(''); }}
                >
                  <Text style={{ color: T.error, fontWeight: '600' }}>Avboka detta tillfälle</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ borderWidth: 0.5, borderColor: T.error + '88', borderRadius: 12, padding: 13, alignItems: 'center' }}
                  onPress={() => { setCancelMode('series'); setCancelReason(''); }}
                >
                  <Text style={{ color: T.error, fontWeight: '700' }}>Avboka hela serien</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={{ borderWidth: 0.5, borderColor: T.error + '55', borderRadius: 12, padding: 13, alignItems: 'center', marginBottom: 10 }}
                onPress={() => { setCancelMode('single'); setCancelReason(''); }}
              >
                <Text style={{ color: T.error, fontWeight: '600' }}>Avboka bokning</Text>
              </TouchableOpacity>
            )
          )}

          {/* User cancel — hidden for admins who use the admin cancel flow above */}
          {canCancel && !isAdmin && !actionMode && (
            <TouchableOpacity
              style={{ borderWidth: 1, borderColor: T.error + '44', borderRadius: 12, padding: 13, alignItems: 'center' }}
              onPress={() => { onCancel(); onClose(); }}
            >
              <Text style={{ color: T.error, fontWeight: '600' }}>Avboka</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DayPanelRow({
  occ, booking, isOwn, isAdmin, canDelete, onCancel, onAdminDelete, onPress, T,
}: {
  occ: any; booking: any; isOwn: boolean; isAdmin: boolean; canDelete: boolean;
  onCancel: () => void; onAdminDelete: () => void; onPress: () => void; T: any;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [revealed, setRevealed] = useState(false);

  const panResponder = useMemo(() => {
    if (!canDelete) return PanResponder.create({});
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => { translateX.stopAnimation(); },
      onPanResponderMove: (_, g) => {
        const base = revealed ? -72 : 0;
        const val = Math.max(-72, Math.min(0, base + g.dx));
        translateX.setValue(val);
      },
      onPanResponderRelease: (_, g) => {
        const cur = revealed ? -72 + g.dx : g.dx;
        if (cur < -36) {
          Animated.spring(translateX, { toValue: -72, useNativeDriver: true }).start();
          setRevealed(true);
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          setRevealed(false);
        }
      },
    });
  }, [canDelete, revealed]);

  const handleDelete = () => {
    Animated.timing(translateX, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setRevealed(false));
    if (isAdmin) onAdminDelete();
    else onCancel();
  };

  return (
    <View style={{ marginBottom: 10, borderRadius: 12, overflow: 'hidden', backgroundColor: T.card }}>
      {/* Swipe action background */}
      {canDelete && (
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 72, backgroundColor: T.error, alignItems: 'center', justifyContent: 'center' }}>
          <TouchableOpacity onPress={handleDelete} style={{ alignItems: 'center', gap: 2 }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Polyline points="3 6 5 6 21 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <Path d="M19 6l-1 14H6L5 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff' }}>Radera</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* Row content */}
      <Animated.View
        style={{ transform: [{ translateX }], backgroundColor: T.card }}
        {...(canDelete ? panResponder.panHandlers : {})}
      >
        {/* Non-admin viewing someone else's booking: show only time + name, not tappable */}
        {!isAdmin && !isOwn ? (
          <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: T.text }}>{occ.time_slot}</Text>
              {occ.name && <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{occ.name}</Text>}
            </View>
            <StatusBadge status={occ.status || booking.status} />
          </View>
        ) : (
          <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: T.text }}>{occ.activity}</Text>
                  <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{occ.time_slot}{booking.duration_hours ? ' · ' + fmtDuration(booking.duration_hours) : ''}</Text>
                  {occ.name && <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{occ.name}</Text>}
                  {booking.recurrence && booking.recurrence !== 'none' && (
                    <Text style={{ fontSize: 10, color: '#8b5cf6', marginTop: 2 }}>{fmtRecur(booking.recurrence)}</Text>
                  )}
                  {occ.notes && <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2, fontStyle: 'italic' }}>{occ.notes}</Text>}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <StatusBadge status={occ.status || booking.status} />
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                    <Polyline points="9 18 15 12 9 6" stroke={T.textTertiary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </Svg>
                </View>
              </View>
              {isAdmin && occ.admin_comment ? (
                <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 6, fontStyle: 'italic' }}>{occ.admin_comment}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
}

// ─── Slide navigation (identical pattern to dhikr/asmaul) ────────────────────
const SCREEN_W = Dimensions.get('window').width;

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
  const goBack = useCallback(() => {
    Animated.timing(translateX, { toValue: SCREEN_W, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onClose);
  }, [onClose]);
  return { translateX, edgePan, goBack };
}

// ─── Mini Calendar ────────────────────────────────────────────────────────────
function MiniCalendar({
  selectedDate, onSelect, bookings, exceptions, T,
}: {
  selectedDate: Date;
  onSelect: (d: Date) => void;
  bookings: any[];
  exceptions: any[];
  T: any;
}) {
  const [anchor, setAnchor] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
  );
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const grid  = useMemo(() => getMonthGrid(anchor.getFullYear(), anchor.getMonth()), [anchor]);

  const navigate = (dir: -1 | 1) =>
    setAnchor(a => new Date(a.getFullYear(), a.getMonth() + dir, 1));

  return (
    <View style={{ backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 14, padding: 12, marginBottom: 14 }}>
      {/* Month header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <TouchableOpacity onPress={() => navigate(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 0.5, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Polyline points="15 18 9 12 15 6" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
        </TouchableOpacity>
        <Text style={{ fontSize: 14, fontWeight: '700', color: T.text }}>
          {MONTHS_SV[anchor.getMonth()]} {anchor.getFullYear()}
        </Text>
        <TouchableOpacity onPress={() => navigate(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 0.5, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Polyline points="9 18 15 12 9 6" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
        </TouchableOpacity>
      </View>

      {/* Day initials */}
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {DAYS_SV.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: T.textMuted }}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Date grid */}
      {grid.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', marginBottom: 2 }}>
          {row.map((cell, ci) => {
            if (!cell) return <View key={ci} style={{ flex: 1 }} />;
            const cellIso   = toISO(cell);
            const isSelected = cellIso === toISO(selectedDate);
            const isToday    = cellIso === toISO(today);
            const isPast     = cell < today;
            const hasB       = hasBookingsOnDate(bookings, exceptions, cellIso);
            return (
              <TouchableOpacity
                key={ci}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 2 }}
                onPress={() => { if (!isPast) onSelect(new Date(cell)); }}
                activeOpacity={isPast ? 1 : 0.7}
                disabled={isPast}
              >
                <View style={{
                  width: 32, height: 32, borderRadius: 16,
                  backgroundColor: isSelected ? T.accent : isToday ? '#FF3B30' : 'transparent',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{
                    fontSize: 13,
                    fontWeight: isSelected || isToday ? '700' : '400',
                    color: isSelected || isToday ? '#fff' : isPast ? T.textMuted : T.text,
                    opacity: isPast ? 0.35 : 1,
                  }}>
                    {cell.getDate()}
                  </Text>
                </View>
                <View style={{
                  width: 4, height: 4, borderRadius: 2, marginTop: 1,
                  backgroundColor: hasB && !isSelected ? T.accent : 'transparent',
                }} />
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Booking Form ──────────────────────────────────────────────────────────────
function BookingForm({
  date, bookings, exceptions, onSubmit, onBack, loading, T,
}: {
  date: Date; bookings: any[]; exceptions: any[];
  onSubmit: (data: any) => void; onBack: () => void; loading: boolean; T: any;
}) {
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onBack);
  const accentText = T.isDark ? '#4ECDC4' : T.accent;
  const userName = Storage.getItem(SK_USER_NAME) || '';
  const userPhone = Storage.getItem(SK_PHONE) || '';
  const [formDate, setFormDate] = useState<Date>(date);
  const iso = toISO(formDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [allDay, setAllDay] = useState(false);
  const [startH, setStartH] = useState(OPEN_HOUR);
  const [startM, setStartM] = useState(0);
  const [endH, setEndH] = useState(OPEN_HOUR + 1);
  const [endM, setEndM] = useState(0);
  const [activity, setActivity] = useState('');
  const [notes, setNotes] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [endDate, setEndDate] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<any[] | null>(null);
  const [showRecurPicker, setShowRecurPicker] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const bookedBlocks = useMemo(() => getBookedBlocks(bookings, exceptions, iso), [bookings, exceptions, iso]);
  const durationHours = allDay ? 16 : (endH + endM / 60 - startH - startM / 60);
  const slot = allDay ? fmtTime(OPEN_HOUR, 0) + '–' + fmtTime(0, 0) : slotFromHM(startH, startM, endH === CLOSE_HOUR ? 0 : endH, endM);

  const hasSingleConflict = useMemo(() => {
    // All-day bookings use OPEN_HOUR as start — never skip the conflict check.
    const sd = allDay ? OPEN_HOUR : startH + startM / 60;
    for (let i = 0; i < durationHours * 2; i++) { if (bookedBlocks.has(sd * 2 + i)) return true; }
    return false;
  }, [bookedBlocks, startH, startM, durationHours, allDay]);

  const findConflicts = () => {
    if (recurrence === 'none') return [];
    const wEnd = endDate || (() => { const d = new Date(formDate); d.setFullYear(d.getFullYear() + 2); return toISO(d); })();
    const tempB = { id: '__prev__', start_date: iso, end_date: endDate || null, recurrence, time_slot: slot, duration_hours: durationHours, status: 'pending' };
    const occs = expandBooking(tempB, iso, wEnd, []);
    const found: any[] = [];
    // All-day bookings use OPEN_HOUR as start, same as the slot value.
    const sd = allDay ? OPEN_HOUR : startH + startM / 60;
    for (const occ of occs) {
      const bb = getBookedBlocks(bookings, exceptions, occ.date);
      let clash = false;
      for (let i = 0; i < durationHours * 2; i++) { if (bb.has(sd * 2 + i)) { clash = true; break; } }
      if (clash) found.push({ date: occ.date, time_slot: slot });
    }
    return found;
  };

  const handleSubmit = () => {
    if (!activity.trim()) { setError('Ange en aktivitet.'); return; }
    if (toISO(formDate) < toISO(new Date())) { setError('Bokning kan inte göras för passerade datum.'); return; }
    if (!allDay && durationHours <= 0) { setError('Sluttid måste vara efter starttid.'); return; }
    if (recurrence.startsWith('custom:') && parseCustomDays(recurrence).length === 0) { setError('Välj minst en dag för anpassad upprepning.'); return; }
    if (hasSingleConflict) { setError('Denna tid är upptagen — välj en annan tid.'); return; }
    if (recurrence !== 'none') { const f = findConflicts(); if (f.length > 0) { setConflicts(f); return; } }
    onSubmit({ name: userName, phone: userPhone, activity, notes, date: iso, time_slot: slot, duration_hours: durationHours, recurrence, end_date: endDate, skip_dates: [] });
  };

  const inp = { backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 10, padding: 12, fontSize: 16, color: T.text };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, transform: [{ translateX }] }]}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
        <BackButton onPress={goBack} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 110 }} scrollEnabled={!pickerOpen}>
        <Text style={{ fontSize: 26, fontWeight: '700', color: T.text, letterSpacing: -0.5, marginBottom: 14 }}>Ny aktivitet</Text>

        {/* Date picker accordion */}
        <TouchableOpacity
          onPress={() => setShowDatePicker(v => !v)}
          activeOpacity={0.7}
          style={{ backgroundColor: T.card, borderWidth: 0.5, borderColor: showDatePicker ? T.accent : T.border, borderRadius: 12, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View>
            <Text style={{ fontSize: 11, fontWeight: '700', color: T.textSecondary, letterSpacing: 0.5, marginBottom: 2 }}>DATUM</Text>
            <Text style={{ fontSize: 15, fontWeight: '600', color: T.text }}>
              {DAYS_FULL[(formDate.getDay() + 6) % 7]}, {isoToDisplay(iso)}
            </Text>
          </View>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Polyline points={showDatePicker ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
        </TouchableOpacity>
        {showDatePicker && (
          <MiniCalendar
            selectedDate={formDate}
            onSelect={d => { setFormDate(d); setShowDatePicker(false); setError(''); }}
            bookings={bookings}
            exceptions={exceptions}
            T={T}
          />
        )}

        {/* User info */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: T.accent + '22', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={T.accent} strokeWidth="2" strokeLinecap="round"/>
              <Circle cx="12" cy="7" r="4" stroke={T.accent} strokeWidth="2"/>
            </Svg>
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: T.text }}>{userName}</Text>
            <Text style={{ fontSize: 12, color: T.textMuted }}>{userPhone}</Text>
          </View>
        </View>

        {/* Activity */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: T.textSecondary, letterSpacing: 0.5, marginBottom: 6 }}>AKTIVITET *</Text>
          <TextInput style={inp} value={activity} onChangeText={t => { setActivity(t); setError(''); }}
            placeholder="T.ex. Koranskola, Möte..." placeholderTextColor={T.textMuted} />
        </View>

        {/* All-day toggle */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <Text style={{ fontSize: 16, color: T.text }}>Heldag</Text>
          <TouchableOpacity
            onPress={() => setAllDay(v => !v)}
            style={{ width: 51, height: 31, borderRadius: 16, backgroundColor: allDay ? T.accent : T.cardSecondary, justifyContent: 'center', paddingHorizontal: 2 }}
          >
            <Animated.View style={{
              width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff',
              alignSelf: allDay ? 'flex-end' : 'flex-start',
              shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
            }} />
          </TouchableOpacity>
        </View>

        {/* Time pickers */}
        {!allDay && (
          <View style={{ gap: 10, marginBottom: 14 }}>
            <TimeAccordion label="Starttid" hour={startH} minute={startM}
              onConfirm={(h, m) => {
                setStartH(h); setStartM(m);
                // Auto-advance end to the next full hour if current end ≤ new start
                if (endH * 60 + endM <= h * 60 + m) {
                  const nextH = Math.min(h + 1, 24);
                  setEndH(nextH); setEndM(0);
                }
              }}
              onOpenChange={setPickerOpen}
              bookedBlocks={bookedBlocks} isStart={true} pairedHour={startH} pairedMinute={startM} T={T} />
            <TimeAccordion label="Sluttid" hour={endH} minute={endM}
              onConfirm={(h, m) => { setEndH(h); setEndM(m); }}
              onOpenChange={setPickerOpen}
              bookedBlocks={bookedBlocks} isStart={false} pairedHour={startH} pairedMinute={startM} T={T} />
          </View>
        )}

        {!allDay && durationHours > 0 && (
          <Text style={{ fontSize: 13, color: accentText, marginBottom: 14 }}>
            {slot} · {fmtDuration(durationHours)}
          </Text>
        )}

        {/* Recurrence */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: T.textSecondary, letterSpacing: 0.5, marginBottom: 6 }}>UPPREPNING</Text>
          <TouchableOpacity
            style={[inp, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
            onPress={() => setShowRecurPicker(true)}
          >
            <Text style={{ fontSize: 16, color: T.text }}>{fmtRecur(recurrence)}</Text>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Polyline points="6 9 12 15 18 9" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/>
            </Svg>
          </TouchableOpacity>

          {/* Custom day picker */}
          {recurrence.startsWith('custom') && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {['Mån','Tis','Ons','Tor','Fre','Lör','Sön'].map((dayName, i) => {
                const days = parseCustomDays(recurrence);
                const sel = days.includes(i);
                return (
                  <TouchableOpacity key={i}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: sel ? T.accent : 'transparent', borderWidth: 1.5, borderColor: sel ? T.accent : T.border }}
                    onPress={() => {
                      const cur = parseCustomDays(recurrence);
                      const next = sel ? cur.filter(d => d !== i) : [...cur, i];
                      setRecurrence(buildCustomRecurrence(next));
                    }}
                  >
                    <Text style={{ color: sel ? '#fff' : T.text, fontSize: 13, fontWeight: sel ? '700' : '400' }}>{dayName}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Notes */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: T.textSecondary, letterSpacing: 0.5, marginBottom: 6 }}>ANTECKNINGAR</Text>
          <TextInput style={[inp, { height: 80, textAlignVertical: 'top' }]} value={notes}
            onChangeText={setNotes} placeholder="Valfritt..." placeholderTextColor={T.textMuted} multiline />
        </View>

        {hasSingleConflict && <View style={styles.errorBox}><Text style={{ color: T.error, fontSize: 13 }}>Denna tid är upptagen.</Text></View>}
        {!!error && <View style={styles.errorBox}><Text style={{ color: T.error, fontSize: 13 }}>{error}</Text></View>}

        <TouchableOpacity
          style={{ backgroundColor: hasSingleConflict ? T.textTertiary : T.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 }}
          onPress={handleSubmit} disabled={loading || hasSingleConflict}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Skicka bokningsförfrågan</Text>
          }
        </TouchableOpacity>
      </ScrollView>

      {/* Recurrence picker modal */}
      <Modal visible={showRecurPicker} transparent animationType="slide" onRequestClose={() => setShowRecurPicker(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setShowRecurPicker(false)} />
        <View style={{ backgroundColor: T.card, borderRadius: 20, padding: 20, paddingBottom: 40 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: T.text, marginBottom: 16, textAlign: 'center' }}>Upprepning</Text>
          {RECUR_OPTIONS.map(o => (
            <TouchableOpacity key={o.value}
              style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderColor: T.separator, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              onPress={() => { setRecurrence(o.value === 'custom' ? 'custom:' : o.value); setShowRecurPicker(false); }}
            >
              <Text style={{ fontSize: 16, color: T.text }}>{o.label}</Text>
              {(o.value === recurrence || (o.value === 'custom' && recurrence.startsWith('custom'))) && (
                <Text style={{ color: T.accent, fontWeight: '700' }}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Conflicts modal */}
      {conflicts && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setConflicts(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: T.card, borderRadius: 20, padding: 24, paddingBottom: 36 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: T.text, marginBottom: 8 }}>Tidskrockar hittades</Text>
              <Text style={{ fontSize: 14, color: T.textMuted, marginBottom: 16 }}>
                {conflicts.length} datum har redan en bokning under vald tid. Vill du hoppa över dessa och boka de lediga datumen?
              </Text>
              <ScrollView style={{ maxHeight: 150 }}>
                {conflicts.map((c, i) => <Text key={i} style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>• {isoToDisplay(c.date)} {c.time_slot}</Text>)}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 0.5, borderColor: T.border, alignItems: 'center' }} onPress={() => setConflicts(null)}>
                  <Text style={{ color: T.text, fontWeight: '600' }}>Avbryt</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: T.accent, alignItems: 'center' }}
                  onPress={() => {
                    onSubmit({ name: userName, phone: userPhone, activity, notes, date: iso, time_slot: slot, duration_hours: durationHours, recurrence, end_date: endDate, skip_dates: conflicts.map(c => c.date) });
                    setConflicts(null);
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Boka lediga datum</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ─── My Bookings ──────────────────────────────────────────────────────────────
function MyBookings({ bookings, exceptions, myBookingIds, onCancel, onBack, initialBookingId, T }: {
  bookings: any[]; exceptions: any[]; myBookingIds: Set<string>;
  onCancel: (booking: any, date: string | null) => void;
  onBack: () => void;
  initialBookingId?: string;
  T: any;
}) {
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onBack);
  const allMyBookings = useMemo(
    () => bookings.filter(b => myBookingIds.has(b.id)).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    [bookings, myBookingIds],
  );
  const today = toISO(new Date());
  const [detailBooking, setDetailBooking] = useState<any | null>(null);
  const [filter, setFilter] = useState<'active' | 'approved' | 'rejected' | 'cancelled'>('active');

  // Active = pending + approved + edited (not yet resolved)
  const activeBookings   = useMemo(() => allMyBookings.filter(b => b.status === 'pending' || b.status === 'approved' || b.status === 'edited' || b.status === 'edit_pending'), [allMyBookings]);
  const approvedBookings = useMemo(() => allMyBookings.filter(b => b.status === 'approved' || b.status === 'edited'), [allMyBookings]);
  const rejectedBookings = useMemo(() => allMyBookings.filter(b => b.status === 'rejected'), [allMyBookings]);
  const cancelledBookings = useMemo(() => allMyBookings.filter(b => b.status === 'cancelled'), [allMyBookings]);

  const myBookings = useMemo(() => {
    if (filter === 'approved')  return approvedBookings;
    if (filter === 'rejected')  return rejectedBookings;
    if (filter === 'cancelled') return cancelledBookings;
    return activeBookings;
  }, [filter, activeBookings, approvedBookings, rejectedBookings, cancelledBookings]);

  type MyFilter = 'active' | 'approved' | 'rejected' | 'cancelled';
  const FILTERS: [MyFilter, string, number][] = [
    ['active',    'Aktiva',    activeBookings.length],
    ['approved',  'Godkända',  approvedBookings.length],
    ['rejected',  'Avböjda',   rejectedBookings.length],
    ['cancelled', 'Inställda', cancelledBookings.length],
  ].filter(([, , count]) => count > 0) as [MyFilter, string, number][];

  // Auto-open booking detail when navigated from a notification
  useEffect(() => {
    if (initialBookingId && allMyBookings.length > 0) {
      // Strip exception suffix (booking_id + '_exc_' + date) to get the base booking id
      const baseId = initialBookingId.includes('_exc_')
        ? initialBookingId.split('_exc_')[0]
        : initialBookingId;
      const target = allMyBookings.find(b => b.id === baseId);
      if (target) setDetailBooking(target);
    }
  }, [initialBookingId, allMyBookings.length]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, transform: [{ translateX }] }]}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: T.separator }}>
        <TouchableOpacity onPress={goBack} style={{ marginRight: 16, paddingVertical: 4 }}>
          <Text style={{ color: T.accent, fontSize: 17 }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 19, fontWeight: '700', color: T.text }}>Mina bokningar</Text>
      </View>

      {/* Filter chips — only rendered when there are bookings in multiple categories */}
      {FILTERS.length > 1 && (
        <View style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderColor: T.separator }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {FILTERS.map(([v, label, count]) => {
              const active = filter === v;
              return (
                <TouchableOpacity
                  key={v}
                  onPress={() => setFilter(v)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: active ? T.accent : T.card,
                    borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14,
                    borderWidth: 0.5, borderColor: active ? T.accent : T.border,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : T.text }}>{label}</Text>
                  <View style={{
                    backgroundColor: active ? 'rgba(255,255,255,0.25)' : T.bg,
                    borderRadius: 10, minWidth: 20, height: 20,
                    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: active ? '#fff' : T.textMuted }}>{count}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {allMyBookings.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Text style={{ fontSize: 15, color: T.textMuted }}>Inga bokningar ännu</Text>
          </View>
        ) : myBookings.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Text style={{ fontSize: 15, color: T.textMuted }}>Inga bokningar i denna kategori</Text>
          </View>
        ) : (
          myBookings.map(b => {
            const upcoming = expandBooking(b, today, (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 2); return toISO(d); })(), exceptions).slice(0, 3);
            const isHighlighted = initialBookingId &&
              (b.id === initialBookingId || initialBookingId.startsWith(b.id + '_exc_'));
            return (
              <TouchableOpacity
                key={b.id}
                activeOpacity={0.85}
                onPress={() => setDetailBooking(b)}
                style={{
                  backgroundColor: T.card, borderRadius: 14, padding: 14, marginBottom: 12,
                  borderWidth: isHighlighted ? 1.5 : 0.5,
                  borderColor: isHighlighted ? T.accent : T.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: T.text, flex: 1 }}>{b.activity}</Text>
                  <StatusBadge status={b.status} />
                </View>
                {upcoming.map((occ, i) => (
                  <Text key={i} style={{ fontSize: 13, color: T.textMuted, marginTop: 2 }}>
                    📅 {isoToDisplay(occ.date)} · {occ.time_slot}
                  </Text>
                ))}
                {b.recurrence && b.recurrence !== 'none' && (
                  <Text style={{ fontSize: 11, color: '#8b5cf6', marginTop: 4 }}>{fmtRecur(b.recurrence)}</Text>
                )}
                {b.admin_comment ? <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 6, fontStyle: 'italic' }}>Admin: {b.admin_comment}</Text> : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Booking detail slide-in */}
      {detailBooking && (
        <UserBookingDetail
          booking={detailBooking}
          exceptions={exceptions}
          onCancel={onCancel}
          onBack={() => setDetailBooking(null)}
          T={T}
        />
      )}
    </Animated.View>
  );
}

// ─── User Booking Detail ──────────────────────────────────────────────────────
function UserBookingDetail({ booking, exceptions, onCancel, onBack, T }: {
  booking: any; exceptions: any[];
  onCancel: (booking: any, date: string | null) => void;
  onBack: () => void; T: any;
}) {
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onBack);
  const today    = toISO(new Date());
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toISO(d); })();
  const futureEnd = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 2); return toISO(d); })();

  const [showAllOccs, setShowAllOccs] = useState(false);
  const OCCS_PREVIEW = 3;

  const upcomingOccs = expandBooking(booking, tomorrow, futureEnd, exceptions);
  const skippedExcs  = exceptions
    .filter(e => e.booking_id === booking.id && e.type === 'skip')
    .sort((a: any, b: any) => (b.created_at ?? 0) - (a.created_at ?? 0));

  const statusMap: Record<string, { label: string; color: string }> = {
    approved:     { label: 'Godkänd',       color: '#34C759' },
    edited:       { label: 'Godkänd',       color: '#34C759' },
    pending:      { label: 'Väntar',        color: '#FF9F0A' },
    edit_pending: { label: 'Ändr. väntar',  color: '#FF6B22' },
    rejected:     { label: 'Avböjd',        color: '#FF3B30' },
    cancelled:    { label: 'Inställd',      color: '#8E8E93' },
  };
  const st = statusMap[booking.status] ?? { label: booking.status, color: '#888' };

  const canCancel = booking.status === 'approved' || booking.status === 'pending' || booking.status === 'edited';
  const occsToShow = showAllOccs ? upcomingOccs : upcomingOccs.slice(0, OCCS_PREVIEW);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, transform: [{ translateX }] }]}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />

      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5, borderColor: T.border }}>
        <TouchableOpacity onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ color: T.accent, fontSize: 20, lineHeight: 22 }}>‹</Text>
          <Text style={{ color: T.accent, fontSize: 16, fontWeight: '500' }}>Tillbaka</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: st.color + '22', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: st.color }} />
          <Text style={{ color: st.color, fontSize: 12, fontWeight: '700' }}>{st.label}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        {/* Activity + user info */}
        <View style={{ backgroundColor: T.card, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: T.border }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: T.text, marginBottom: 4 }}>{booking.activity ?? 'Bokning'}</Text>
          {booking.recurrence && booking.recurrence !== 'none' && (
            <Text style={{ fontSize: 12, color: '#8b5cf6', fontWeight: '600', marginBottom: 4 }}>{fmtRecur(booking.recurrence)}</Text>
          )}
          <Text style={{ fontSize: 13, color: T.textMuted }}>
            Startdatum: {booking.start_date ? isoToDisplay(booking.start_date) : '—'}
          </Text>
          {booking.time_slot ? (
            <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 2 }}>Tid: {booking.time_slot}</Text>
          ) : null}
        </View>

        {/* Admin comment — highlighted when present */}
        {booking.admin_comment ? (
          <View style={{ backgroundColor: st.color + '11', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: st.color + '44' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: st.color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Meddelande från admin
            </Text>
            <Text style={{ fontSize: 14, color: T.text, lineHeight: 20 }}>{booking.admin_comment}</Text>
          </View>
        ) : null}

        {/* Upcoming occurrences */}
        {upcomingOccs.length > 0 && (
          <View style={{ backgroundColor: T.card, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 0.5, borderColor: T.border }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Kommande tillfällen
            </Text>
            {occsToShow.map((occ: any, i: number) => {
              const skipExc = exceptions.find(e => e.booking_id === booking.id && e.exception_date === occ.date && e.type === 'skip');
              return (
                <View key={occ.date} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i < occsToShow.length - 1 ? 0.5 : 0, borderColor: T.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: skipExc ? T.textMuted : T.text, fontWeight: '500', textDecorationLine: skipExc ? 'line-through' : 'none' }}>
                      {isoToDisplay(occ.date)}
                    </Text>
                    <Text style={{ fontSize: 12, color: T.textMuted }}>{occ.time_slot}</Text>
                  </View>
                  {skipExc && (
                    <Text style={{ fontSize: 11, color: '#FF3B30', fontWeight: '600' }}>Inställt</Text>
                  )}
                </View>
              );
            })}
            {upcomingOccs.length > OCCS_PREVIEW && !showAllOccs && (
              <TouchableOpacity onPress={() => setShowAllOccs(true)} style={{ marginTop: 8 }}>
                <Text style={{ color: T.accent, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                  Visa alla {upcomingOccs.length} tillfällen
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Skipped occurrences */}
        {skippedExcs.length > 0 && (
          <View style={{ backgroundColor: T.card, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 0.5, borderColor: T.border }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Inställda tillfällen
            </Text>
            {skippedExcs.map((e: any) => (
              <View key={e.id} style={{ paddingVertical: 6 }}>
                <Text style={{ fontSize: 13, color: T.text }}>{e.exception_date ? isoToDisplay(e.exception_date) : '—'}</Text>
                {e.admin_comment ? (
                  <Text style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>{e.admin_comment}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* Cancel button */}
        {canCancel && (
          <TouchableOpacity
            onPress={() => Alert.alert('Avboka', 'Vill du avboka denna bokning?', [
              { text: 'Avbryt', style: 'cancel' },
              { text: 'Avboka', style: 'destructive', onPress: () => { onCancel(booking, null); onBack(); } },
            ])}
            style={{ borderWidth: 1, borderColor: '#FF3B3055', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 }}
          >
            <Text style={{ color: '#FF3B30', fontSize: 15, fontWeight: '600' }}>Avboka bokning</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </Animated.View>
  );
}

// ─── Admin Booking Detail ─────────────────────────────────────────────────────
function AdminBookingDetail({ booking, exceptions, onBack, onApprove, onReject, onDeleteOccurrence, onDeleteAll, T }: {
  booking: any; exceptions: any[];
  onBack: () => void;
  onApprove: (id: string, comment: string) => void;
  onReject: (id: string, comment: string) => void;
  onDeleteOccurrence: (bookingId: string, date: string, reason: string) => void;
  onDeleteAll: (id: string, reason: string) => void;
  T: any;
}) {
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onBack);
  const [comment, setComment] = useState('');
  const [actionMode, setActionMode] = useState<'approve' | 'reject' | null>(null);
  const [cancelOccDate, setCancelOccDate] = useState<string | null>(null);
  const [cancelOccReason, setCancelOccReason] = useState('');
  const [cancelAllMode, setCancelAllMode] = useState(false);
  const [cancelAllReason, setCancelAllReason] = useState('');

  const [showAllOccs, setShowAllOccs] = useState(false);
  const OCCS_PREVIEW = 3;

  const isPending = booking.status === 'pending' || booking.status === 'edit_pending';

  const futureEnd = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 2); return toISO(d); })();
  const today     = toISO(new Date());
  const tomorrow  = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toISO(d); })();

  // First-ever occurrence (may be in past)
  const allFromStart  = expandBooking(booking, booking.start_date ?? today, futureEnd, exceptions);
  const firstOcc      = allFromStart[0] ?? null;
  // All future occurrences
  const upcomingOccs  = expandBooking(booking, tomorrow, futureEnd, exceptions);
  // Skipped occurrences — directly from exceptions, sorted newest first
  const skippedExcs   = exceptions
    .filter(e => e.booking_id === booking.id && e.type === 'skip')
    .sort((a: any, b: any) => (b.created_at ?? 0) - (a.created_at ?? 0));

  const statusMap: Record<string, { label: string; color: string }> = {
    approved: { label: 'Godkänd', color: '#34C759' },
    edited:   { label: 'Godkänd', color: '#34C759' },
    pending:  { label: 'Väntar',  color: '#FF9F0A' },
    edit_pending: { label: 'Ändr. väntar', color: '#FF6B22' },
    rejected: { label: 'Avböjd', color: '#FF3B30' },
    cancelled:{ label: 'Inställd', color: '#8E8E93' },
  };
  const st = statusMap[booking.status] ?? { label: booking.status, color: '#888' };

  const renderOccRow = (occ: any, isFirst: boolean) => {
    const oslot = occ.time_slot ?? '';
    const odur  = oslot ? (() => { try { return fmtDuration(parseSlotParts(oslot).duration); } catch { return ''; } })() : '';
    const skipExc = exceptions.find(e => e.booking_id === booking.id && e.exception_date === occ.date && e.type === 'skip');
    const isDeleted = booking.status === 'deleted';
    return (
      <View key={occ.date} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 0.5, borderColor: T.border }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: isFirst ? 16 : 15, fontWeight: isFirst ? '700' : '600', color: skipExc ? T.textMuted : T.text, textDecorationLine: skipExc ? 'line-through' : 'none' }}>
            {isoToDisplay(occ.date)}
          </Text>
          <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 2 }}>
            {oslot}{odur ? ` · ${odur}` : ''}
          </Text>
          {skipExc?.deleted_by_name ? (
            <Text style={{ fontSize: 11, color: '#FF3B30', marginTop: 2 }}>
              Avbokat av {skipExc.deleted_by_name}
            </Text>
          ) : skipExc ? (
            <Text style={{ fontSize: 11, color: '#FF3B30', marginTop: 2 }}>Avbokat tillfälle</Text>
          ) : null}
        </View>
        {!skipExc && !isDeleted && booking.recurrence && booking.recurrence !== 'none' && (
          cancelOccDate === occ.date ? (
            <View style={{ marginLeft: 12, flex: 1 }}>
              <TextInput
                style={{ backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 8, padding: 8, fontSize: 13, color: T.text, marginBottom: 6, height: 56, textAlignVertical: 'top' }}
                value={cancelOccReason}
                onChangeText={setCancelOccReason}
                placeholder="Orsak (obligatorisk)..."
                placeholderTextColor={T.textMuted}
                multiline
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity style={{ flex: 1, padding: 8, borderRadius: 8, borderWidth: 0.5, borderColor: T.border, alignItems: 'center' }} onPress={() => { setCancelOccDate(null); setCancelOccReason(''); }}>
                  <Text style={{ color: T.text, fontSize: 12, fontWeight: '600' }}>Avbryt</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, padding: 8, borderRadius: 8, backgroundColor: cancelOccReason.trim() ? '#FF3B30' : '#FF3B3044', alignItems: 'center' }}
                  disabled={!cancelOccReason.trim()}
                  onPress={() => { onDeleteOccurrence(booking.id, occ.date, cancelOccReason.trim()); setCancelOccDate(null); setCancelOccReason(''); }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Avboka</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => { setCancelOccDate(occ.date); setCancelOccReason(''); }}
              style={{ borderWidth: 1, borderColor: '#FF3B3055', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, marginLeft: 12 }}
            >
              <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '600' }}>Avboka</Text>
            </TouchableOpacity>
          )
        )}
      </View>
    );
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, transform: [{ translateX }] }]}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />

      {/* Header */}
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5, borderColor: T.border }}>
        <TouchableOpacity onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ color: T.accent, fontSize: 20, lineHeight: 22 }}>‹</Text>
          <Text style={{ color: T.accent, fontSize: 16, fontWeight: '500' }}>Tillbaka</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: st.color + '22', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: st.color }} />
            <Text style={{ color: st.color, fontSize: 12, fontWeight: '700' }}>{st.label}</Text>
          </View>
          {booking.recurrence && booking.recurrence !== 'none' && (
            <View style={{ backgroundColor: '#8b5cf622', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#8b5cf6', fontSize: 12, fontWeight: '700' }}>{fmtRecur(booking.recurrence)}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        {/* Title block */}
        <View style={{ paddingTop: 20, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: T.border }}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: T.text, letterSpacing: -0.5, marginBottom: 4 }}>
            {booking.activity}
          </Text>
          <Text style={{ fontSize: 14, color: T.textMuted }}>
            {booking.name}{booking.phone ? ` · ${booking.phone}` : ''}
          </Text>
          {booking.notes ? (
            <Text style={{ fontSize: 13, color: T.textMuted, fontStyle: 'italic', marginTop: 4 }}>
              {booking.notes}
            </Text>
          ) : null}
        </View>

        {/* Deletion info — deleted series */}
        {booking.status === 'deleted' && (
          <View style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderColor: T.border, gap: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#FF3B30', letterSpacing: 0.8 }}>RADERAD SERIE</Text>
            {booking.deleted_by_name ? (
              <Text style={{ fontSize: 13, color: T.textMuted }}>
                Raderad av <Text style={{ color: T.text, fontWeight: '600' }}>{booking.deleted_by_name}</Text>
              </Text>
            ) : null}
            {booking.deleted_at ? (
              <Text style={{ fontSize: 12, color: T.textMuted }}>
                {new Date(booking.deleted_at).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Text>
            ) : null}
          </View>
        )}

        {/* Approve / Reject */}
        {isPending && (
          <View style={{ paddingVertical: 16, borderBottomWidth: 0.5, borderColor: T.border }}>
            {actionMode ? (
              <>
                <TextInput
                  style={{ backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 10, padding: 12, fontSize: 15, color: T.text, marginBottom: 10, height: 72, textAlignVertical: 'top' }}
                  value={comment} onChangeText={setComment}
                  placeholder="Kommentar (valfritt)..." placeholderTextColor={T.textMuted} multiline
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 12, borderWidth: 0.5, borderColor: T.border, alignItems: 'center' }} onPress={() => setActionMode(null)}>
                    <Text style={{ color: T.text, fontWeight: '600' }}>Avbryt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, padding: 13, borderRadius: 12, backgroundColor: actionMode === 'approve' ? '#34C759' : '#FF3B30', alignItems: 'center' }}
                    onPress={() => { actionMode === 'approve' ? onApprove(booking.id, comment) : onReject(booking.id, comment); onBack(); }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{actionMode === 'approve' ? 'Godkänn' : 'Avböj'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={{ flex: 1, backgroundColor: '#34C75922', borderRadius: 12, padding: 13, alignItems: 'center' }} onPress={() => setActionMode('approve')}>
                  <Text style={{ color: '#34C759', fontWeight: '700', fontSize: 14 }}>✓ Godkänn</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, backgroundColor: '#FF3B3022', borderRadius: 12, padding: 13, alignItems: 'center' }} onPress={() => setActionMode('reject')}>
                  <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 14 }}>✗ Avböj</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* DENNA BOKNING */}
        {firstOcc && (
          <View style={{ paddingTop: 20 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: T.accent, letterSpacing: 1, marginBottom: 4 }}>
              DENNA BOKNING
            </Text>
            {renderOccRow(firstOcc, true)}
          </View>
        )}

        {/* KOMMANDE TILLFÄLLEN — only for recurring bookings */}
        {upcomingOccs.length > 0 && booking.recurrence && booking.recurrence !== 'none' && (
          <View style={{ paddingTop: 20 }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: T.textMuted, letterSpacing: 0.8, marginBottom: 4 }}>
              KOMMANDE TILLFÄLLEN ({upcomingOccs.length})
            </Text>
            {(showAllOccs ? upcomingOccs : upcomingOccs.slice(0, OCCS_PREVIEW)).map(occ => renderOccRow(occ, false))}
            {upcomingOccs.length > OCCS_PREVIEW && (
              <TouchableOpacity
                onPress={() => setShowAllOccs(v => !v)}
                style={{ paddingVertical: 10, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 13, color: T.accent, fontWeight: '600' }}>
                  {showAllOccs ? 'Visa färre' : `Visa mer (${upcomingOccs.length - OCCS_PREVIEW} till)`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* AVBOKADE TILLFÄLLEN */}
        {skippedExcs.length > 0 && (
          <View style={{ paddingTop: 20 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#FF3B30', letterSpacing: 0.8, marginBottom: 4 }}>
              AVBOKADE TILLFÄLLEN ({skippedExcs.length})
            </Text>
            {skippedExcs.map((exc: any) => (
              <View key={exc.id} style={{ paddingVertical: 13, borderBottomWidth: 0.5, borderColor: T.border }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: T.textMuted, textDecorationLine: 'line-through' }}>
                  {isoToDisplay(exc.exception_date)}
                </Text>
                {exc.deleted_by_name ? (
                  <Text style={{ fontSize: 12, color: '#FF3B30', marginTop: 3 }}>
                    Avbokat av <Text style={{ fontWeight: '700' }}>{exc.deleted_by_name}</Text>
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>Avbokat tillfälle</Text>
                )}
                {exc.created_at ? (
                  <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
                    {new Date(exc.created_at).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* Avboka hela bokning — only for approved bookings */}
        {(booking.status === 'approved' || booking.status === 'edited') && (
          cancelAllMode ? (
            <View style={{ marginTop: 32, backgroundColor: '#FF3B3012', borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: '#FF3B3033' }}>
              <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '700', marginBottom: 10 }}>Ange orsak för avbokning</Text>
              <TextInput
                style={{ backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 10, padding: 12, fontSize: 14, color: T.text, marginBottom: 10, height: 72, textAlignVertical: 'top' }}
                value={cancelAllReason}
                onChangeText={setCancelAllReason}
                placeholder="Orsak (obligatorisk)..."
                placeholderTextColor={T.textMuted}
                multiline
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 12, borderWidth: 0.5, borderColor: T.border, alignItems: 'center' }} onPress={() => { setCancelAllMode(false); setCancelAllReason(''); }}>
                  <Text style={{ color: T.text, fontWeight: '600' }}>Avbryt</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, padding: 13, borderRadius: 12, backgroundColor: cancelAllReason.trim() ? '#FF3B30' : '#FF3B3044', alignItems: 'center' }}
                  disabled={!cancelAllReason.trim()}
                  onPress={() => { onDeleteAll(booking.id, cancelAllReason.trim()); setCancelAllMode(false); setCancelAllReason(''); }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Bekräfta avbokning</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setCancelAllMode(true)}
              style={{ marginTop: 32, backgroundColor: '#FF3B3012', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 0.5, borderColor: '#FF3B3033' }}
            >
              <Text style={{ color: '#FF3B30', fontSize: 15, fontWeight: '700' }}>Avboka hela bokningen</Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>
    </Animated.View>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel({ bookings, exceptions, onBack, onUsers, onApprove, onReject, onDelete, onDeleteOccurrence, onMarkSeen, initialFilter, T }: {
  bookings: any[]; exceptions: any[];
  onBack: () => void;
  onUsers?: () => void;
  onApprove: (id: string, comment: string) => void;
  onReject: (id: string, comment: string) => void;
  onDelete: (id: string, reason: string) => void;
  onDeleteOccurrence: (bookingId: string, date: string, reason: string) => void;
  onMarkSeen: () => void;
  initialFilter?: string;
  T: any;
}) {
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onBack);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'skipped'>(
    (initialFilter as any) ?? 'all'
  );
  const [detailBooking, setDetailBooking] = useState<any | null>(null);

  useEffect(() => { onMarkSeen(); }, []);

  // Bookings that have at least one skip exception
  const skippedBookingIds = useMemo(() => new Set(
    exceptions.filter(e => e.type === 'skip').map((e: any) => e.booking_id)
  ), [exceptions]);

  // Latest skip exception timestamp per booking (for sort)
  const latestSkipTs = useMemo(() => {
    const map = new Map<string, number>();
    exceptions.filter(e => e.type === 'skip').forEach((e: any) => {
      const cur = map.get(e.booking_id) ?? 0;
      if ((e.created_at ?? 0) > cur) map.set(e.booking_id, e.created_at ?? 0);
    });
    return map;
  }, [exceptions]);

  const counts = useMemo(() => ({
    all:       bookings.filter(b => b.status !== 'deleted').length,
    pending:   bookings.filter(b => b.status === 'pending' || b.status === 'edit_pending').length,
    approved:  bookings.filter(b => b.status === 'approved' || b.status === 'edited').length,
    rejected:  bookings.filter(b => b.status === 'rejected').length,
    cancelled: bookings.filter(b => b.status === 'cancelled').length,
    skipped:   bookings.filter(b => b.status !== 'deleted' && skippedBookingIds.has(b.id)).length,
  }), [bookings, skippedBookingIds]);

  const filtered = useMemo(() => {
    let list: any[];
    if (filter === 'pending')        list = bookings.filter(b => b.status === 'pending' || b.status === 'edit_pending');
    else if (filter === 'approved')  list = bookings.filter(b => b.status === 'approved' || b.status === 'edited');
    else if (filter === 'rejected')  list = bookings.filter(b => b.status === 'rejected');
    else if (filter === 'cancelled') list = bookings.filter(b => b.status === 'cancelled');
    else if (filter === 'skipped')   list = bookings.filter(b => b.status !== 'deleted' && skippedBookingIds.has(b.id));
    else                             list = bookings.filter(b => b.status !== 'deleted');
    if (filter === 'skipped') {
      return list.sort((a, b) => (latestSkipTs.get(b.id) ?? 0) - (latestSkipTs.get(a.id) ?? 0));
    }
    return list.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  }, [bookings, filter, skippedBookingIds, latestSkipTs]);

  const FILTERS: [typeof filter, string, number][] = [
    ['all',       'Alla',                counts.all],
    ['pending',   'Väntar',              counts.pending],
    ['approved',  'Godkända',            counts.approved],
    ['rejected',  'Avböjda',             counts.rejected],
    ['cancelled', 'Inställda',           counts.cancelled],
    ['skipped',   'Avbokade tillfällen', counts.skipped],
  ];

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, transform: [{ translateX }] }]}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 16,
        paddingBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 0.5,
        borderColor: T.border,
      }}>
        <TouchableOpacity onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ color: T.accent, fontSize: 20, lineHeight: 22 }}>‹</Text>
          <Text style={{ color: T.accent, fontSize: 16, fontWeight: '500' }}>Stäng</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }}>Adminpanel</Text>
        {onUsers ? (
          <TouchableOpacity onPress={onUsers} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: T.border }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={T.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx="12" cy="7" r="4" stroke={T.textMuted} strokeWidth={2} />
            </Svg>
          </TouchableOpacity>
        ) : <View style={{ width: 36 }} />}
      </View>

      {/* ── Floating filter chips ─────────────────────────────────────────── */}
      <View style={{ backgroundColor: T.bg, paddingVertical: 10, borderBottomWidth: 0.5, borderColor: T.border }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
        >
          {FILTERS.map(([v, label, count]) => {
            const active = filter === v;
            return (
              <TouchableOpacity
                key={v}
                onPress={() => setFilter(v)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: active ? T.accent : T.card,
                  borderRadius: 20,
                  paddingVertical: 7,
                  paddingHorizontal: 14,
                  borderWidth: 0.5,
                  borderColor: active ? T.accent : T.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : T.text }}>
                  {label}
                </Text>
                <View style={{
                  backgroundColor: active ? 'rgba(255,255,255,0.25)' : T.bg,
                  borderRadius: 10,
                  minWidth: 20,
                  height: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 5,
                }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: active ? '#fff' : T.textMuted }}>
                    {count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Vertical card list ───────────────────────────────────────────── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 12,
          paddingBottom: insets.bottom + 100,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Text style={{ color: T.textMuted, fontSize: 14 }}>Inga bokningar</Text>
          </View>
        ) : filtered.map(b => {
          const today = toISO(new Date());
          const futureEnd = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 2); return toISO(d); })();
          const occs = expandBooking(b, today, futureEnd, exceptions).slice(0, 1);
          const occ  = occs[0];
          const slot = occ?.time_slot ?? '';
          const date = occ ? isoToDisplay(occ.date) : '';
          const dur  = slot ? (() => { try { return fmtDuration(parseSlotParts(slot).duration); } catch { return ''; } })() : '';

          return (
            <TouchableOpacity
              key={b.id}
              activeOpacity={0.85}
              onPress={() => setDetailBooking(b)}
              style={{
                backgroundColor: T.card,
                borderRadius: 14,
                borderWidth: 0.5,
                borderColor: T.border,
                overflow: 'hidden',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
              }}
            >
              <View style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <StatusBadge status={b.status} />
                  {date ? (
                    <Text style={{ fontSize: 12, color: T.textMuted, fontWeight: '500' }}>{date}</Text>
                  ) : null}
                </View>
                <Text style={{ fontSize: 16, fontWeight: '700', color: T.text }} numberOfLines={1}>
                  {b.name}
                </Text>
                {b.activity ? (
                  <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 2 }} numberOfLines={2}>
                    {b.activity}
                  </Text>
                ) : null}
                {b.notes ? (
                  <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 1, fontStyle: 'italic' }} numberOfLines={2}>
                    {b.notes}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  {slot ? <Text style={{ fontSize: 13, color: T.textMuted }}>{slot}</Text> : null}
                  {dur  ? <Text style={{ fontSize: 12, color: T.textMuted }}>· {dur}</Text> : null}
                  {b.recurrence && b.recurrence !== 'none' ? (
                    <Text style={{ fontSize: 11, color: '#8b5cf6', marginLeft: 4 }}>{fmtRecur(b.recurrence)}</Text>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Detail view (fullscreen slide-in) ───────────────────────────── */}
      {detailBooking && (
        <AdminBookingDetail
          booking={detailBooking}
          exceptions={exceptions}
          onBack={() => setDetailBooking(null)}
          onApprove={onApprove}
          onReject={onReject}
          onDeleteOccurrence={onDeleteOccurrence}
          onDeleteAll={(id, reason) => { onDelete(id, reason); setDetailBooking(null); }}
          T={T}
        />
      )}
    </Animated.View>
  );
}

// ─── User Management ──────────────────────────────────────────────────────────
function UserManagement({ onBack, T }: { onBack: () => void; T: any }) {
  const insets = useSafeAreaInsets();
  const { translateX, edgePan, goBack } = useSlideIn(onBack);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', role: 'user' });
  const [creating, setCreating] = useState(false);
  const [newInvite, setNewInvite] = useState<{ name: string; code: string; phone: string } | null>(null);
  const [error, setError] = useState('');
  // Per-row action loading: { [userId]: 'invite' | 'delete' }
  const [rowLoading, setRowLoading] = useState<Record<string, string>>({});
  const currentUserId = Storage.getItem(SK_USER_ID);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('app_users').select('id,name,phone,role,invite_used,created_at,last_login,deleted_at').order('created_at', { ascending: false });
    if (data) setUsers(data);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.phone.trim()) { setError('Namn och telefon krävs.'); return; }
    setCreating(true); setError('');
    const norm = normalizePhone(form.phone);
    const existing = await supabase.from('app_users').select('id').eq('phone', norm).maybeSingle();
    if (existing.data) { setCreating(false); setError('Det finns redan ett konto med detta nummer.'); return; }
    const code = generateInviteCode();
    const { error: err } = await supabase.from('app_users').insert([{
      id: generateId(), name: form.name.trim(), phone: norm, role: form.role,
      invite_code: code, invite_used: false,
      created_by: currentUserId, created_at: Date.now(), last_login: null, pin_hash: null,
    }]);
    setCreating(false);
    if (err) { setError('Kunde inte skapa konto: ' + err.message); return; }
    setNewInvite({ name: form.name.trim(), code, phone: norm });
    setForm({ name: '', phone: '', role: 'user' }); setShowCreate(false); load();
  };

  /** Generate a new invite code for a user and display it. */
  const handleNewInviteCode = async (u: any) => {
    setRowLoading(prev => ({ ...prev, [u.id]: 'invite' }));
    const code = generateInviteCode();
    const { error: err } = await supabase
      .from('app_users')
      .update({ invite_code: code, invite_used: false })
      .eq('id', u.id);
    setRowLoading(prev => { const n = { ...prev }; delete n[u.id]; return n; });
    if (err) { Alert.alert('Fel', err.message); return; }
    setNewInvite({ name: u.name, code, phone: u.phone });
    // Refresh list so invite_used badge updates
    load();
  };

  /** Soft-delete a user (sets deleted_at). */
  const handleDelete = (u: any) => {
    Alert.alert(
      'Radera konto',
      `Är du säker på att du vill radera ${u.name}? Åtgärden kan inte ångras.`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Radera', style: 'destructive', onPress: async () => {
            setRowLoading(prev => ({ ...prev, [u.id]: 'delete' }));
            const { error: err } = await supabase
              .from('app_users')
              .update({ deleted_at: Date.now() })
              .eq('id', u.id);
            setRowLoading(prev => { const n = { ...prev }; delete n[u.id]; return n; });
            if (err) { Alert.alert('Fel', err.message); return; }
            setUsers(prev => prev.filter(x => x.id !== u.id));
          },
        },
      ],
    );
  };

  const inp = { backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, borderRadius: 10, padding: 12, fontSize: 16, color: T.text, marginBottom: 10 };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, transform: [{ translateX }] }]}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: T.separator }}>
        <TouchableOpacity onPress={goBack} style={{ marginRight: 16, paddingVertical: 4 }}>
          <Text style={{ color: T.accent, fontSize: 17 }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 19, fontWeight: '700', color: T.text, flex: 1 }}>Användarhantering</Text>
        <TouchableOpacity onPress={() => setShowCreate(v => !v)} style={{ backgroundColor: T.accent, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>+ Ny</Text>
        </TouchableOpacity>
      </View>

      {/* New invite code banner */}
      {newInvite && (
        <View style={{ margin: 16, backgroundColor: '#34C75922', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#34C75944' }}>
          <Text style={{ color: '#34C759', fontWeight: '700', fontSize: 15, marginBottom: 4 }}>
            {newInvite.code ? 'Ny inbjudningskod!' : 'Konto skapat!'}
          </Text>
          <Text style={{ color: T.text, fontSize: 14 }}>{newInvite.name} — {newInvite.phone}</Text>
          <Text style={{ color: T.text, fontSize: 22, fontWeight: '800', letterSpacing: 8, marginTop: 8 }}>{newInvite.code}</Text>
          <Text style={{ color: T.textMuted, fontSize: 12, marginTop: 4 }}>Dela denna inbjudningskod med användaren</Text>
          <TouchableOpacity onPress={() => setNewInvite(null)} style={{ marginTop: 10 }}>
            <Text style={{ color: T.textMuted, fontSize: 13 }}>Stäng</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Create form */}
      {showCreate && (
        <View style={{ margin: 16, backgroundColor: T.card, borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: T.border }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: T.text, marginBottom: 12 }}>Skapa konto</Text>
          <TextInput style={inp} value={form.name} onChangeText={t => setForm(f => ({ ...f, name: t }))} placeholder="Namn *" placeholderTextColor={T.textTertiary} />
          <TextInput style={inp} value={form.phone} onChangeText={t => setForm(f => ({ ...f, phone: t }))} placeholder="Telefon *" placeholderTextColor={T.textTertiary} keyboardType="phone-pad" />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {(['user', 'admin'] as const).map(r => (
              <TouchableOpacity key={r} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: form.role === r ? T.accent : T.card, borderWidth: 1, borderColor: form.role === r ? T.accent : T.border }} onPress={() => setForm(f => ({ ...f, role: r }))}>
                <Text style={{ color: form.role === r ? '#fff' : T.textMuted, fontSize: 13 }}>{r === 'admin' ? 'Admin' : 'Användare'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!!error && <Text style={{ color: T.error, fontSize: 13, marginBottom: 8 }}>{error}</Text>}
          <TouchableOpacity style={{ backgroundColor: T.accent, borderRadius: 10, padding: 12, alignItems: 'center' }} onPress={handleCreate} disabled={creating}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{creating ? 'Skapar...' : 'Skapa & generera kod'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? <SpinnerView color={T.accent} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          {users.filter(u => !u.deleted_at).map(u => {
            const isActing = !!rowLoading[u.id];
            const isAdmin  = u.role === 'admin' || u.role === 'superadmin';
            return (
              <View key={u.id} style={{ backgroundColor: T.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: T.border }}>
                {/* Row 1: name + badges + Radera */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: T.text, flex: 1 }}>{u.name}</Text>
                  {/* Role badge */}
                  <View style={{ backgroundColor: isAdmin ? '#8b5cf622' : T.accentGlow, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6 }}>
                    <Text style={{ color: isAdmin ? '#8b5cf6' : T.accent, fontSize: 11, fontWeight: '700' }}>
                      {isAdmin ? 'Admin' : 'Användare'}
                    </Text>
                  </View>
                  {/* Ej aktiverat badge */}
                  {!u.invite_used && (
                    <View style={{ backgroundColor: '#FF950018', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
                      <Text style={{ color: '#FF9500', fontSize: 11, fontWeight: '600' }}>Ej aktiverat</Text>
                    </View>
                  )}
                  {/* Radera button */}
                  <TouchableOpacity
                    onPress={() => handleDelete(u)}
                    disabled={isActing}
                    style={{ backgroundColor: '#FF3B3015', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: '#FF3B3040' }}
                  >
                    {rowLoading[u.id] === 'delete'
                      ? <ActivityIndicator size="small" color="#FF3B30" />
                      : <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '600' }}>Radera</Text>
                    }
                  </TouchableOpacity>
                </View>

                {/* Row 2: phone */}
                <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 10 }}>{u.phone}</Text>

                {/* Row 3: Ny inbjudningskod */}
                <TouchableOpacity
                  onPress={() => handleNewInviteCode(u)}
                  disabled={isActing}
                  style={{ alignSelf: 'flex-start', backgroundColor: T.card, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 0.5, borderColor: T.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  {rowLoading[u.id] === 'invite'
                    ? <ActivityIndicator size="small" color={T.accent} />
                    : <Text style={{ color: T.text, fontSize: 13, fontWeight: '500' }}>Ny inbjudningskod</Text>
                  }
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
type ScreenView = 'login' | 'calendar' | 'my-bookings' | 'admin' | 'form' | 'users';

export default function BookingScreen() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { view: viewParam, bookingId: bookingIdParam, filter: filterParam, date: dateParam } = useLocalSearchParams<{ view?: string; bookingId?: string; filter?: string; date?: string }>();
  const { refresh: refreshBookingNotif } = useBookingNotif();

  const [storageReady, setStorageReady] = useState(false);
  const [bookings, setBookings] = useState<any[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [detailOcc, setDetailOcc] = useState<{ occ: any; booking: any } | null>(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [view, setView] = useState<ScreenView>('login');

  // Disable the Stack navigator's full-screen swipe-back gesture while the
  // booking form is open — the form has its own back button and the swipe
  // conflicts with the time-picker's horizontal scroll.
  useEffect(() => {
    const inForm = view === 'form';
    navigation.setOptions({
      gestureEnabled: !inForm,
      fullScreenGestureEnabled: !inForm,
    });
  }, [navigation, view]);
  const [loggedInUser, setLoggedInUser] = useState<{ id: string; name: string; role: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(() => { const t = new Date(); t.setHours(0,0,0,0); return t; });
  const suppressFetchRef = useRef(0);
  // IDs admin deleted locally — protected from being restored by any stale fetch
  // until the DB itself confirms status === 'deleted'. Self-cleaning.
  const locallyDeletedIdsRef = useRef<Set<string>>(new Set());
  // IDs admin cancelled locally — protected from being restored by a stale fetch
  // (suppress window alone is insufficient when opt.resolved_at === row.resolved_at).
  // Until the DB confirms status === 'cancelled', keep the local version. Self-cleaning.
  const locallyCancelledIdsRef = useRef<Set<string>>(new Set());
  // Exceptions admin added locally — key: booking_id+'_'+exception_date
  // Protected from being wiped by a stale exceptions fetch. Self-cleaning.
  const locallyAddedExcsRef = useRef<Map<string, any>>(new Map());
  // Mirror of the bookings state — kept in sync each render so async callbacks
  // (handleAdminCancelBooking) can read the current booking without capturing
  // a stale closure. Never used to drive renders — refs only.
  const bookingsRef = useRef<any[]>([]);
  // Sync bookingsRef every render (must come AFTER bookingsRef declaration above).
  bookingsRef.current = bookings;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  // Offline booking queue
  const { submitBooking: submitOffline, offlineStatus } = useOfflineBookingNative({
    onSuccess: (booking, skipDates) => {
      setBookings(prev => prev.some(b => b.id === booking.id) ? prev : [booking, ...prev]);
      if (skipDates.length > 0) {
        setExceptions(prev => [...prev, ...skipDates.map(date => ({ id: generateId(), booking_id: booking.id, exception_date: date, type: 'skip', created_at: Date.now() }))]);
      }
    },
    onError: err => showToast(`Fel: ${err.message}`),
  });

  // Init storage on mount
  useEffect(() => {
    (async () => {
      await initStorage();
      const userId = Storage.getItem(SK_USER_ID);
      const userName = Storage.getItem(SK_USER_NAME);
      const userRole = Storage.getItem(SK_USER_ROLE);
      const adminMode = Storage.getItem(SK_ADMIN) === 'true';
      if (userId && userName) {
        const admin = adminMode || userRole === 'admin';
        setLoggedInUser({ id: userId, name: userName, role: userRole || 'user' });
        setIsAdmin(admin);
        // Honor incoming view param (e.g. from home screen bell)
        // bookingId param always lands on calendar so the detail modal + DayPanel are both visible
        if (viewParam === 'admin' && admin && !bookingIdParam) {
          setView('admin');
        } else if (viewParam === 'my-bookings' && !bookingIdParam) {
          setView('my-bookings');
        } else {
          setView('calendar');
        }
        // Set the selected date from URL param so the calendar opens on the right day
        if (dateParam) {
          const d = parseISO(dateParam);
          d.setHours(0, 0, 0, 0);
          setSelectedDate(d);
        }
      } else {
        setView('login');
      }
      setStorageReady(true);
    })();
  }, []);

  // React to param changes on already-mounted tab screens.
  // The init effect above only runs once; these effects handle re-navigation.
  useEffect(() => {
    if (!dateParam || !storageReady) return;
    const d = parseISO(dateParam);
    d.setHours(0, 0, 0, 0);
    setSelectedDate(d);
  }, [dateParam, storageReady]); // eslint-disable-line

  useEffect(() => {
    if (!bookingIdParam || !storageReady) return;
    // Always land on calendar view so DayPanel + detail modal are both visible
    setView('calendar');
  }, [bookingIdParam, storageReady]); // eslint-disable-line

  // Fetch bookings from Supabase (silent — never toggles dbLoading after first load)
  const lastFetchTimeRef = useRef(0);
  const fetchAll = useCallback(async () => {
    const [{ data: bData }, { data: eData }] = await Promise.all([
      supabase.from('bookings').select('*').order('created_at', { ascending: false }),
      supabase.from('booking_exceptions').select('*'),
    ]);
    if (bData) {
      const withinSuppress = Date.now() < suppressFetchRef.current;
      setBookings(prev => {
        const optMap = new Map(prev.map(b => [b.id, b]));
        return bData.map(row => {
          const opt = optMap.get(row.id);
          // Tombstone: protect locally deleted IDs from any stale fetch.
          // Once DB confirms status='deleted', remove from set (self-cleaning).
          if (locallyDeletedIdsRef.current.has(row.id)) {
            if (row.status === 'deleted') {
              locallyDeletedIdsRef.current.delete(row.id);
            } else {
              return opt ?? { ...row, status: 'deleted' };
            }
          }
          // Tombstone: protect locally admin-cancelled IDs from any stale fetch.
          // Once DB confirms status='cancelled', remove from set (self-cleaning).
          if (locallyCancelledIdsRef.current.has(row.id)) {
            if (row.status === 'cancelled') {
              locallyCancelledIdsRef.current.delete(row.id);
            } else {
              // DB not yet confirmed — keep local cancelled version.
              // Fallback forces status: 'cancelled' even if opt is missing
              // (guards against React batching delay where prev lacks the update).
              return opt ? { ...opt, status: 'cancelled' } : { ...row, status: 'cancelled' };
            }
          }
          // Suppress window: keep local version if it has a newer resolved_at
          if (withinSuppress && opt && (opt.resolved_at || 0) > (row.resolved_at || 0)) return opt;
          return row;
        });
      });
    }
    if (eData) {
      setExceptions(() => {
        const eDataKeys = new Set(eData.map((e: any) => e.booking_id + '_' + e.exception_date));
        // Remove confirmed local exceptions (DB now has them)
        for (const key of locallyAddedExcsRef.current.keys()) {
          if (eDataKeys.has(key)) locallyAddedExcsRef.current.delete(key);
        }
        // Merge: DB data + any locally added not yet in DB
        const extra = [...locallyAddedExcsRef.current.values()]
          .filter(e => !eDataKeys.has(e.booking_id + '_' + e.exception_date));
        return extra.length > 0 ? [...eData, ...extra] : eData;
      });
    }
    setDbLoading(false);
    lastFetchTimeRef.current = Date.now();
  }, []);

  const hasFetchedRef = useRef(false);

  // Initial load
  useEffect(() => {
    if (!storageReady) return;
    const userId = Storage.getItem(SK_USER_ID);
    const deviceId = Storage.getItem(SK_DEVICE);
    if (!userId && !deviceId) { setDbLoading(false); return; }

    const initFetch = async () => {
      // Step 1: fetch only this user's bookings — fast, makes calendar clickable immediately
      if (userId) {
        const { data: mine } = await supabase
          .from('bookings').select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (mine && mine.length > 0) {
          setBookings(mine);
          setDbLoading(false);
        }
      }
      // Step 2: full table fetch
      await fetchAll();
      hasFetchedRef.current = true;
    };
    initFetch();
  }, [storageReady, fetchAll]);

  // Focused polling: runs only while this tab is visible — stops immediately on blur/background.
  // 8-second interval gives near-realtime UX without battery drain when the tab is not open.
  // This is the reliable backbone; Supabase realtime below is a bonus that fires faster when working.
  const focusedRef = useRef(false);
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    // Immediate refresh on focus if data is stale (>5s)
    if (hasFetchedRef.current && Date.now() - lastFetchTimeRef.current > 5_000) fetchAll();
    // Then poll every 8 seconds while focused
    const interval = setInterval(() => {
      if (hasFetchedRef.current) fetchAll();
    }, 8_000);
    return () => {
      focusedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchAll]));

  // Re-fetch when app returns to foreground (covers switching away from the app entirely)
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && hasFetchedRef.current && focusedRef.current) fetchAll();
    });
    return () => sub.remove();
  }, [fetchAll]);

  // Realtime subscription — fires instantly when Supabase delivers the event (bonus on top of polling)
  useEffect(() => {
    let timer: any = null;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(fetchAll, 400); };
    const ch = supabase.channel('booking-rn-v1')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_exceptions' }, debounced)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [fetchAll]);

  // When navigating directly to a booking (e.g. from home banner), force an immediate re-fetch
  // so the booking is guaranteed to be in state before the detail modal tries to open.
  useEffect(() => {
    if (!bookingIdParam || !hasFetchedRef.current) return;
    fetchAll();
  }, [bookingIdParam, fetchAll]); // eslint-disable-line

  const myBookingIds = useMemo(() => {
    const userId = Storage.getItem(SK_USER_ID);
    return new Set(bookings.filter(b => userId && b.user_id === userId).map(b => b.id));
  }, [bookings, loggedInUser]);

  // Auto-open booking detail modal when navigating directly to a booking (e.g. from home screen pending card).
  // Reset the guard whenever bookingIdParam changes so the same booking can be re-opened
  // on subsequent navigations (tab screens persist — ref is NOT reset on re-navigation).
  const autoOpenedIdRef = useRef<string | null>(null);
  const prevBookingIdParamRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (bookingIdParam !== prevBookingIdParamRef.current) {
      // New navigation target — reset so the effect can fire for this id
      autoOpenedIdRef.current = null;
      prevBookingIdParamRef.current = bookingIdParam;
    }
    if (!bookingIdParam || dbLoading) return;
    if (autoOpenedIdRef.current === bookingIdParam) return;
    const booking = bookings.find(b => b.id === bookingIdParam);
    if (!booking) return;
    autoOpenedIdRef.current = bookingIdParam;
    const targetDate = dateParam || booking.start_date;
    const occs = getOccurrencesForDate(bookings, exceptions, targetDate);
    const occ = occs.find(o => o.id === bookingIdParam) ?? { ...booking, date: targetDate };
    setDetailOcc({ occ, booking });
  }, [bookingIdParam, dbLoading, bookings, exceptions, dateParam]); // eslint-disable-line

  // ── Actions ──────────────────────────────────────────────────────────────────
  const handleLoginSuccess = useCallback(async (user: any) => {
    setLoggedInUser(user);
    const admin = user.role === 'admin' || Storage.getItem(SK_ADMIN) === 'true';
    setIsAdmin(admin);
    setView('calendar');
    await fetchAll();
  }, [fetchAll]);

  const handleLogout = useCallback(async () => {
    await Storage.removeItem(SK_USER_ID);
    await Storage.removeItem(SK_USER_NAME);
    await Storage.removeItem(SK_USER_ROLE);
    await Storage.removeItem(SK_PHONE);
    await Storage.removeItem(SK_ADMIN);
    setLoggedInUser(null);
    setIsAdmin(false);
    setView('login');
  }, []);

  const handleSubmitBooking = useCallback(async (formData: any) => {
    setSubmitLoading(true);
    const userId = Storage.getItem(SK_USER_ID);
    const deviceId = (() => {
      let id = Storage.getItem(SK_DEVICE);
      if (!id) { id = generateId(); Storage.setItem(SK_DEVICE, id); }
      return id;
    })();
    const booking = {
      id: generateId(), name: formData.name, phone: formData.phone,
      activity: formData.activity, notes: formData.notes || '',
      time_slot: formData.time_slot, duration_hours: formData.duration_hours,
      start_date: formData.date, end_date: formData.end_date || null,
      recurrence: formData.recurrence || 'none', status: 'pending',
      admin_comment: '', created_at: Date.now(), resolved_at: null,
      device_id: deviceId, user_id: userId,
    };
    const skipDates = formData.skip_dates || [];
    const { queued, error } = await submitOffline(booking, skipDates);
    setSubmitLoading(false);
    if (error) { showToast(`Fel: ${error.message}`); return; }
    if (!queued) {
      if (skipDates.length > 0) {
        setExceptions(prev => [...prev, ...skipDates.map((date: string) => ({ id: generateId(), booking_id: booking.id, exception_date: date, type: 'skip', created_at: Date.now() }))]);
      }
      showToast(skipDates.length > 0 ? `Förfrågan skickad — ${skipDates.length} krockar hoppades över!` : 'Bokningsförfrågan skickad!');
    } else {
      setBookings(prev => prev.some(b => b.id === booking.id) ? prev : [booking, ...prev]);
    }
    setView('calendar');
  }, [submitOffline, showToast]);

  const handleCancelOccurrence = useCallback(async (booking: any, occurrenceDate: string | null) => {
    const uName = Storage.getItem(SK_USER_NAME) || 'Besökaren';
    const comment = `Avbokad av ${uName}.`;
    suppressFetchRef.current = Date.now() + 5000;
    if (!occurrenceDate || booking.recurrence === 'none') {
      const { error } = await supabase.from('bookings').update({ status: 'cancelled', admin_comment: comment, resolved_at: Date.now() }).eq('id', booking.id);
      if (error) { showToast('Något gick fel.'); return; }
      setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: 'cancelled', admin_comment: comment } : b));
    } else {
      const exc = { id: generateId(), booking_id: booking.id, exception_date: occurrenceDate, type: 'skip', created_at: Date.now() };
      const { error } = await supabase.from('booking_exceptions').insert([exc]);
      if (error) { showToast('Något gick fel.'); return; }
      setExceptions(prev => [...prev, exc]);
    }
    showToast('Tillfälle avbokat.');
  }, [showToast]);

  const handleAdminApprove = useCallback(async (id: string, comment: string) => {
    suppressFetchRef.current = Date.now() + 5000;
    const resolved_at = Date.now();
    const { error } = await supabase.from('bookings').update({ status: 'approved', admin_comment: comment, resolved_at }).eq('id', id);
    if (error) { suppressFetchRef.current = 0; showToast('Något gick fel. Försök igen.'); return; }
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'approved', admin_comment: comment, resolved_at } : b));
    showToast('Bokning godkänd!');
    refreshBookingNotif();
  }, [showToast, refreshBookingNotif]);

  const handleAdminReject = useCallback(async (id: string, comment: string) => {
    suppressFetchRef.current = Date.now() + 5000;
    const resolved_at = Date.now();
    const { error } = await supabase.from('bookings').update({ status: 'rejected', admin_comment: comment, resolved_at }).eq('id', id);
    if (error) { suppressFetchRef.current = 0; showToast('Något gick fel. Försök igen.'); return; }
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'rejected', admin_comment: comment, resolved_at } : b));
    showToast('Bokning avböjd.');
    refreshBookingNotif();
  }, [showToast, refreshBookingNotif]);

  const handleAdminDelete = useCallback(async (id: string) => {
    Alert.alert('Radera bokning', 'Är du säker på att du vill radera hela bokningen?', [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Radera', style: 'destructive', onPress: async () => {
          suppressFetchRef.current = Date.now() + 5000;
          const deleted_by = Storage.getItem(SK_USER_ID) ?? '';
          const adminName = Storage.getItem(SK_USER_NAME) ?? 'Admin';
          const admin_comment = `Raderad av ${adminName}.`;
          const resolved_at = Date.now();
          locallyDeletedIdsRef.current.add(id);
          // deleted_by omitted — RLS blocks it via anon key; admin_comment encodes the admin name
          await supabase.from('bookings').update({ status: 'deleted', admin_comment, resolved_at }).eq('id', id);
          setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'deleted', admin_comment, resolved_at, deleted_by } : b));
          showToast('Bokning raderad.');
          refreshBookingNotif();
        },
      },
    ]);
  }, [showToast, refreshBookingNotif]);

  const handleAdminDeleteOcc = useCallback(async (occ: any) => {
    const booking = bookings.find(b => b.id === occ.id);
    if (!booking) return;
    const deleted_by = Storage.getItem(SK_USER_ID) ?? '';
    const adminName = Storage.getItem(SK_USER_NAME) ?? 'Admin';
    const admin_comment = `Raderad av ${adminName}.`;
    if (booking.recurrence !== 'none') {
      Alert.alert('Radera tillfälle', 'Vill du radera bara detta tillfälle eller hela serien?', [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Bara detta', onPress: async () => {
            // deleted_by omitted from insert — RLS blocks it via anon key
            const exc = { id: generateId(), booking_id: booking.id, exception_date: occ.date, type: 'skip', admin_comment, created_at: Date.now() };
            locallyAddedExcsRef.current.set(booking.id + '_' + occ.date, exc);
            await supabase.from('booking_exceptions').insert([exc]);
            setExceptions(prev => [...prev, { ...exc, deleted_by }]);
            showToast('Tillfälle raderat.');
          },
        },
        {
          text: 'Hela serien', style: 'destructive', onPress: async () => {
            const resolved_at = Date.now();
            locallyDeletedIdsRef.current.add(booking.id);
            // deleted_by omitted — RLS blocks it via anon key
            await supabase.from('bookings').update({ status: 'deleted', admin_comment, resolved_at }).eq('id', booking.id);
            setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: 'deleted', admin_comment, resolved_at, deleted_by } : b));
            showToast('Serien raderad.');
          },
        },
      ]);
    } else {
      Alert.alert('Radera bokning', 'Är du säker?', [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Radera', style: 'destructive', onPress: async () => {
            const resolved_at = Date.now();
            locallyDeletedIdsRef.current.add(booking.id);
            // deleted_by omitted — RLS blocks it via anon key
            await supabase.from('bookings').update({ status: 'deleted', admin_comment, resolved_at }).eq('id', booking.id);
            setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: 'deleted', admin_comment, resolved_at, deleted_by } : b));
            showToast('Bokning raderad.');
          },
        },
      ]);
    }
  }, [bookings, showToast]);

  const handleAdminSkipOccDirect = useCallback((bookingId: string, date: string) => {
    Alert.alert('Radera tillfälle', `Är du säker på att du vill radera detta tillfälle (${isoToDisplay(date)})?`, [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Radera', style: 'destructive', onPress: async () => {
          const deleted_by = Storage.getItem(SK_USER_ID) ?? '';
          const adminName = Storage.getItem(SK_USER_NAME) ?? 'Admin';
          const admin_comment = `Raderad av ${adminName}.`;
          // deleted_by omitted from insert — RLS blocks it via anon key
          const exc = { id: generateId(), booking_id: bookingId, exception_date: date, type: 'skip', admin_comment, created_at: Date.now() };
          locallyAddedExcsRef.current.set(bookingId + '_' + date, exc);
          await supabase.from('booking_exceptions').insert([exc]);
          setExceptions(prev => [...prev, { ...exc, deleted_by }]);
          showToast('Tillfälle raderat.');
        },
      },
    ]);
  }, [showToast]);

  const handleAdminSkipOcc = useCallback(async (bookingId: string, date: string) => {
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;
    const deleted_by = Storage.getItem(SK_USER_ID) ?? '';
    const adminName = Storage.getItem(SK_USER_NAME) ?? 'Admin';
    const admin_comment = `Raderad av ${adminName}.`;
    if (booking.recurrence !== 'none') {
      Alert.alert('Radera tillfälle', 'Vill du radera bara detta tillfälle eller hela serien?', [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Bara detta', onPress: async () => {
            // deleted_by omitted from insert — RLS blocks it via anon key
            const exc = { id: generateId(), booking_id: bookingId, exception_date: date, type: 'skip', admin_comment, created_at: Date.now() };
            locallyAddedExcsRef.current.set(bookingId + '_' + date, exc);
            await supabase.from('booking_exceptions').insert([exc]);
            setExceptions(prev => [...prev, { ...exc, deleted_by }]);
            showToast('Tillfälle raderat.');
          },
        },
        {
          text: 'Hela serien', style: 'destructive', onPress: async () => {
            const resolved_at = Date.now();
            locallyDeletedIdsRef.current.add(bookingId);
            // deleted_by omitted — RLS blocks it via anon key
            await supabase.from('bookings').update({ status: 'deleted', admin_comment, resolved_at }).eq('id', bookingId);
            setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'deleted', admin_comment, resolved_at, deleted_by } : b));
            showToast('Serien raderad.');
          },
        },
      ]);
    } else {
      Alert.alert('Radera bokning', 'Är du säker?', [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Radera', style: 'destructive', onPress: async () => {
            const resolved_at = Date.now();
            locallyDeletedIdsRef.current.add(bookingId);
            // deleted_by omitted — RLS blocks it via anon key
            await supabase.from('bookings').update({ status: 'deleted', admin_comment, resolved_at }).eq('id', bookingId);
            setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'deleted', admin_comment, resolved_at, deleted_by } : b));
            showToast('Bokning raderad.');
          },
        },
      ]);
    }
  }, [bookings, showToast]);

  // Admin cancel with mandatory reason — sets status to 'cancelled' (keeps record, notifies user).
  // The Supabase webhook on UPDATE fires booking-status-notification automatically,
  // identical to how approve/reject notifications work.
  const handleAdminCancelBooking = useCallback(async (id: string, reason: string) => {
    const deleted_by = Storage.getItem(SK_USER_ID);
    if (!deleted_by) { showToast('Session utgången. Logga in på nytt.'); return; }
    suppressFetchRef.current = Date.now() + 5000;
    const adminName = Storage.getItem(SK_USER_NAME) ?? 'Admin';
    const admin_comment = `Avbokad av ${adminName}: ${reason}`;
    const resolved_at = Date.now();

    // ── Optimistic update ───────────────────────────────────────────────────
    locallyCancelledIdsRef.current.add(id);
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled', admin_comment, resolved_at, deleted_by } : b));

    const { error } = await supabase.from('bookings').update({ status: 'cancelled', admin_comment, resolved_at }).eq('id', id);
    if (error) {
      locallyCancelledIdsRef.current.delete(id);
      suppressFetchRef.current = 0;
      fetchAll();
      showToast(`Något gick fel: ${error.message}`);
      return;
    }

    showToast('Bokning avbokad.');
    refreshBookingNotif();
    // Push notification is sent by the Supabase webhook (same as for approve/reject).
  }, [showToast, refreshBookingNotif, fetchAll]);

  // Admin cancel occurrence with mandatory reason
  const handleAdminCancelOccurrence = useCallback(async (bookingId: string, date: string, reason: string) => {
    const adminName = Storage.getItem(SK_USER_NAME) ?? 'Admin';
    const admin_comment = `Avbokat av ${adminName}: ${reason}`;
    // deleted_by omitted — not a column in booking_exceptions; admin_comment encodes the name
    const exc = { id: generateId(), booking_id: bookingId, exception_date: date, type: 'skip', admin_comment, created_at: Date.now() };
    const { error } = await supabase.from('booking_exceptions').insert([exc]);
    if (error) { showToast('Något gick fel. Försök igen.'); return; }
    // Tombstone + local state added AFTER confirmed DB write.
    locallyAddedExcsRef.current.set(bookingId + '_' + date, exc);
    setExceptions(prev => [...prev, exc]);
    showToast('Tillfälle avbokat.');
  }, [showToast]);

  const handleMarkAdminSeen = useCallback(() => {
    Storage.setItem(SK_ADMIN_SEEN, Date.now().toString());
  }, []);

  // Pending count for admin badge
  const pendingCount = useMemo(() => bookings.filter(b => b.status === 'pending' || b.status === 'edit_pending').length, [bookings]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Header — only for login and calendar */}
      {(view === 'login' || view === 'calendar') && (
        <View style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: view === 'login' ? 0 : 0.5, borderColor: T.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <BackButton onPress={() => router.back()} />
            <Text style={{ fontSize: 28, fontWeight: '800', color: T.text, letterSpacing: -0.5 }}>
              {view === 'login' ? 'Lokalbokningar' : 'Boka lokal'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {loggedInUser && view === 'calendar' && (
              <>
                <TouchableOpacity onPress={() => setView('my-bookings')} style={{ backgroundColor: T.card, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 0.5, borderColor: T.border }}>
                  <Text style={{ color: T.text, fontSize: 13, fontWeight: '600' }}>Mina</Text>
                </TouchableOpacity>
                {isAdmin && (
                  <TouchableOpacity onPress={() => setView('admin')} style={{ backgroundColor: pendingCount > 0 ? T.accent : T.card, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 0.5, borderColor: pendingCount > 0 ? T.accent : T.border }}>
                    <Text style={{ color: pendingCount > 0 ? '#fff' : T.text, fontSize: 13, fontWeight: '600' }}>
                      Admin{pendingCount > 0 ? ` (${pendingCount})` : ''}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => Alert.alert('Logga ut', `Logga ut som ${loggedInUser.name}?`, [
                  { text: 'Avbryt', style: 'cancel' },
                  { text: 'Logga ut', onPress: handleLogout },
                ])} style={{ backgroundColor: T.card, borderRadius: 20, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: T.border }}>
                  <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                    <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke={T.textMuted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    <Polyline points="16 17 21 12 16 7" stroke={T.textMuted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    <Line x1="21" y1="12" x2="9" y2="12" stroke={T.textMuted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </Svg>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}

      {/* Login */}
      {view === 'login' && <UserLogin onSuccess={handleLoginSuccess} T={T} />}

      {/* Calendar — always rendered as background when logged in */}
      {view !== 'login' && (
        <View style={{ flex: 1 }}>
          {dbLoading
            ? <SpinnerView color={T.accent} />
            : (
              <>
                <CalendarView bookings={bookings.filter(b => b.status !== 'deleted')} exceptions={exceptions} selectedDate={selectedDate} onSelectDate={setSelectedDate} T={T} />
                <DayPanel
                  date={selectedDate} bookings={bookings.filter(b => b.status !== 'deleted')} exceptions={exceptions}
                  myBookingIds={myBookingIds} isAdmin={isAdmin}
                  onAdd={() => setView('form')}
                  onCancelOccurrence={handleCancelOccurrence}
                  onAdminDelete={handleAdminDeleteOcc}
                  onPressRow={(occ, booking) => setDetailOcc({ occ, booking })}
                  T={T}
                />
              </>
            )
          }
        </View>
      )}

      {/* Sub-views — render as absoluteFill with slide animation */}
      {view === 'form' && (
        <BookingForm
          date={selectedDate} bookings={bookings} exceptions={exceptions}
          onSubmit={handleSubmitBooking} onBack={() => setView('calendar')}
          loading={submitLoading} T={T}
        />
      )}

      {view === 'my-bookings' && (
        <MyBookings
          bookings={bookings} exceptions={exceptions} myBookingIds={myBookingIds}
          onCancel={handleCancelOccurrence}
          onBack={() => setView('calendar')}
          initialBookingId={bookingIdParam}
          T={T}
        />
      )}

      {view === 'admin' && (
        <AdminPanel
          bookings={bookings} exceptions={exceptions}
          onBack={() => setView('calendar')}
          onUsers={() => setView('users')}
          onApprove={handleAdminApprove}
          onReject={handleAdminReject}
          onDelete={handleAdminCancelBooking}
          initialFilter={filterParam}
          onDeleteOccurrence={handleAdminCancelOccurrence}
          onMarkSeen={handleMarkAdminSeen}
          T={T}
        />
      )}

      {view === 'users' && (
        <UserManagement onBack={() => setView('admin')} T={T} />
      )}

      {/* Overlays */}
      <ToastView message={toast} />
      <OfflineStatusBar status={offlineStatus} isDark={isDark} accent={T.accent} />

      {/* Booking detail modal */}
      {detailOcc && (
        <BookingDetailModal
          occ={detailOcc.occ}
          booking={detailOcc.booking}
          isAdmin={isAdmin}
          isOwn={myBookingIds.has(detailOcc.booking.id)}
          onClose={() => setDetailOcc(null)}
          onCancel={() => handleCancelOccurrence(detailOcc.booking, detailOcc.booking.recurrence !== 'none' ? detailOcc.occ.date : null)}
          onApprove={handleAdminApprove}
          onReject={handleAdminReject}
          onDelete={handleAdminCancelBooking}
          onDeleteOccurrence={handleAdminCancelOccurrence}
          T={T}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    backgroundColor: 'rgba(28,28,30,0.92)',
    paddingVertical: 12, paddingHorizontal: 22,
    borderRadius: 14,
  },
  errorBox: {
    backgroundColor: '#FF3B3018',
    borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 4,
  },
  navBtn: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 0.5,
    // borderColor is intentionally omitted here — it is passed inline with T.border
    // so it adapts to both dark mode (rgba(255,255,255,0.1)) and light mode (rgba(0,0,0,0.08)).
    alignItems: 'center', justifyContent: 'center',
  },
});
