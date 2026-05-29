/**
 * Nominatim (OpenStreetMap) forward geocoding.
 *
 * Two entry points, both NO-Google:
 *   • `geocodePlace(q)`     — free-text place/place-name lookup. Used by the
 *                             masjid search bar. Cheap, fuzzy, low precision.
 *   • `geocodeAddress(...)` — STRUCTURED query (street + postalcode + city,
 *                             countrycodes=se). Used by the masjid add/edit
 *                             flow so that "Fornbyvägen 29, 163 70 Stockholm"
 *                             lands on the actual house and not a random
 *                             match from another municipality. Free-text q=
 *                             on Nominatim is notoriously imprecise when the
 *                             query carries a house number + postal code; the
 *                             structured params are what its address index
 *                             actually looks at.
 *
 * User-initiated only (on open of the picker / on search submit), so it stays
 * well within Nominatim's ≤1 req/sec policy. A descriptive User-Agent with
 * contact is sent as required.
 *
 * Pass an AbortSignal so a query can be cancelled when a new search starts or
 * the feature closes.
 */
const NOMINATIM_SEARCH  = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
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

export type AddressQuery = {
  /** Free-text street incl. house number, e.g. "Fornbyvägen 29". */
  street?: string;
  /** Postal code with or without space — we collapse it to digits before sending. */
  postalCode?: string;
  city?: string;
};

// Shape we care about from Nominatim's jsonv2 results.
type NominatimRow = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: {
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
};

async function nominatimSearch(params: URLSearchParams, signal?: AbortSignal): Promise<NominatimRow[]> {
  params.set('format',         'jsonv2');
  params.set('limit',          '10');
  params.set('addressdetails', '1');
  params.set('dedupe',         '1');
  params.set('countrycodes',   'se');
  params.set('accept-language','sv');
  const res = await fetch(`${NOMINATIM_SEARCH}?${params.toString()}`, {
    signal,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data as NominatimRow[] : [];
}

function pickBestMatch(rows: NominatimRow[], postalDigits: string, city: string): NominatimRow | null {
  if (rows.length === 0) return null;
  const cityLower = city.toLowerCase();
  let best: NominatimRow | null = null;
  let bestScore = -1;

  for (const r of rows) {
    const a = r.address ?? {};
    // HARD FILTER when the user provided a postcode: skip every candidate
    // that doesn't carry the same postcode. This is the crux of the fix —
    // "Fornbyvägen 29, 163 70" must never resolve to the Sundbyberg
    // Fornbyvägen at postcode 17441, even when Nominatim returns it first.
    if (postalDigits) {
      const cp = (a.postcode ?? '').replace(/\D/g, '');
      if (!cp || cp !== postalDigits) continue;
    }
    // Tie-breaking score among the remaining candidates.
    let score = 100; // baseline so we always pick something when the filter passes
    if (cityLower) {
      const cc = (a.city ?? a.town ?? a.village ?? a.municipality ?? '').toLowerCase();
      if (cc && (cc === cityLower || cc.includes(cityLower) || cityLower.includes(cc))) score += 30;
    }
    if (a.house_number) score += 15;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/**
 * Forward geocode for a Swedish street address.
 *
 * Nominatim's `/search` is full of footguns for Swedish inputs — the same
 * street name often exists in multiple municipalities, and a free-text q=
 * lookup happily returns "Fornbyvägen, Sundbyberg (postcode 17441)" when the
 * user typed postcode 16370. Three-pass strategy below:
 *
 *   1. Free-text q= "street, postal, city" (limit 10, addressdetails on)
 *      → strict filter: keep only candidates whose `address.postcode` matches
 *        the user-typed postcode (digits-only).
 *      → if any pass the filter, pick the highest-scoring (house_number +
 *        city-name match break ties).
 *
 *   2. Structured `/search?street=&postalcode=` fallback. Hits Nominatim's
 *      address index keyed by postal area — sometimes catches streets that
 *      free-text q= ranked off the first page.
 *
 *   3. If a postcode WAS provided but neither pass found a postcode match,
 *      return null. The picker then falls back to GPS — far better UX than
 *      silently placing the crosshair on a different city's street.
 *
 * When no postcode is provided (rare path, e.g. address-only entry) we just
 * trust Nominatim's free-text ranking.
 */
export async function geocodeAddress(addr: AddressQuery, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const street       = addr.street?.trim() ?? '';
  const postalDigits = (addr.postalCode ?? '').replace(/\D/g, ''); // "163 70" → "16370"
  const city         = addr.city?.trim() ?? '';

  if (!street && !postalDigits && !city) return null;

  const toResult = (r: NominatimRow): GeocodeResult | null => {
    const lat = parseFloat(r.lat ?? '');
    const lng = parseFloat(r.lon ?? '');
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng, label: r.display_name ?? '' };
  };

  // ── Pass 1: free-text q= ────────────────────────────────────────────────
  const parts: string[] = [];
  if (street)       parts.push(street);
  if (postalDigits) parts.push(postalDigits);
  if (city)         parts.push(city);
  const p1 = new URLSearchParams();
  p1.set('q', parts.join(', '));
  const data1 = await nominatimSearch(p1, signal);
  const match1 = pickBestMatch(data1, postalDigits, city);
  if (match1) return toResult(match1);

  // ── Pass 2: structured search with street + postcode ────────────────────
  if (street && postalDigits) {
    const p2 = new URLSearchParams();
    p2.set('street',     street);
    p2.set('postalcode', postalDigits);
    const data2 = await nominatimSearch(p2, signal);
    const match2 = pickBestMatch(data2, postalDigits, city);
    if (match2) return toResult(match2);
  }

  // ── Pass 3: no postcode supplied → trust Nominatim's first result ───────
  if (!postalDigits && data1.length > 0) return toResult(data1[0]);

  // Postcode was supplied but no candidate matched it. Refuse to guess.
  return null;
}

export type ReverseGeocodeResult = {
  address: string | null;
  postalCode: string | null;
  city: string | null;
};

/**
 * Reverse geocode lat/lng → Swedish address fields via Nominatim.
 *
 * Used by the "Lägg till masjid" form so "Använd min plats" can auto-fill the
 * empty Adress / Postnummer / Stad fields. User-initiated only (one tap →
 * one request) so it stays well under Nominatim's ≤1 req/sec policy.
 *
 * Returns nulls for any field Nominatim can't resolve — callers must treat
 * each field independently and never overwrite values the user has typed.
 */
export async function reverseGeocode(
  lat: number, lng: number, signal?: AbortSignal,
): Promise<ReverseGeocodeResult | null> {
  if (!isFinite(lat) || !isFinite(lng)) return null;

  const url =
    `${NOMINATIM_REVERSE}?format=jsonv2&lat=${lat}&lon=${lng}` +
    `&addressdetails=1&zoom=18&accept-language=sv`;

  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

  const data = await res.json();
  const a = (data?.address ?? {}) as Record<string, string | undefined>;

  const road = a.road || a.pedestrian || a.footway || a.neighbourhood || '';
  const street = [road, a.house_number].filter(Boolean).join(' ').trim();
  const city = a.city || a.town || a.village || a.municipality || a.county || '';
  const postal = a.postcode || '';

  return {
    address: street || null,
    postalCode: postal || null,
    city: city || null,
  };
}
