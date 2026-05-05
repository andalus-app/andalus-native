import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPrayerTimes, fetchTomorrowPrayerTimes, calcMidnight } from './prayerApi';
import { schedulePrayerNotifications, refreshPrePrayerReminderNotifications } from './notifications';
import { nativeReverseGeocode } from './geocoding';

export const BACKGROUND_LOCATION_TASK = 'HIDAYAH_BACKGROUND_LOCATION';

const MIN_MOVE_METERS = 500;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTodayStr(): string {
  const n = new Date();
  return (
    String(n.getDate()).padStart(2, '0') + '-' +
    String(n.getMonth() + 1).padStart(2, '0') + '-' +
    n.getFullYear()
  );
}

// Must be at module root — expo-task-manager requirement.
// Fires when device moves ≥ distanceInterval meters in background/foreground.
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) return;
  const locations = (data as { locations: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;

  const { coords } = locations[locations.length - 1];

  try {
    const stored = await AsyncStorage.getItem('andalus_location');
    if (!stored) return;
    const storedLoc = JSON.parse(stored) as { lat: number; lng: number };

    if (distanceMeters(storedLoc.lat, storedLoc.lng, coords.latitude, coords.longitude) < MIN_MOVE_METERS) return;

    const geo = await nativeReverseGeocode(coords.latitude, coords.longitude);
    const city = geo.subLocality && geo.city && geo.subLocality !== geo.city
      ? `${geo.subLocality}, ${geo.city}`
      : geo.city || geo.subLocality || '';
    const country = geo.country;

    const settingsRaw = await AsyncStorage.getItem('andalus_settings');
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    const method: number = settings.calculationMethod ?? 3;
    const school: number = settings.school ?? 0;

    const [todayRes, tomTimings] = await Promise.all([
      fetchPrayerTimes(coords.latitude, coords.longitude, getTodayStr(), method, school),
      fetchTomorrowPrayerTimes(coords.latitude, coords.longitude, method, school),
    ]);
    const todayT = { ...todayRes.timings, Midnight: calcMidnight(todayRes.timings.Maghrib, tomTimings.Fajr) || '' };
    const tomT   = { ...tomTimings, Midnight: '' };

    // Update andalus_location (used by pre-prayer reminder scheduler + notifications)
    await AsyncStorage.setItem('andalus_location', JSON.stringify({
      lat: coords.latitude,
      lng: coords.longitude,
      city,
      country,
    }));

    // Update andalus_app_state so AppContext hydrates the correct location on next open
    const appStateRaw = await AsyncStorage.getItem('andalus_app_state');
    if (appStateRaw) {
      const appState = JSON.parse(appStateRaw);
      appState.location = { latitude: coords.latitude, longitude: coords.longitude, city, country };
      await AsyncStorage.setItem('andalus_app_state', JSON.stringify(appState));
    }

    // Reschedule all notifications for the new location
    await schedulePrayerNotifications(todayT, tomT, city);
    await refreshPrePrayerReminderNotifications(); // reads updated andalus_location
  } catch {}
});

/** Call when autoLocation is enabled. No-op if background permission not granted or task already running. */
export async function startBackgroundLocationUpdates(): Promise<void> {
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== 'granted') return;

    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK)) return;

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 1000,              // fire only after 1 km movement
      timeInterval: 300_000,               // Android: min 5 min between updates
      pausesUpdatesAutomatically: true,    // iOS: pause when stationary
      activityType: Location.ActivityType.OtherNavigation,
      showsBackgroundLocationIndicator: false,
      foregroundService: {                 // Android: required for background location
        notificationTitle: 'Hidayah',
        notificationBody: 'Uppdaterar bönetider baserat på din plats',
        notificationColor: '#18311e',
      },
    });
  } catch {}
}

/** Call when autoLocation is disabled. No-op if task is not running. */
export async function stopBackgroundLocationUpdates(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {}
}
