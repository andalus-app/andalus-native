/**
 * Synchronous in-memory storage backed by AsyncStorage.
 * Call initStorage() once on app start before rendering booking screens.
 * After init, Storage.getItem() is synchronous (reads from cache).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const MANAGED_KEYS = [
  'islamnu_admin_mode',
  'islamnu_device_id',
  'islamnu_user_phone',
  'islamnu_user_id',
  'islamnu_user_name',
  'islamnu_user_role',
  'islamnu_is_admin_device',
  'islamnu_has_booking',
  'islamnu_bookings_admin_seen',
  'islamnu_notif_dismissed_ids',
  'islamnu_booking_bell_seen',
  'andalus_booking_queue',
  // Announcements: JSON array of { id, updated_at } for seen popup deduplication
  'islamnu_seen_popups',
];

const cache: Record<string, string | null> = {};

export async function initStorage(): Promise<void> {
  try {
    const pairs = await AsyncStorage.multiGet(MANAGED_KEYS);
    pairs.forEach(([key, value]) => {
      cache[key] = value;
    });
  } catch {}
}

export const Storage = {
  getItem(key: string): string | null {
    return cache[key] ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    cache[key] = value;
    try { await AsyncStorage.setItem(key, value); } catch {}
  },

  async removeItem(key: string): Promise<void> {
    cache[key] = null;
    try { await AsyncStorage.removeItem(key); } catch {}
  },
};
