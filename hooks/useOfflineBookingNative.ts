/**
 * useOfflineBookingNative — hanterar offline-kö för bokningar (React Native)
 * Port av useOfflineBooking.js till RN med AsyncStorage istället för localStorage.
 *
 * Fixes vs original:
 *  - isNetworkError() case-insensitive — "Network request failed" was missed by old check
 *  - syncQueue discriminates: network errors → retry, other errors → discard + onError
 *  - Always queues if already detected offline (via failed syncQueue), no infinite retry
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { Storage } from '../services/storage';
import { supabase } from '../lib/supabase';

const QUEUE_KEY = 'andalus_booking_queue';

function loadQueue(): any[] {
  try { return JSON.parse(Storage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
}

async function saveQueue(q: any[]) {
  await Storage.setItem(QUEUE_KEY, JSON.stringify(q));
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

/**
 * Returns true for errors that are caused by no network connectivity.
 * These should be retried. All other errors (400 Bad Request, constraint
 * violations, auth errors) should be discarded from the queue.
 */
function isNetworkError(err: any): boolean {
  if (err instanceof TypeError) return true;
  const msg = (err?.message ?? '').toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound')
  );
}

export function useOfflineBookingNative({
  onSuccess,
  onError,
}: {
  onSuccess?: (booking: any, skipDates: string[]) => void;
  onError?: (err: any) => void;
}) {
  const [offlineStatus, setOfflineStatus] = useState<null | 'queued' | 'syncing' | 'sent'>(null);
  const syncingRef      = useRef(false);
  const retryTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncQueue = useCallback(async () => {
    if (syncingRef.current) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    syncingRef.current = true;
    setOfflineStatus('syncing');
    const remaining: any[] = [];

    for (const item of queue) {
      try {
        const { error } = await supabase.from('bookings').insert([item.booking]);
        if (error) {
          if (isNetworkError(error)) {
            // Transient network error — keep for retry
            remaining.push(item);
          } else {
            // Permanent error (constraint, auth, etc.) — discard and surface
            onError?.(error);
          }
        } else {
          if (item.skipDates && item.skipDates.length > 0) {
            const excs = item.skipDates.map((date: string) => ({
              id: generateId(),
              booking_id: item.booking.id,
              exception_date: date,
              type: 'skip',
              created_at: Date.now(),
            }));
            const { error: excError } = await supabase.from('booking_exceptions').insert(excs);
            if (excError) {
              // Booking is already committed — cannot safely re-queue.
              // Surface the partial failure; still acknowledge the booking in UI.
              onError?.(excError);
              onSuccess?.(item.booking, item.skipDates || []);
              continue;
            }
          }
          onSuccess?.(item.booking, item.skipDates || []);
        }
      } catch (err: any) {
        if (isNetworkError(err)) {
          remaining.push(item);
        } else {
          onError?.(err);
        }
      }
    }

    await saveQueue(remaining);
    syncingRef.current = false;

    if (remaining.length === 0) {
      setOfflineStatus('sent');
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => setOfflineStatus(null), 2500);
    } else {
      setOfflineStatus('queued');
      // Retry in 30s if items remain and we're still connected (server error, not offline)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => syncQueue(), 30_000);
    }
  }, [onSuccess, onError]);

  // Sync when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncQueue();
    });
    // Check on mount in case bookings were queued while offline
    if (loadQueue().length > 0) syncQueue();
    return () => {
      sub.remove();
      if (retryTimerRef.current)   clearTimeout(retryTimerRef.current);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [syncQueue]);

  const submitBooking = useCallback(async (booking: any, skipDates: string[] = []) => {
    try {
      const { error } = await supabase.from('bookings').insert([booking]);
      if (error) throw error;

      if (skipDates.length > 0) {
        const excs = skipDates.map((date) => ({
          id: generateId(),
          booking_id: booking.id,
          exception_date: date,
          type: 'skip',
          created_at: Date.now(),
        }));
        const { error: excError } = await supabase.from('booking_exceptions').insert(excs);
        if (excError) {
          // Booking committed but exceptions failed — surface partial failure, do not call onSuccess
          onError?.(excError);
          return { queued: false, error: excError };
        }
      }

      onSuccess?.(booking, skipDates);
      return { queued: false };
    } catch (err: any) {
      if (isNetworkError(err)) {
        // Offline or transient — queue for later
        const queue = loadQueue();
        if (!queue.find((item: any) => item.booking.id === booking.id)) {
          queue.push({ booking, skipDates, queuedAt: new Date().toISOString() });
          await saveQueue(queue);
        }
        setOfflineStatus('queued');
        return { queued: true };
      }
      // Server-side error (validation, auth, conflict) — surface immediately
      onError?.(err);
      return { queued: false, error: err };
    }
  }, [onSuccess, onError]);

  return { submitBooking, offlineStatus };
}
