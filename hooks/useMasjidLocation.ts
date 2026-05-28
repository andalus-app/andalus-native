/**
 * useMasjidLocation — foreground location permission state for "Närmaste masjid".
 *
 * Permission-only by design: it never reads GPS, mounts a map, or starts a
 * watcher. The screen does that ONLY after `status === 'granted'`, so nothing
 * heavy runs before access is granted.
 *
 * Re-checks on mount and whenever the app returns to the foreground (so a user
 * who toggled the permission in Settings is picked up on return). The single
 * AppState listener is removed on unmount.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';

export type MasjidPermissionStatus = 'checking' | 'undetermined' | 'granted' | 'denied';

export function useMasjidLocation() {
  const [status, setStatus] = useState<MasjidPermissionStatus>('checking');
  const [requesting, setRequesting] = useState(false);
  const mountedRef = useRef(true);

  const recheck = useCallback(async () => {
    try {
      const res = await Location.getForegroundPermissionsAsync();
      if (!mountedRef.current) return;
      if (res.granted) setStatus('granted');
      else if (res.status === 'undetermined' && res.canAskAgain) setStatus('undetermined');
      else setStatus('denied');
    } catch {
      if (mountedRef.current) setStatus('denied');
    }
  }, []);

  const requestPermission = useCallback(async () => {
    setRequesting(true);
    try {
      const current = await Location.getForegroundPermissionsAsync();
      if (current.granted) {
        if (mountedRef.current) setStatus('granted');
        return;
      }
      if (current.canAskAgain) {
        // Never asked (or still askable) → show the system prompt.
        const res = await Location.requestForegroundPermissionsAsync();
        if (!mountedRef.current) return;
        setStatus(res.granted ? 'granted' : 'denied');
      } else {
        // Previously denied → can't prompt again; open the app's Settings.
        // On return (AppState 'active') the effect re-checks automatically.
        await Linking.openSettings();
      }
    } catch {
      /* swallow — leave status as-is, user can retry */
    } finally {
      if (mountedRef.current) setRequesting(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    recheck();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') recheck();
    });
    return () => {
      mountedRef.current = false;
      sub.remove();
    };
  }, [recheck]);

  return { status, requesting, requestPermission, recheck };
}
