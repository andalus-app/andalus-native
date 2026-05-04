/**
 * BookingNotifContext — matches PWA useBookingNotifications.js exactly.
 *
 * Admin:
 *   pendingCount   = live count of pending + edit_pending (always raw DB, never zeroed by "seen")
 *   cancelledCount = user-initiated cancellations since last markAllSeen() timestamp
 *   bookingNotifs  = [] always — admin sees summary cards, not individual rows
 *
 * Visitor:
 *   bookingNotifs = own resolved bookings (approved/rejected/cancelled/edited), per-ID dismissed
 *   totalUnread   = bookingNotifs.filter(n => n.isNew).length
 */
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { Storage } from '../services/storage';
import { getExpoPushToken, requestNotificationPermission } from '../services/notifications';

const SK_USER_ID    = 'islamnu_user_id';
const SK_USER_NAME  = 'islamnu_user_name';
const SK_USER_ROLE  = 'islamnu_user_role';
const SK_DISMISSED  = 'islamnu_notif_dismissed_ids';
// Timestamp (unix ms) of when admin last opened the bell — same key as PWA
const SK_ADMIN_SEEN = 'islamnu_bookings_admin_seen';

const DEBOUNCE_MS = 1200;

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadDismissedIds(): Set<string> {
  try {
    const raw = Storage.getItem(SK_DISMISSED);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

async function saveDismissedIds(set: Set<string>) {
  const arr = [...set].slice(-500);
  await Storage.setItem(SK_DISMISSED, JSON.stringify(arr));
}

// ── Types ────────────────────────────────────────────────────────────────────

export type BookingNotif = {
  id: string;
  activity: string;
  startDate: string;
  timeSlot: string;
  status: 'approved' | 'rejected' | 'cancelled' | 'edited' | 'pending' | 'edit_pending';
  adminComment: string | null;
  isNew: boolean;
  isException?: boolean;
};

export type PendingBooking = {
  id: string;
  startDate: string;
  activity: string;
  timeSlot: string;
  name: string;
};

type BookingNotifContextType = {
  pendingCount: number;
  cancelledCount: number;
  pendingBookings: PendingBooking[];
  bookingNotifs: BookingNotif[];
  totalUnread: number;
  isAdmin: boolean;
  isLoggedIn: boolean;
  dismissNotif: (id: string, status: string) => Promise<void>;
  markAllSeen: () => Promise<void>;
  refresh: () => Promise<void>;
};

const BookingNotifContext = createContext<BookingNotifContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function BookingNotifProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount,    setPendingCount]    = useState(0);
  const [cancelledCount,  setCancelledCount]  = useState(0);
  const [pendingBookings, setPendingBookings] = useState<PendingBooking[]>([]);
  const [bookingNotifs,   setBookingNotifs]   = useState<BookingNotif[]>([]);
  const [isAdmin,        setIsAdmin]        = useState(false);
  const [isLoggedIn,     setIsLoggedIn]     = useState(false);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchingRef  = useRef(false);
  const dismissedRef = useRef<Set<string>>(loadDismissedIds());

  const refresh = useCallback(async () => {
    // Guard: skip if a fetch is already in flight.
    // Without this, rapid tab-switching causes N concurrent Supabase queries (2-3 per call),
    // each returning and calling multiple setState() — overloading the JS thread and freezing the app.
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
    const userId    = Storage.getItem(SK_USER_ID);
    const userRole  = Storage.getItem(SK_USER_ROLE);
    const adminFlag = userRole === 'admin' || userRole === 'superadmin';
    setIsAdmin(adminFlag);
    setIsLoggedIn(!!userId);

    if (!userId) return;

    // ── Admin path ─────────────────────────────────────────────────────────
    if (adminFlag) {
      // 1. Raw pending count — always the live DB total, never filtered by "seen"
      const { data: pendingData } = await supabase
        .from('bookings')
        .select('id, status, start_date, activity, time_slot, name')
        .in('status', ['pending', 'edit_pending'])
        .order('start_date', { ascending: true });
      setPendingCount(pendingData?.length ?? 0);
      setPendingBookings(pendingData?.map(b => ({
        id:        b.id,
        startDate: b.start_date ?? '',
        activity:  b.activity ?? 'Bokning',
        timeSlot:  b.time_slot ?? '',
        name:      b.name ?? '',
      })) ?? []);

      // 2. User-initiated cancellations since last time admin opened the bell
      const adminSeenAt   = parseInt(Storage.getItem(SK_ADMIN_SEEN) ?? '0', 10);
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      // Convert to ISO — Supabase .gt() on timestamptz columns requires ISO string, not unix ms
      const cancelSince   = new Date(adminSeenAt > 0 ? adminSeenAt : thirtyDaysAgo).toISOString();
      const adminName     = Storage.getItem(SK_USER_NAME) ?? '';

      const isUserCancellation = (comment: string | null) => {
        if (!comment) return false;
        if (!comment.startsWith('Avbokad av ')) return false;
        if (adminName) {
          if (comment.startsWith('Avbokad av ' + adminName + ':') ||
              comment.startsWith('Avbokad av ' + adminName + '.')) return false;
        }
        return true;
      };

      const [{ data: cancelData }, { data: excCancelData }] = await Promise.all([
        supabase.from('bookings')
          .select('id, admin_comment')
          .eq('status', 'cancelled')
          .gt('resolved_at', cancelSince),
        supabase.from('booking_exceptions')
          .select('id, booking_id, admin_comment')
          .eq('type', 'skip')
          .gt('created_at', cancelSince)
          .not('admin_comment', 'is', null),
      ]);

      const cancelledIds = new Set<string>();
      (cancelData ?? [])
        .filter((b: any) => isUserCancellation(b.admin_comment))
        .forEach((b: any) => cancelledIds.add(b.id));
      (excCancelData ?? [])
        .filter((e: any) => isUserCancellation(e.admin_comment))
        .forEach((e: any) => cancelledIds.add(e.booking_id));
      setCancelledCount(cancelledIds.size);
      return;
    }

    // ── Visitor path ───────────────────────────────────────────────────────
    const userName  = Storage.getItem(SK_USER_NAME) ?? '';
    const dismissed = dismissedRef.current;

    const { data } = await supabase
      .from('bookings')
      .select('id, activity, start_date, time_slot, status, resolved_at, admin_comment, recurrence')
      .eq('user_id', userId)
      .in('status', ['approved', 'rejected', 'cancelled', 'edited', 'deleted'])
      .order('resolved_at', { ascending: false })
      .limit(50);

    if (!data) return;

    const isSelfCancellation = (comment: string | null) => {
      if (!comment || !userName) return false;
      return (
        comment.startsWith('Avbokad av ' + userName + ':') ||
        comment.startsWith('Avbokad av ' + userName + '.')
      );
    };

    const bookingNotifsList: BookingNotif[] = data
      .filter(b => {
        if (!b.resolved_at) return false;
        // 'deleted' without admin_comment = hard delete with no message — skip
        if (b.status === 'deleted' && !b.admin_comment) return false;
        // 'cancelled' without admin_comment = user self-cancel — skip
        if (b.status === 'cancelled' && !b.admin_comment) return false;
        // Map 'deleted' → 'cancelled' for dismissed key lookup
        const displayStatus = b.status === 'deleted' ? 'cancelled' : b.status;
        if (dismissed.has(b.id + '_' + displayStatus)) return false;
        if (isSelfCancellation(b.admin_comment)) return false;
        return true;
      })
      .map(b => {
        const displayStatus = (b.status === 'deleted' ? 'cancelled' : b.status) as BookingNotif['status'];
        return {
          id:          b.id,
          activity:    b.activity ?? 'Bokning',
          startDate:   b.start_date ?? '',
          timeSlot:    b.time_slot ?? '',
          status:      displayStatus,
          adminComment: b.admin_comment ?? null,
          isNew:       !dismissed.has(b.id + '_' + displayStatus),
          isException: false,
        };
      });

    // Occurrence-level cancellations for recurring bookings
    const recurringIds = data
      .filter(b => b.recurrence && b.recurrence !== 'none' && b.status !== 'cancelled' && b.status !== 'rejected')
      .map(b => b.id);

    let excNotifs: BookingNotif[] = [];
    if (recurringIds.length > 0) {
      const { data: excData } = await supabase
        .from('booking_exceptions')
        .select('id, booking_id, exception_date, admin_comment')
        .in('booking_id', recurringIds)
        .eq('type', 'skip')
        .not('admin_comment', 'is', null);

      if (excData) {
        excNotifs = excData
          .filter(e => {
            if (!e.admin_comment) return false;
            const excKey = e.booking_id + '_exc_' + e.exception_date + '_cancelled';
            if (dismissed.has(excKey)) return false;
            if (isSelfCancellation(e.admin_comment)) return false;
            return true;
          })
          .map(e => {
            const parent = data.find(b => b.id === e.booking_id);
            return {
              id:          e.booking_id + '_exc_' + e.exception_date,
              activity:    parent?.activity ?? 'Bokning',
              startDate:   e.exception_date ?? '',
              timeSlot:    parent?.time_slot ?? '',
              status:      'cancelled' as BookingNotif['status'],
              adminComment: e.admin_comment ?? null,
              isNew:       !dismissed.has(e.booking_id + '_exc_' + e.exception_date + '_cancelled'),
              isException: true,
            };
          });
      }
    }

    setBookingNotifs([...bookingNotifsList, ...excNotifs]);
    } catch {
      // Network error or Supabase unavailable — silent, polling will retry
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  // Foreground-only lifecycle: realtime channel + 30 s fallback poll only run
  // when the app is in the 'active' state. Both pause when backgrounded and
  // resume + immediately refresh when the user returns.
  //
  // Why: iOS bills every JS callback (timer fires, websocket message handlers,
  // promise continuations) against the audio-background CPU budget for an
  // app with UIBackgroundModes:audio. The 30 s interval + Supabase realtime
  // websocket heartbeats together consumed enough background CPU to hit
  // `memorystatus: cpulimit violation` after ~2 min of locked Quran playback
  // — confirmed in TestFlight iPhone log. The home-screen booking banner
  // doesn't need to refresh while the screen is locked, so we pause both.
  //
  // Auth gate: polling and realtime subscription only run when the user has
  // authenticated with their PIN. Unauthenticated users produce zero network
  // traffic from this context — no websocket connection, no interval.
  // isLoggedIn is set by refresh() which runs on mount (reading Storage) and
  // after every successful PIN login, so the effect re-runs automatically on
  // login (starts polling) and on logout (tears everything down).
  useEffect(() => {
    if (!isLoggedIn) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const subscribe = () => {
      if (channel) return;
      channel = supabase
        .channel('booking_notif_v3')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, debouncedRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_exceptions' }, debouncedRefresh)
        .subscribe();
      pollTimer = setInterval(() => refresh(), 30_000);
    };

    const unsubscribe = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    if (AppState.currentState === 'active') subscribe();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        subscribe();
        // Catch up on anything that changed while we were paused.
        debouncedRefresh();
      } else {
        unsubscribe();
      }
    });

    return () => {
      sub.remove();
      unsubscribe();
    };
  }, [isLoggedIn, debouncedRefresh, refresh]);

  // Register this device's Expo push token in Supabase.
  // Admins receive new-booking push notifications (booking-notification function).
  // Regular users receive approved/rejected push notifications (booking-status-notification function).
  // The `role` column lets the Edge Function filter admin-only tokens.
  useEffect(() => {
    const userId = Storage.getItem('islamnu_user_id');
    const userRole = Storage.getItem('islamnu_user_role') ?? 'user';
    if (!userId) return;
    (async () => {
      try {
        // Never request notification permission automatically — only register the push
        // token if the user has already granted permission (e.g. via onboarding).
        let N: typeof import('expo-notifications') | null = null;
        try { N = require('expo-notifications'); } catch {}
        if (N) {
          const { status } = await N.getPermissionsAsync().catch(() => ({ status: 'denied' }));
          if (status !== 'granted') return;
        }
        const token = await getExpoPushToken();
        if (!token) return; // network unavailable or permission missing — silent, savePushToken retries
        // Read announcement notification preference from saved settings
        let announcementNotif = true;
        try {
          const s = await AsyncStorage.getItem('andalus_app_state');
          if (s) announcementNotif = JSON.parse(s)?.settings?.announcementNotifications ?? true;
        } catch {}

        // Remove any stale row for this token under a different user_id (e.g. the
        // anonymous device_id row created by savePushToken before the user logged in).
        await supabase.from('push_tokens').delete().eq('token', token).neq('user_id', userId);

        const { error } = await supabase.from('push_tokens').upsert(
          { user_id: userId, token, role: userRole, announcement_notif: announcementNotif, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
        if (error) console.warn('[PushToken] upsert error:', error.message);
        else console.log('[PushToken] saved successfully for', userId);
      } catch {
        // Network error — token will be registered on next app open
      }
    })();
  }, []); // run once on mount — role is read synchronously from Storage inside

  // Dismiss a single notification — visitor only
  // key is {id}_{status} so each status change is independently dismissible
  const dismissNotif = useCallback(async (id: string, status: string) => {
    dismissedRef.current.add(id + '_' + status);
    await saveDismissedIds(dismissedRef.current);
    setBookingNotifs(prev => prev.filter(n => n.id !== id));
  }, []);

  // Called when admin/user opens the bell panel:
  // Admin   — saves current timestamp; next cancelled query starts from now
  // Visitor — adds all current notif IDs to dismissed set; marks isNew=false
  const markAllSeen = useCallback(async () => {
    if (isAdmin) {
      await Storage.setItem(SK_ADMIN_SEEN, Date.now().toString());
      setCancelledCount(0);
      // pendingCount intentionally NOT zeroed — it reflects live DB state
    } else {
      const ids = bookingNotifs.map(n => n.id + '_' + n.status);
      ids.forEach(key => dismissedRef.current.add(key));
      await saveDismissedIds(dismissedRef.current);
      setBookingNotifs(prev => prev.map(n => ({ ...n, isNew: false })));
    }
  }, [isAdmin, bookingNotifs]);

  const totalUnread = useMemo(() => {
    if (isAdmin) return pendingCount + cancelledCount;
    return bookingNotifs.filter(n => n.isNew).length;
  }, [isAdmin, pendingCount, cancelledCount, bookingNotifs]);

  const value = useMemo(() => ({
    pendingCount,
    cancelledCount,
    pendingBookings,
    bookingNotifs,
    totalUnread,
    isAdmin,
    isLoggedIn,
    dismissNotif,
    markAllSeen,
    refresh,
  }), [pendingCount, cancelledCount, pendingBookings, bookingNotifs, totalUnread, isAdmin, isLoggedIn, dismissNotif, markAllSeen, refresh]);

  return (
    <BookingNotifContext.Provider value={value}>
      {children}
    </BookingNotifContext.Provider>
  );
}

export function useBookingNotif() {
  const ctx = useContext(BookingNotifContext);
  if (!ctx) throw new Error('useBookingNotif must be used within BookingNotifProvider');
  return ctx;
}
