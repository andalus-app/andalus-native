import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GEOCODE_CACHE_KEY = 'andalus_geocode_cache';

export type GeoResult = { city: string; subLocality: string; country: string };

async function loadCache(): Promise<Record<string, GeoResult>> {
  try {
    const raw = await AsyncStorage.getItem(GEOCODE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function saveCache(cache: Record<string, GeoResult>): Promise<void> {
  try { await AsyncStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * Resolve a human-readable location using the device's native geocoder.
 * Returns city (locality) and subLocality (district/area) as separate fields.
 * Fallback hierarchy: subLocality → city → region.
 * Falls back to last cached result if native geocoding fails.
 * Never returns coordinates or "Unknown location".
 */
export async function nativeReverseGeocode(lat: number, lng: number): Promise<GeoResult> {
  const key = cacheKey(lat, lng);

  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (results && results.length > 0) {
      const r = results[0];
      // On iOS CLGeocoder, r.city = postal locality (e.g. "Spånga"),
      // r.subregion = municipality (e.g. "Stockholm") — use subregion as the main city.
      const locality    = r.city       || '';
      const municipality = r.subregion || '';
      const region       = r.region    || '';
      const city = municipality || locality || region;
      // subLocality = postal locality when it differs from the chosen city
      const subLocality = locality && locality !== city ? locality : (r.district || '');
      const country = r.country || '';

      if (city || subLocality) {
        const result: GeoResult = { city, subLocality, country };
        const cache = await loadCache();
        cache[key] = result;
        await saveCache(cache);
        return result;
      }
    }
  } catch {}

  // Fall back to cached result for this coordinate
  const cache = await loadCache();
  if (cache[key]) return cache[key];

  // Last resort: most recent cached entry
  const entries = Object.values(cache);
  if (entries.length > 0) return entries[entries.length - 1];

  return { city: '', subLocality: '', country: '' };
}
