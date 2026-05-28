/**
 * Nominatim (OpenStreetMap) forward geocoding for "Närmaste masjid" search.
 *
 * Free-text address/place → lat/lng. NO Google APIs. User-initiated only (on
 * submit), so it stays well within Nominatim's ≤1 req/sec policy; a descriptive
 * User-Agent with contact is sent as required. Biased to Sweden.
 *
 * Pass an AbortSignal so a query can be cancelled when a new search starts or
 * the feature closes.
 */
const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Hidayah-App/1.0 (mosque search; contact: fatih.koker@outlook.com)';

export type GeocodeResult = { lat: number; lng: number; label: string };

export async function geocodePlace(query: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;

  const url =
    `${NOMINATIM_SEARCH}?format=jsonv2&q=${encodeURIComponent(q)}` +
    `&limit=1&addressdetails=0&countrycodes=se&accept-language=sv`;

  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const r = data[0];
  const lat = parseFloat(r.lat);
  const lng = parseFloat(r.lon);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  return { lat, lng, label: r.display_name ?? q };
}
