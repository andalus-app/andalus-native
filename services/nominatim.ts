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

function cityOf(a: NonNullable<NominatimRow['address']>): string {
  return (a.city ?? a.town ?? a.village ?? a.municipality ?? '').toLowerCase();
}
function cityMatches(a: NonNullable<NominatimRow['address']>, cityLower: string): boolean {
  if (!cityLower) return false;
  const cc = cityOf(a);
  return !!cc && (cc === cityLower || cc.includes(cityLower) || cityLower.includes(cc));
}

/**
 * Pick the best candidate row.
 *
 * `mode` controls how hard we filter:
 *   • 'postcode'  — HARD filter: drop every candidate whose postcode ≠ the
 *                   typed one. Highest precision; used first so an exact
 *                   postcode match always wins ("Fornbyvägen 29, 163 70" must
 *                   never resolve to Sundbyberg's Fornbyvägen at 17441).
 *   • 'city'      — HARD filter on the city name instead (used when the strict
 *                   postcode pass found nothing — Nominatim frequently omits or
 *                   mismatches the postcode field even for the right street, so
 *                   the city is a safer disambiguator than refusing outright).
 *   • 'loose'     — no hard filter; pick the top-scoring row. Last resort so a
 *                   typed address centres *somewhere* sensible instead of
 *                   silently snapping back to the user's GPS position.
 */
function pickBestMatch(
  rows: NominatimRow[],
  postalDigits: string,
  city: string,
  mode: 'postcode' | 'city' | 'loose',
): NominatimRow | null {
  if (rows.length === 0) return null;
  const cityLower = city.toLowerCase();
  let best: NominatimRow | null = null;
  let bestScore = -1;

  for (const r of rows) {
    const a = r.address ?? {};
    const cp = (a.postcode ?? '').replace(/\D/g, '');

    if (mode === 'postcode') {
      if (!postalDigits || !cp || cp !== postalDigits) continue;
    } else if (mode === 'city') {
      if (!cityMatches(a, cityLower)) continue;
    }

    // Tie-breaking score among the remaining candidates.
    let score = 100; // baseline so we always pick something when the filter passes
    if (postalDigits && cp === postalDigits) score += 40;
    if (cityMatches(a, cityLower)) score += 30;
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
 * user typed postcode 16370. Equally, Nominatim frequently OMITS the postcode
 * field on the correct street, so an exact-postcode filter alone throws away
 * good matches and the picker would snap back to the user's GPS position
 * (e.g. typing a Växjö address but the map stays in Spånga). So we degrade
 * gracefully, precise → coarse, and only ever give up when nothing was typed:
 *
 *   1. Free-text q="street, postal, city" → exact-postcode filter (highest
 *      precision; an exact postcode hit always wins).
 *   2. Same pass-1 rows, filtered by CITY name — NO extra request. Handles the
 *      very common "right street, odd/different postcode" case (e.g.
 *      "Borgarfjordsgatan 18, 164 40 Stockholm" — Nominatim only has the street
 *      centroid at 164 53). This MUST run before any second network request so
 *      a rate-limited fallback can never discard the good pass-1 data.
 *   3. Structured /search?street=&postalcode= (best-effort) → postcode/city.
 *   4. Free-text q="street, city" (best-effort) → city filter.
 *   5. City-only q="city" (best-effort) → at least centre on the correct town.
 *   6. Loose: top-scoring pass-1 row (only when no city was given to filter on).
 *
 * Crucially, every fallback NETWORK request after pass 1 is best-effort: a
 * thrown error (e.g. Nominatim 429 from rapid requests) is swallowed so we fall
 * through to the next pass instead of aborting the whole geocode and snapping
 * the picker back to the user's GPS position.
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

  // Best-effort fallback search: never throws (a 429 on a fallback pass must not
  // abort the whole geocode). An aborted request still rejects, but the caller's
  // signal handling treats that as a no-op anyway.
  const safeSearch = async (params: URLSearchParams): Promise<NominatimRow[]> => {
    try { return await nominatimSearch(params, signal); }
    catch { return []; }
  };

  // ── Pass 1: free-text q= (the one request we let throw — nothing to work
  //    with otherwise). Then resolve entirely IN MEMORY, precise → coarse, with
  //    no further network calls for the common cases. ──────────────────────────
  const parts: string[] = [];
  if (street)       parts.push(street);
  if (postalDigits) parts.push(postalDigits);
  if (city)         parts.push(city);
  const p1 = new URLSearchParams();
  p1.set('q', parts.join(', '));
  const data1 = await nominatimSearch(p1, signal);

  if (postalDigits) {
    const m = pickBestMatch(data1, postalDigits, city, 'postcode'); // exact postcode wins
    if (m) return toResult(m);
  }
  if (city) {
    const m = pickBestMatch(data1, postalDigits, city, 'city');     // right city, any postcode
    if (m) return toResult(m);
  }

  // ── Pass 3: structured street + postcode (best-effort) ──────────────────────
  if (street && postalDigits) {
    const p3 = new URLSearchParams();
    p3.set('street',     street);
    p3.set('postalcode', postalDigits);
    const data3 = await safeSearch(p3);
    const m = pickBestMatch(data3, postalDigits, city, 'postcode')
      ?? (city ? pickBestMatch(data3, postalDigits, city, 'city') : null);
    if (m) return toResult(m);
  }

  // ── Pass 4: free-text street + city, postcode dropped (best-effort) ─────────
  if (street && city) {
    const p4 = new URLSearchParams();
    p4.set('q', `${street}, ${city}`);
    const data4 = await safeSearch(p4);
    const m = pickBestMatch(data4, postalDigits, city, 'city')
      ?? pickBestMatch(data4, postalDigits, city, 'loose');
    if (m) return toResult(m);
  }

  // ── Pass 5: city-only — centre on the correct town as a floor (best-effort) ─
  if (city) {
    const p5 = new URLSearchParams();
    p5.set('q', city);
    const data5 = await safeSearch(p5);
    const m = pickBestMatch(data5, postalDigits, city, 'city') ?? data5[0];
    if (m) { const r = toResult(m); if (r) return r; }
  }

  // ── Pass 6: no city to disambiguate on → trust pass-1's best row ────────────
  if (!city) {
    const m = pickBestMatch(data1, postalDigits, city, 'loose');
    if (m) return toResult(m);
  }

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
