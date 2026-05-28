#!/usr/bin/env node
/**
 * Phase 2A — admin/backfill: fill address/postal_code/city/country for APPROVED
 * mosques that are missing an address, using OpenStreetMap **Nominatim** reverse
 * geocoding. NO Google APIs. Run manually by an admin/developer — this never
 * runs inside the app or for end users.
 *
 * What it does:
 *   • Reads approved mosques where address IS NULL or empty (lat/lng required).
 *   • Reverse-geocodes each via Nominatim, max ~1 request/second (policy).
 *   • Caches results on disk so reruns don't re-hit Nominatim.
 *   • Writes address, postal_code, city, country and marks
 *     address_source='nominatim', address_verified=false (admin verifies later).
 *   • NEVER touches latitude/longitude.
 *
 * Requires the service_role key (bypasses RLS to update rows). Get it from
 * Supabase Dashboard → Project Settings → API → service_role secret.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/backfill-mosque-addresses.mjs
 *   # options:
 *   #   --dry-run     preview only, write nothing
 *   #   --limit=50    process at most N rows this run
 *   #   --force       also overwrite rows that already have an address
 *   # optional override:
 *   #   SUPABASE_URL=https://xxxx.supabase.co (defaults to the app's project)
 *
 * Prereq: run supabase/migrations/20260528_mosque_address_source.sql first.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yqtnwgezqbznbpeooott.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const FORCE    = args.includes('--force');
const LIMIT    = (() => {
  const a = args.find((x) => x.startsWith('--limit='));
  return a ? Math.max(1, parseInt(a.split('=')[1], 10) || 0) : Infinity;
})();

// Nominatim policy: ≤1 req/sec + a descriptive User-Agent with contact info.
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'Hidayah-App/1.0 (mosque address backfill; contact: fatih.koker@outlook.com)';
const REQUEST_DELAY_MS = 1100; // a little over 1s to stay safely under the limit

const CACHE_FILE = join(__dirname, '.cache', 'nominatim-reverse.json');

if (!SERVICE_KEY) {
  console.error('✖ Missing SUPABASE_SERVICE_ROLE_KEY env var.');
  console.error('  Get it from Supabase Dashboard → Project Settings → API → service_role.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Disk cache (keyed by rounded lat/lng) ─────────────────────────────────────
function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}
function saveCache(cache) {
  if (!existsSync(dirname(CACHE_FILE))) mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
const cacheKey = (lat, lng) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

// ── Nominatim reverse geocode → normalized fields ─────────────────────────────
async function reverseGeocode(lat, lng) {
  const url = `${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=sv`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  const a = data.address || {};

  const road   = a.road || a.pedestrian || a.footway || a.neighbourhood || '';
  const street = [road, a.house_number].filter(Boolean).join(' ').trim()
              || (data.display_name ? data.display_name.split(',')[0].trim() : '');
  const city   = a.city || a.town || a.village || a.municipality || a.county || '';
  const postal = a.postcode || '';
  const country = (a.country_code === 'se') ? 'Sweden' : (a.country || '');

  return { address: street, postal_code: postal, city, country };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Backfill mosque addresses via Nominatim${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`Project: ${SUPABASE_URL}`);

  let query = supabase
    .from('mosques')
    .select('id, name, latitude, longitude, address, postal_code, city, country')
    .eq('status', 'approved');

  // Only rows missing an address, unless --force.
  if (!FORCE) query = query.or('address.is.null,address.eq.');

  const { data: rows, error } = await query;
  if (error) { console.error('✖ Query failed:', error.message); process.exit(1); }

  const targets = (rows || []).filter((r) => r.latitude != null && r.longitude != null).slice(0, LIMIT);
  console.log(`Found ${rows?.length ?? 0} candidate row(s); processing ${targets.length}.`);
  if (targets.length === 0) return;

  const cache = loadCache();
  let updated = 0, skipped = 0, failed = 0, cached = 0;

  for (const r of targets) {
    const key = cacheKey(r.latitude, r.longitude);
    let geo = cache[key];

    if (geo) {
      cached++;
    } else {
      try {
        await sleep(REQUEST_DELAY_MS);            // rate limit (only on a real request)
        geo = await reverseGeocode(r.latitude, r.longitude);
        cache[key] = geo;
        saveCache(cache);                          // persist incrementally
      } catch (e) {
        failed++;
        console.warn(`  ⚠ ${r.name} (${key}): ${e.message}`);
        continue;
      }
    }

    if (!geo.address) {
      skipped++;
      console.log(`  – ${r.name} (${key}): no address found, skipped`);
      continue;
    }

    // Only set fields we actually resolved (don't null-out existing values).
    const update = { address: geo.address, address_source: 'nominatim', address_verified: false };
    if (geo.postal_code) update.postal_code = geo.postal_code;
    if (geo.city)        update.city        = geo.city;
    if (geo.country)     update.country     = geo.country;

    console.log(`  ${DRY_RUN ? '[dry] ' : ''}${r.name}: ${geo.address}, ${geo.postal_code || '—'} ${geo.city || '—'}`);

    if (!DRY_RUN) {
      const { error: upErr } = await supabase.from('mosques').update(update).eq('id', r.id);
      if (upErr) { failed++; console.warn(`  ⚠ update failed for ${r.name}: ${upErr.message}`); continue; }
    }
    updated++;
  }

  console.log(`\nDone. ${DRY_RUN ? 'would update' : 'updated'}: ${updated}, skipped: ${skipped}, failed: ${failed}, from cache: ${cached}`);
  console.log('All backfilled rows are address_verified=false — verify/correct them in the admin UI.');
}

main().catch((e) => { console.error(e); process.exit(1); });
