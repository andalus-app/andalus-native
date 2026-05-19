# CLAUDE.md — Hidayah App

## Overview

Swedish Islamic mobile app built with Expo + React Native.

Core features:

* Prayer times
* Quran (reading + audio)
* Dhikr
* 99 Names of Allah
* Qibla compass
* Notifications

---

## Tech Stack

* Expo (React Native)
* TypeScript (strict mode)
* expo-router (file-based routing)
* Supabase (backend)
* AsyncStorage (local persistence)

---

## Project Structure

/app — screens & routing
/components — reusable UI
/context — global state (Context + reducer)
/hooks — logic hooks
/services — API + business logic
/lib — external clients (Supabase)
/theme — colors & tokens

---

## Core Rules (DO NOT BREAK)

### TypeScript

* Strict mode ON
* No `any` unless absolutely necessary

### State Management

* Global: Context + useReducer ONLY
* Local: useState
* No Redux / Zustand

### Storage

* Use AsyncStorage via service layer
* Do NOT create conflicting keys

### Supabase

* Use ONE client only (`lib/supabase.ts`)
* Never create new instances

---

## Supabase Migration Rules

New tables in the `public` schema are **not** automatically exposed via the Supabase Data API / PostgREST / supabase-js. Explicit `GRANT` statements are always required.

For every new table:

1. Create the table.
2. Enable Row Level Security.
3. Add the required RLS policies.
4. Add explicit `GRANT` statements for the roles that need access.
5. Do not grant `anon` access unless the app genuinely needs public unauthenticated access.
6. Prefer least privilege.

Example pattern:

```sql
alter table public.example_table enable row level security;

grant select on public.example_table to anon;
grant select, insert, update, delete on public.example_table to authenticated;
grant select, insert, update, delete on public.example_table to service_role;
```

Important:

* `GRANT` gives the role permission to access the table.
* RLS policies decide which rows can actually be read/written.
* Both `GRANT` and RLS are required — neither alone is sufficient.
* For sensitive tables, do not grant access to `anon`.
* For app-user data, grant to `authenticated` and control access with RLS.
* For server-only operations, use `service_role`, not client-side access.

Migration checklist — verify before finishing any migration:

* Does the app access this table through `supabase.from(...)`?
* Does the table have RLS enabled?
* Are RLS policies present?
* Are explicit `GRANT` statements present?
* Is `anon` access avoided unless truly needed?
* Has TypeScript/app code been checked for permission assumptions?

---

## Performance Rules

* Always use `useCallback` for handlers
* Always use `useMemo` for context values
* Use `useRef` for mutable values (timers, listeners)

### Cleanup (CRITICAL)

* Always clear timers on unmount
* Always cancel fetches (AbortController)

---

## App Lifecycle

* Pause polling when app is backgrounded
* Resume + refresh when app becomes active

Rule:

* If data is stale → fetch immediately
* If fresh → reschedule timer

---

## UI / UX Rules

### Language

* ALL UI must be Swedish
* Never use English in UI

### Theme

* Use `useTheme()`
* Never hardcode colors

### Layout

* ScrollView must have bottom padding ≥ 100
* Tab bar is floating → avoid layout collisions

### Cards

* Rounded (~14 radius)
* Subtle shadows
* Use theme tokens

---

## Navigation

* Use `useRouter()` (NOT navigation prop)
* Use `useFocusEffect` for screen refresh

---

## Services

### Prayer API

* Use Aladhan
* Default method: Muslim World League
* Source priority: daily cache → yearly cache (andalus_yearly_cache_v3) → Aladhan live → Supabase SCB polygon fallback → offline error
* Supabase fallback (`services/supabasePrayerFallback.ts`) is last-resort only — never called during a successful app startup
* Supabase fallback uses RPC `get_prayer_month_by_position` with SCB polygon resolution (avoids wrong nearest-centroid city matches)
* Fallback cache key: `andalus_supabase_prayer_fallback_v1`

### Notifications

* Always request permission first
* Never spam (deduplicate)

---

## Critical Patterns

### Refs vs State (IMPORTANT)

Never rely on state inside:

* AppState listeners
* Timers
* Async callbacks

Use:

```ts
const ref = useRef(value);
ref.current = value;
```

---

### Polling (MUST FOLLOW)

On app resume:

* If stale → fetch
* Else → schedule remaining time

Polling must NEVER stop.

---

### Notification Deduplication

* Track last ID in a ref
* Only send if new

---

### Async Safety

```ts
if (!mountedRef.current) return;
```

---

### Numbered List Items (IMPORTANT)

Never split a single list item into multiple `<Text>` or `<View>` components. Each item must be a single `<Text>` with `flex: 1` that wraps naturally. Newlines within an item use `\n` inside the string — React Native handles these correctly in a single `<Text>`.

**Wrong** (causes extra blank space between lines):
```tsx
<View style={styles.numberedTextWrap}>
  {text.split('\n').map((line, k) => (
    <Text key={k}>{line}</Text>
  ))}
</View>
```

**Correct**:
```tsx
<Text style={[styles.numberedText, { flex: 1 }]}>{text}</Text>
```

---

## Gotchas (REAL ISSUES)

* State becomes stale in listeners → use refs
* Timers not cleared → causes random bugs
* Polling not restarted → feature dies silently
* Duplicate notifications → spam risk

---

## What NOT to Do

* Do NOT change Supabase config
* Do NOT break provider structure
* Do NOT add English UI text
* Do NOT skip cleanup logic
* Do NOT create multiple API clients
* Do NOT rely on state in long-lived callbacks

---

## IFIS — Islamiska Förbundet Sverige

### API

* Base URL: `https://api.xn--bnetider-n4a.nu/v1`
* Cities: `GET /method/ifis/cities` → `string[]` (lowercase slugs, e.g. "stockholm")
* Year data: `GET /method/ifis/city/{city}/times` → 3D array `[month0_days, month1_days, ...]`, indexed from January (month 0), each day is `[fajr, shorook, dhuhr, asr, maghrib, isha]` in **minutes from midnight**
* Single day: `GET /method/ifis/city/{city}/times/{YYYY-MM-DD}` → `[fajr, shorook, dhuhr, asr, maghrib, isha]`

### Data Format

* API returns minutes from midnight (e.g. 160 = 02:40)
* Array index: 0=Fajr, 1=Shorook, 2=Dhuhr, 3=Asr, 4=Maghrib, 5=Isha
* Must be normalized to `Record<string, string>` with keys Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha, Midnight before use
* IFIS does NOT return Hijri date or Midnight — Midnight is calculated using existing `calcMidnight()`

### Naming Rules (CRITICAL — do not break)

* Internal technical key: `ifis` (in settings, cache keys, code)
* In method list (settings): display as **"Islamiska Förbundet Sverige"** — never "IFIS" or "IFIS Bönetider"
* In monthly view source label: **"Islamiska Förbundet {Stad}"** (e.g. "Islamiska Förbundet Stockholm")
* In PDF method label: **"Metod: Islamiska Förbundet {Stad}"**
* Constants: `IFIS_METHOD_DISPLAY_NAME = 'Islamiska Förbundet Sverige'`

### Settings Fields

```ts
prayerSource: 'aladhan' | 'ifis'  // which source to use (default: 'aladhan')
ifisCity: string                   // IFIS city slug (default: 'stockholm')
```

### Cache Keys

* Format: `ifis:{city}:{year}` (e.g. `ifis:stockholm:2026`)
* Each city+year is a separate AsyncStorage key
* Structure: `IfisYearCache` = `{ city, year, cachedAt, source: 'ifis', version: 1, data: unknown }`
* Priority: yearly cache → daily endpoint → error
* Warm both current and next year in background; missing next-year data is non-fatal

### City Normalization

* `normalizeIfisCity(city)`: lowercase + å/ä→a, ö→o (e.g. "Göteborg" → "goteborg")
* City display names: `{ stockholm: 'Stockholm', goteborg: 'Göteborg', malmo: 'Malmö', ... }` — expanded dynamically from API
* Auto-match geocoded city to IFIS city list; keep last working city if no match

### Architecture Rules

* IFIS **reuses** existing background location, widget, and notification flows
* Do NOT create a separate background architecture for IFIS
* When IFIS active: write IFIS times to App Group in same format as AlAdhan
* When IFIS active: notify with same scheduling flow, same notification IDs
* AlAdhan logic is NEVER modified — both sources coexist via `prayerSource` flag
* `calculationMethod` (number) and `school` are always kept for when user switches back to AlAdhan

---

## External Docs

See:

* /docs/bugs.md — bug history & fixes
* /docs/architecture.md — system design
* /docs/performance.md — performance rules

---

## Guiding Principle

This file exists to:

* Prevent breaking the app
* Keep behavior predictable
* Enforce consistency

If a change violates these rules → it is wrong.

