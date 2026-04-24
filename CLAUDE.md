# CLAUDE.md — Andalus App

This file documents the project structure, coding conventions, and constraints for the Andalus React Native app. Read it before making any changes.

---

## Project Overview

Swedish Islamic app (islam.nu mobile) built with Expo + React Native. Features: prayer times, room booking, e-book library, dhikr, 99 Names of Allah, Qibla compass, YouTube live integration, and admin notifications.

---

## Tech Stack

- **Framework**: Expo ~54.0.33, React 19.1.0, React Native 0.81.5
- **Router**: expo-router ~6.0.23 (file-based routing)
- **Language**: TypeScript (strict mode, path alias `@/*` → root)
- **Backend**: Supabase (anon key hardcoded in `lib/supabase.ts` — this is intentional, RLS enforces security)
- **Animations**: React Native Animated API only (not Reanimated for most screens)
- **Fonts**: Inter (400/500/600/700) via @expo-google-fonts/inter
- **Storage**: @react-native-async-storage/async-storage 2.2.0

---

## Project Structure

```
/app
  _layout.tsx              Root layout — provider stack, fonts, Stack navigator
  /(tabs)/
    _layout.tsx            Custom BlurView tab bar, 6 visible tabs
    home.tsx               Dashboard: banners, booking notifs, YouTube live
    index.tsx              Prayer times: countdown, location, monthly link
    booking.tsx            Room booking with offline queue + admin view
    qibla.tsx              Qibla compass (expo-sensors magnetometer)
    ebooks.tsx             E-book library with categories, favorites, PDF reader
    asmaul.tsx             99 Names of Allah
    dhikr.tsx              Islamic supplications by category
    more.tsx               Extra navigation links
  about.tsx
  monthly.tsx              Monthly prayer calendar
  settings.tsx             User settings
  support.tsx

/components
  SvgIcon.tsx              Icon library (25+ icon types, react-native-svg)
  ThemeToggle.tsx          Animated sun/moon toggle
  DhikrCategoryIcon.tsx    Dynamic icons for dhikr categories

/context
  ThemeContext             light/dark/system mode, animated overlay transition
  AppContext               Prayer times, location, user settings (useReducer)
  BannerContext            Google Sheets CSV announcements
  NotificationContext      In-app toast notifications (BlurView pill)
  BookingNotifContext      Supabase real-time booking status

/hooks
  useYoutubeLive.ts        YouTube Data API with adaptive polling
  useBooks.ts              E-book state, favorites, bookmarks, progress
  usePdfCover.ts           PDF cover extraction via WebView → canvas → dataURL
  useOfflineBookingNative.ts  Offline-first booking queue (AsyncStorage)

/services
  prayerApi.ts             aladhan.com + OpenStreetMap Nominatim
  notifications.ts         expo-notifications (prayer + banner alerts)
  monthlyCache.ts          12-month parallel prayer cache + Swedish date arrays
  storage.ts               Synchronous wrapper over AsyncStorage (preloaded)
  geocoding.ts             expo-location reverse geocoding with cache

/data
  books.ts                 Static e-book list

/lib
  supabase.ts              Supabase client config

/theme
  colors.ts                Dark + Light theme objects, Theme type
```

---

## Provider Stack Order

Do not change this order. Dependencies flow top-to-bottom.

```
GestureHandlerRootView
  ThemeProvider
    AppProvider (prayer times, location, settings)
      BannerProvider (Google Sheets feed)
        BookingNotifProvider (Supabase real-time)
          NotificationProvider (in-app toast queue)
            Stack navigator + animated overlay
```

---

## Theme System

**File**: `theme/colors.ts`

Two objects: `dark` and `light`, exported as `Theme = typeof dark`.

| Token | Dark | Light |
|---|---|---|
| `bg` | #000000 | #F2F2F7 |
| `card` | #1C1C1E | #FFFFFF |
| `text` | #FFFFFF | #000000 |
| `accent` | #24645d | #24645d |
| `accentGlow` | rgba(36,100,93,0.2) | rgba(36,100,93,0.12) |
| `accentRed` | #FF3B30 | #FF3B30 |
| `border` | rgba(255,255,255,0.1) | rgba(0,0,0,0.08) |

**Rules:**
- Always access colors via `useTheme()` → `theme.<token>`. Never hardcode color values that should adapt to the theme.
- `isDark` boolean is available from `useTheme()` — use it to select BlurView tint and intensity.
- BlurView pattern: intensity `60` (dark) / `80–82` (light), tint `'dark'` / `'light'`.

---

## Coding Rules

### TypeScript
- Strict mode is on. No `any` types unless absolutely unavoidable.
- Use domain type aliases: see existing `Banner`, `BookingNotif`, `DayRow`, `GeoResult`, `YTStream`.
- Path alias `@/*` is configured. Use it for imports from the project root.

### State Management
- Global state: React Context + useReducer only. No Redux, no Zustand.
- Local UI state: useState.
- Persistent state: AsyncStorage (see existing keys below).

### AsyncStorage Keys — Do Not Conflict
| Key | Owner |
|---|---|
| `andalus_app_state` | AppContext (prayer times, settings) |
| `andalus_theme_mode` | ThemeContext |
| `andalus_books_state` | useBooks |
| `andalus_booking_queue` | useOfflineBookingNative |
| `islamnu_*` | storage.ts (user ID, role, phone, admin mode) |

### Performance
- Always use `useCallback` for event handlers passed as props or used in effects.
- Always use `useMemo` for context `value` objects to prevent re-renders.
- Use `useRef` for mutable values that don't affect render (timers, fetch refs, abort controllers).
- Always cancel in-flight requests on unmount via `AbortController`.
- Always stop timers/intervals in cleanup functions.

### Animations
- Use `useNativeDriver: true` wherever possible (transform, opacity).
- Use `useNativeDriver: false` only for layout properties (width, height, padding).
- Preferred easing: `Easing.out(Easing.cubic)` for exits, `Easing.in(Easing.quad)` for entrances.
- Spring config: `{ bounciness: 6 }` or `{ damping: 18 }` for subtle bounce.

### App Lifecycle
- Add `AppState` listeners in screens/hooks that poll external data.
- Pause all polling intervals when `appState !== 'active'`.
- Resume + refresh when returning to `'active'`.

---

## UI/UX Guidelines

### Language
- All user-facing strings are **Swedish**. Never use English in UI labels, errors, or messages.
- Prayer names in Swedish: Fajr, Soluppgång, Dhuhr, Asr, Maghrib, Isha.
- Days: Swedish arrays from `monthlyCache.ts` (Måndag, Tisdag, …).
- Months: Swedish arrays from `monthlyCache.ts`.

### Card Pattern
```typescript
{
  backgroundColor: theme.card,
  borderWidth: 0.5,
  borderColor: theme.border,
  borderRadius: 14,
  padding: 14,   // or 16
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.12,   // light; up to 0.45 for prominent cards
  shadowRadius: 16,      // up to 24 for prominent cards
}
```

### Typography Scale
| Use | Size | Weight | Color |
|---|---|---|---|
| Screen title | 22–24 | 700 | `theme.text` |
| Section header | 16–18 | 600–700 | `theme.text` |
| Body | 13–14 | 400–500 | `theme.text` / `theme.textSecondary` |
| Label/caption | 11–12 | 500–600 | `theme.textMuted` |
| Accent/CTA | 13–14 | 600 | `theme.accent` |

### Layout
- Screen root: `<ScrollView>` with `<RefreshControl>` for pull-to-refresh.
- Always add bottom padding `≥ 100` to ScrollView content to clear the floating tab bar.
- Tab bar is floating (30px from bottom, 16px horizontal margin) — never use `SafeAreaView` bottom inset to calculate tab clearance.

### Glassmorphism
```typescript
// Overlay approach
<View style={StyleSheet.absoluteFill}>
  <BlurView
    intensity={isDark ? 60 : 82}
    tint={isDark ? 'dark' : 'light'}
    style={StyleSheet.absoluteFill}
  />
  <View style={[
    StyleSheet.absoluteFill,
    { backgroundColor: isDark ? 'rgba(20,20,20,0.6)' : 'rgba(255,255,255,0.6)' }
  ]} />
</View>
```

### Icons
- Use `<SvgIcon name="..." size={24} color={theme.text} />` for all tab/UI icons.
- Do not import external icon libraries. Extend `SvgIcon.tsx` if new icons are needed.

### Touch Feedback
- Use `TouchableOpacity` with `activeOpacity={0.7}` for buttons.
- Use `PanResponder` + `Animated` for swipe-to-dismiss gestures (see banner cards in `home.tsx`).

---

## Routing Constraints

- Tab screens live in `app/(tabs)/`. Adding a new tab requires updating `app/(tabs)/_layout.tsx`.
- The tab bar renders 6 tabs in a `ScrollView` — do not assume all tabs are always visible without scrolling.
- Navigate via `useRouter()` (`router.push(route)`). Do not use `navigation` prop directly.
- Use `useFocusEffect` for data refresh when a screen gains focus (not `useEffect` alone).

---

## Services & Data Fetching

### Prayer API
- Base URL: `https://api.aladhan.com/v1`
- Default calculation method: `3` (Muslim World League)
- Do not change default method without updating `AppContext` reducer defaults.

### Supabase
- Client: `lib/supabase.ts` — import from there, never instantiate a second client.
- Anon key is intentionally public; Supabase RLS enforces row-level security.
- Real-time subscriptions: always unsubscribe in cleanup (`channel.unsubscribe()`).

### Storage Service (`services/storage.ts`)
- `getItem()` is **synchronous** (reads from memory preloaded at init).
- `setItem()` / `removeItem()` are **async**.
- `initStorage()` must be awaited before any synchronous reads — it's called at app startup.
- Do not use AsyncStorage directly for `islamnu_*` keys; use the storage service.

### Notifications
- `expo-notifications` is lazy-loaded — check for availability before use.
- Prayer notification identifier format: `andalus-prayer-{slot}-{prayerName}`.
- Always call `requestNotificationPermission()` before scheduling.

### YouTube Live (`hooks/useYoutubeLive.ts`)

**Data source:** A Supabase Edge Function (`/functions/v1/youtube-streams`) handles all YouTube API calls and caching server-side. The app never calls the YouTube API directly.

**Startup behavior:**
1. AsyncStorage cache is read immediately and shown to the UI — this is a UI-only cache for instant display.
2. A live fetch is triggered immediately after mount regardless of cache age.
3. Adaptive polling continues from there based on the result.

**Polling intervals (do not change without updating this file):**

| State | Interval |
|---|---|
| `live` | 1 minute |
| `upcoming`, < 30 min away | 3 minutes |
| `upcoming`, < 6 h away | 15 minutes |
| `upcoming`, ≥ 6 h away | 1 hour |
| No stream | 3 hours |
| Fetch error (back-off) | 5 minutes |

**App lifecycle rules:**
- When app goes to **background**: clear the active timer immediately.
- When app returns to **foreground**: check `Date.now() - lastFetchTs` vs `pollInterval(streamRef.current)`.
  - If stale (age ≥ interval): call `doFetch()` immediately.
  - If fresh (age < interval): reschedule a timer for the remaining time. **Never leave polling dead.**
- Always use `streamRef.current` (not React state) inside the AppState listener — state is stale in long-lived listeners created with `useEffect(..., [])`.

**Live notification rule:**
- Only send one push notification per unique `videoId`. Track this with `notifiedVideoIdRef`.
- This ref resets when the app restarts (new session → new notification is acceptable).
- Do not add AsyncStorage persistence for this unless multiple notifications per session become a real problem.

**AsyncStorage vs Supabase:**
- AsyncStorage (`yt_stream_cache_v2`): client-side UI cache only. Stale. Used for instant render on startup.
- Supabase Edge Function: the real backend cache. Handles YouTube quota, hot mode refresh, etc.

**Channel ID:** `UCQhN1h0T-02TYWf-mD3-2hQ` — do not change.

---

## Offline / Network Patterns

### Booking Queue
- Booking submissions that fail due to **network errors** are queued in AsyncStorage and retried.
- Validation/auth/constraint errors are **discarded** (not queued).
- Network error detection: `instanceof TypeError` OR message contains: `network`, `fetch`, `connection`, `timeout`, `econnrefused`, `enotfound`.
- Sync queue on: mount + app foreground transition.

### Prayer Cache
- Daily cache per location+method+school.
- Yearly cache: parallel fetch of 13 months (12 + January next year), fire-and-forget.
- Cache key: `{year}_{lat.toFixed(2)}_{lng.toFixed(2)}_{method}_{school}`.

---

## Platform Notes

- **Android**: `edgeToEdgeEnabled: true`, `predictiveBackGestureEnabled: false`.
- **iOS**: `supportsTablet: true`.
- Location permission: `Location.requestForegroundPermissionsAsync()` — always check result before using GPS.
- Notification permission: `Notifications.requestPermissionsAsync()` — always check before scheduling.

---

## What NOT to Do

- Do not change the Supabase URL or anon key in `lib/supabase.ts`.
- Do not add new AsyncStorage keys that conflict with the existing key list above.
- Do not break the provider nesting order in `app/_layout.tsx`.
- Do not add English strings to the UI — all copy must be Swedish.
- Do not use `any` types in TypeScript.
- Do not import external icon libraries — extend `SvgIcon.tsx`.
- Do not remove the `AbortController` pattern from API calls.
- Do not use `useEffect` alone for screen-focus data refresh — use `useFocusEffect`.
- Do not skip the bottom padding (≥ 100px) in ScrollView screens — the tab bar is floating.
- Do not use `StyleSheet.absoluteFillObject` for the BlurView overlay — use `StyleSheet.absoluteFill`.
- Do not create a second Supabase client instance anywhere in the app.

---

## Gotchas

These are real failure modes that have been observed or are structurally guaranteed to happen:

- **Never read React state inside long-lived listeners** (AppState, Supabase real-time, etc.) created inside `useEffect(..., [])`. The value captured at creation time never updates. Always use a `ref` that mirrors the state for anything that needs the current value in such listeners.
- **Never send push notifications in a polling loop without deduplication.** A 1-minute poll interval during a 2-hour livestream = 120 notifications. Always gate on a ref that tracks the last notified `videoId`.
- **Always clear timers in both the unmount cleanup AND the app-background handler.** Forgetting either leaves orphaned timers that fire at unexpected times.
- **Always reschedule the timer when returning from background, even if data is still fresh.** If you only refetch when stale and do nothing otherwise, polling permanently stops for users who quickly switch apps.
- **Error paths must reschedule polling.** An uncaught exception or early return in `doFetch` must still set a retry timer, or the feature goes permanently dark.
- **`sendLiveNotification` must exist before importing it.** It is called from `useYoutubeLive` — if the export is missing from `notifications.ts`, the build compiles but crashes at runtime on the first live stream.

---

## Previously Fixed Bugs

Document real bugs that have already been found and fixed. Treat these as permanent rules.

### `mushafApi.ts` — Quran Foundation API overflow anomalies — fixed 2026-04-02

The Quran Foundation API (`verses/by_page/{N}`, mushaf=1) has two classes of anomaly where words are returned by a **different** page endpoint than the `page_number` field claims:

**Backward overflow (N-1):** Words with `page_number===N` are only returned by `verses/by_page/{N-1}`.
Example: 80:41-42 have `page_number=586` but appear only in `verses/by_page/585`.

**Forward overflow (N+1):** Words with `page_number===N` are only returned by `verses/by_page/{N+1}`.
This was the root cause of 13 missing verses across 11 pages (verified 2026-04-02 against all 604 pages):

| Page | Missing verse(s) |
|------|-----------------|
| 120  | 5:77            |
| 121  | 5:83            |
| 122  | 5:90            |
| 531  | 55:17, 55:18    |
| 532  | 55:41           |
| 533  | 55:68, 55:69    |
| 564  | 68:16           |
| 567  | 69:35           |
| 569  | 70:40           |
| 575  | 74:18           |
| 583  | 79:16           |

**Fix:** `fetchMushafPageVerses` fetches pages N-1, N, and N+1 concurrently and filters all words by `page_number===N`. Cache bumped v3→v4 to invalidate old incomplete caches.

**Permanent rules derived from this fix:**
- NEVER fetch only `verses/by_page/N` when building a Mushaf page — always also fetch N-1 and N+1.
- NEVER trust that `verses/by_page/N` is the authoritative source for all words on page N.
- The overflow list above is NOT exhaustive — new anomalies may exist in future API updates. The three-page fetch strategy is the permanent guard, not a per-page special case.
- Cache version must be bumped whenever the fetch strategy changes, to invalidate stored incomplete data.

---

### `mushafTimingService.ts` — wrong verse-level page numbers from Quran.com API — fixed 2026-04-06

The Quran.com API's `verses/by_chapter/{N}?words=false&fields=page_number` endpoint returns **incorrect verse-level page numbers** for some surahs.

**Example:** All 8 verses of surah 94 (As-Sharh) are returned with `page_number=596`, but verses 94:3-8 physically appear on page 597.

**Root cause:** The verse-level `page_number` field is inaccurate in the chapter API. The word-level `page_number` (returned when `code_v2` is included in `word_fields`) is accurate. Including `code_v2` in `word_fields` causes the API to return the correct QCF V2 glyph data variant, which also carries accurate word-level page assignments matching the physical Mushaf layout.

**Symptom:** Auto page-advance during audio playback did not advance from page 596 to 597 when surah 94 verse 3 began playing.

**Fix:** Changed the page number fetch URL from `?words=false&fields=page_number` to `?words=true&word_fields=code_v2,page_number`. Build pageMap from first word's `page_number` instead of the verse-level field. Cache key bumped v2 → v3.

**Permanent rule:**
- NEVER use `verses/by_chapter/{N}?words=false&fields=page_number` for Mushaf page numbers — the verse-level page_number field is unreliable.
- ALWAYS include `code_v2` in `word_fields` when fetching word-level page numbers from the Quran.com API.

---

### `MushafRenderer.tsx` — RTL highlight wrong for middle verses in shared lines — fixed 2026-04-07

Short surahs and dense Mushaf pages place multiple verses on a single line (e.g. Surah 55 verses 1–4 all on one line). The highlight pipeline only handled two cases: **lead** (first verse in `verseKeys`, rightmost in RTL) and **trailing** (everything else → leftmost). This caused all middle verses to be drawn at `lineLeft`, which is where the **last** verse sits visually.

**Symptom:** Surah 55 verses 2 and 3 were both highlighted at verse 4's position. Any surah where 3+ short verses share a line showed the same wrong highlight for middle verses.

**Root cause** (`MushafRenderer.tsx` pass-2 shared-slot handler):
```typescript
// OLD — only correct for lead and last verse:
const rectX = isLead ? lineRight - fragBbox.width : lineLeft;
```
For a 4-verse line `[v1, v2, v3, v4]`: v2 and v3 both got `rectX = lineLeft` (where v4 sits).

**Fix — prefix measurement:**
For verse vI in a shared line, a second hidden `SvgText` is rendered (the "prefix") containing glyphs of all verses from v1 up to and including vI. Its `getBBox().width` gives the exact distance from `lineRight` to the left edge of vI:

```
rectX = lineRight − prefixBbox.width
```

This is mathematically correct for every position:
- Lead (I=1): prefix = frag → `lineRight − fragWidth` ✓ (unchanged)
- Last (I=N): prefix = full line → `lineRight − fullWidth = lineLeft` ✓
- Middle (I=k): `lineRight − prefixWidth(v1…vk)` ✓

Two hidden elements per shared slot:
- `fragRefs[${slotNum}_${verseKey}]` — active verse only → `fragBbox.width` = rect width
- `prefixRefs[prefix_${slotNum}_${verseKey}]` — v1…activeVerse → `prefixBbox.width` = x offset from lineRight

For the lead verse no prefix element is rendered (prefix = frag, same width).

**Permanent rules:**
- NEVER use `rectX = lineLeft` as a catch-all for non-lead verses. It is only correct for the LAST verse in a shared RTL line.
- ALWAYS use the prefix measurement (`lineRight − prefixWidth`) to locate any verse in a shared line.
- When adding new shared-slot highlight logic, test on surahs with 3+ verses per line (Surah 55, 112, 113, 114 are good test cases).
- `fragBbox.x` and `prefixBbox.x` are both unreliable (react-native-svg LTR getBBox semantics). Only `.width` values are used.

---

### `MushafRenderer.tsx` — khatmah pass-1 marker not visible on end/start page — fixed 2026-04-13

Khatmah end (orange) and start (green) markers did not appear on the page containing the marked verse, even though the verse was present in `page.slots` and fonts were loaded.

**Root cause:** Both khatmah pass-1 effects used `setTimeout(0)`. The pass-1 hidden SvgText elements are newly added in the same re-render that sets `khatmahMarkers` (when the user taps a day in KhatmahScreen). `setTimeout(0)` fires before the native layer commits those elements — `getBBox` returns null for all slots. The existing retry only triggered when ALL bboxes were null (`=== 0`), and used a naïve overwrite of `bboxes` rather than merging. On faster devices the retry was enough; on slower devices the second attempt could also fail partially.

**Fix:**
1. Initial delay changed from `0` to `50ms` in BOTH khatmah pass-1 effects (start and end) — matches the pass-2 pattern, gives native time to commit before the first getBBox attempt.
2. Retry condition changed from `Object.keys(bboxes).length === 0` to `< expectedSlots` — retries whenever ANY expected slot is missing, not just when all are missing.
3. Retry now merges results: `bboxes = { ...bboxes, ...retry }` — slots measured on the first try are not discarded.

**Permanent rules:**
- NEVER use `setTimeout(0)` for getBBox measurements on elements that were just added in the same re-render cycle that triggered the effect. Use at least 50ms to allow native commit.
- The retry condition for khatmah pass-1 must compare `Object.keys(bboxes).length < expectedSlots`, not `=== 0`.
- Always merge pass-1 retry results (`{ ...prev, ...retry }`) — don't overwrite slots that already measured successfully.

---

### `MushafRenderer.tsx` — khatmah pass-2 highlight shows full line instead of partial — fixed 2026-04-12

When the khatmah end (or start) verse is the last verse on a shared line (multiple verses per row), the orange/green glow rect covered the entire line width instead of only the verse's portion of the line.

**Root cause:** Pass-2 hidden SvgText elements (for fragment + prefix measurement) are rendered in the re-render triggered by `setKmEndLineBboxes` (from pass-1). The pass-2 `useEffect` fired with `setTimeout(0)` — before the native layer had committed the newly added elements. `getBBox` returned null, which triggered the full-line fallback (`rects.push({ x: fullBbox.x, y, w: fullBbox.width, h })`).

**Fix:** Two changes in both khatmah pass-2 effects (start and end):
1. Initial delay increased from `0` to `50ms` — gives native time to commit the pass-2 elements.
2. When `fragBbox` is null for a multi-verse slot: set `needRetry = true; continue` (skip, no full-line fallback). After the loop, if `needRetry`, wait 50ms more and re-measure. Final result is used.

**Permanent rules:**
- NEVER use `setTimeout(0)` for getBBox measurements on elements that were just added in the same re-render cycle that triggered the effect. Use at least 50ms to allow native commit.
- NEVER fall back to full-line for multi-verse slots on first getBBox failure. Retry after 50ms — native rendering is usually the cause.
- The pattern: `measureFn → needRetry → 50ms → measureFn again` is the correct retry pattern for ALL pass-2 highlight effects (khatmah AND audio highlight).

---

### `MushafRenderer.tsx` — audio highlight covers multiple verses (full-line fallback bug) — fixed 2026-04-18

When a verse occupied a shared line (multiple verses per row), the audio highlight highlight rect covered the ENTIRE line width instead of only the active verse's portion — making it appear as if multiple consecutive verses were highlighted simultaneously and that the highlight was "ahead" of the audio.

**Root cause:** Audio pass-2 (`useEffect` on `[lineBboxes, activeVerseKey, ...]`) had two violations of the permanent rules established by the khatmah fix:

1. **`setTimeout(0)`** — fired before native Core Text had committed the hidden `SvgText` elements (fragRefs / prefixRefs) added in the same re-render that triggered the effect. `getBBox` returned null for all shared-slot fragments on the first call.

2. **Full-line fallback on `fragBbox === null`** — when `getBBox` returned null for the fragment element, the code pushed the ENTIRE line rect (`fullBbox.x, fullBbox.width`). On a line shared by verses [82:5, 82:6, 82:7], highlighting the full line when active verse is 82:6 made 82:5 and 82:7 appear highlighted too.

**Fix:** Matched audio pass-2 to the khatmah pass-2 pattern:
1. Initial delay changed from `0` to `50ms` — gives native time to commit the new fragRef/prefixRef elements before first getBBox call.
2. Extracted measurement into `measureAudioHighlight()` returning `{ rects, needRetry }`.
3. When `fragBbox` is null for a shared slot: set `needRetry = true; continue` — no full-line fallback.
4. After loop: if `needRetry`, wait 50ms and call `measureAudioHighlight()` again. Use the retry result.

**Permanent rules:**
- NEVER use `setTimeout(0)` for getBBox in audio pass-2. Use at least 50ms.
- NEVER push a full-line rect when `fragBbox` is null for a shared slot. It highlights adjacent verses. Retry instead.
- Audio pass-2 and khatmah pass-2 must use identical timing/retry patterns — if one is fixed, verify the other.

---

### `QuranAudioPlayer.tsx` — interval repeat count exhausted instantly — fixed 2026-04-12

When the user set a finite repeat count (e.g. 10) for "Upprepa intervall", the interval stopped after just one or two loops instead of the chosen count. Infinite repeat (`null`) worked fine.

**Root cause:** The position callback fires many times per second. When `positionMs >= toTiming.timestampTo`, it issued a `seekTo` (async on iOS) and incremented `intervalLoopCountRef.current`. But because `seekTo` takes several ticks to take effect, the condition remained true for multiple consecutive ticks — each one incrementing the counter again. With `repeatCount = 10`, all 10 counts were consumed in milliseconds at the boundary, so the interval immediately stopped.

**Fix:** Added `intervalRepeatSeekingRef` (mirrors the existing `verseRepeatSeekingRef` pattern). Set to `true` when a seek-back is issued; cleared when `positionMs` drops back below `toTiming.timestampTo`. The boundary check is skipped entirely while this flag is set.

**Permanent rule:**
- NEVER increment `intervalLoopCountRef` inside the position callback without a seek-guard ref. Async seeks fire multiple ticks at the same position.
- The pattern `seekingRef = true` on seek, cleared when position confirms the seek, is mandatory for all seek-based loop logic in the position callback.

---

### `QuranAudioPlayer.tsx` — bismillah timer fires too late at non-1× playback speed — fixed 2026-04-07

When the user changes playback speed to 2× (or any rate ≠ 1×) before or during surah playback, the bismillah pre-play (Al-Fatiha verse 1:1 played before the surah audio starts) ran for the full 1× duration before switching to the surah audio. At 2× speed the Al-Fatiha audio finishes in half the real-world time, so the timer fired late and Al-Fatiha kept playing beyond the bismillah portion.

**Root cause:** `bismillahTimerRef` was set to `setTimeout(..., bsmDurationMs)` without dividing by the current playback rate.

**Fix:**
```typescript
const currentRate = RATE_STEPS[rateIndexRef.current] ?? 1;
const bsmTimerMs  = Math.round(bsmDurationMs / currentRate);
bismillahTimerRef.current = setTimeout(async () => { ... }, bsmTimerMs);
```

**Permanent rule:**
- NEVER use raw `bsmDurationMs` as a setTimeout delay. Always divide by the current playback rate: `bsmDurationMs / currentRate`.

---

### `QuranAudioPlayer.tsx` — surah audio never starts after bismillah pre-play — fixed 2026-04-14

After the Basmala (Al-Fatiha verse 1:1) finished playing, the target surah's audio player was created and `play()` was called, but the audio never actually started. The symptom: bismillah plays correctly, then silence — no surah audio.

**Root cause — stale Al-Fatiha events corrupting `pendingPlayRef`:**

React Native's bridge queues native events before delivering them to JS. When `subscription.remove()` was called for the Al-Fatiha player in the bismillah timer callback, some events were already queued and still fired after the call. The timer sequence was:

1. `bismillahPendingRef.current = null`
2. `playerSubRef.current?.remove()` — removes subscription, but queued events still fire
3. `startPlayer(surahUri, surahId, 0)` — creates new surah player with `pendingPlayRef.current = true`

A stale Al-Fatiha `isNowPlaying = true` event firing after step 2 would pass the `bismillahPendingRef === null` check (it was just cleared), then set `pendingPlayRef.current = false` — defeating the 750 ms play() retry. With both the initial `play()` and the retry suppressed, the surah player was permanently stuck.

**Fix — player generation counter:**

Added `playerGenerationRef` (a counter incremented on every `startPlayer` call). Each subscription captures its creation-time generation number and silently discards events where `playerGenerationRef.current` has advanced:

```typescript
const myGeneration = ++playerGenerationRef.current;
const subscription = player.addListener('playbackStatusUpdate', (s) => {
  if (playerGenerationRef.current !== myGeneration) return; // stale event — discard
  onPlaybackStatusUpdateRef.current?.(s);
});
```

This guarantees stale Al-Fatiha events can never touch the new surah player's state, regardless of bridge queue timing.

**Fix — `bismillahLockUntilMsRef` was never set:**

The comment on `bismillahLockUntilMsRef` documented that it should be set to `max(BSMLLH_.timestampTo, 3000)` when the surah starts, but the assignment was never implemented. Without it, `findCurrentVerse` immediately returned verse 1 (not `BSMLLH_`) at positionMs=0, because both share `timestampFrom=0` for most reciters. Fixed by setting the lock in the bismillah timer callback before calling `startPlayer`:

```typescript
const bsmllhEntry = pending.timings?.find((t) => t.verseKey === `BSMLLH_${pending.surahId}`);
bismillahLockUntilMsRef.current = bsmllhEntry
  ? Math.max(bsmllhEntry.timestampTo, 3000)
  : 3000;
```

**Permanent rules:**
- NEVER remove the player generation counter from `startPlayer`. Stale bridge events are a structural property of React Native — not a race condition that can be fixed by reordering calls.
- NEVER leave `bismillahLockUntilMsRef.current = 0` after the bismillah timer fires. Always set it to `max(bsmllhEntry.timestampTo, 3000)` before calling `startPlayer` for the surah.
- NEVER call `subscription.remove()` and assume all events from that subscription are immediately gone — they are not. Use the generation counter to guard.

---

### `useYoutubeLive.ts` — fixed 2026-03-29

| Bug | Root cause | Fix |
|---|---|---|
| AppState listener always used 3-hour interval regardless of stream state | `stream` state was stale inside `useEffect(..., [])` closure | Added `streamRef` that mirrors `stream`; use `streamRef.current` in listener |
| Live push notification fired every poll (~60s per stream) | No deduplication — notification sent whenever `result.status === 'live'` | Added `notifiedVideoIdRef`; only notify when `videoId !== notifiedVideoIdRef.current` |
| Polling permanently stopped after quick background/foreground cycle | When `age < interval`, no fetch and no timer was scheduled | Added `else` branch: reschedule timer for `interval - age` remaining time |
| Runtime crash when first live stream detected | `sendLiveNotification` imported but never declared in `notifications.ts` | Added `sendLiveNotification` export to `services/notifications.ts` |

**Rules derived from these fixes:**
- Do not rely on state inside AppState listeners — use refs for latest values.
- Live notifications must be deduplicated by `videoId`.
- Polling must never go dead after app resume — always reschedule even when fresh.
- Background and foreground flows must be explicitly handled, not assumed.
- Do not change the polling strategy without documenting the change in this file.

---

### `app/quran.tsx` — black screen on deep-link navigation (verseKey) — fixed 2026-04-24

Navigating to `/quran?verseKey=X:Y` (e.g. from Dagens Koranvers) caused a black screen for up to 10+ seconds on slow networks.

**Root cause:** `QuranRoute` called the `api.quran.com/verses/by_key` API to resolve the exact page number BEFORE mounting `QuranProvider`, and showed `<View style={{ backgroundColor: '#000' }} />` while waiting. No timeout. On slow/congested connections the wait was unbounded.

**Fix — two-phase approach (2026-04-24):**
1. `QuranRoute` now starts immediately with `approxPageForVerseKey()` (looks up `surahIndex.firstPage` — instant, no network). No black screen.
2. `QuranScreen` (inside the provider) runs the API fetch in `useEffect` and calls `goToVerse(verseKey, exactPage)` when it resolves. `goToVerse` navigates the pager to the correct page and sets `pendingVerseHighlight` so `QuranVerseView` scrolls+flashes the verse.
3. An 8-second `AbortController` timeout prevents the fetch from hanging forever. If it times out, the user stays on the approx page silently — no error state.

**Behavioral change vs. old code:**
- Old: `initialVerseKey` was passed to `QuranProvider` → `activeVerseKey` was set on mount → verse showed a permanent highlight slab until audio started. 
- New: `activeVerseKey` starts `null` → `pendingVerseHighlight` fires via `goToVerse` → verse flashes then returns to normal. This is better UX.

**Permanent rules:**
- NEVER block `QuranProvider` mounting on a network call. Always start with `approxPageForVerseKey()` and resolve asynchronously inside `QuranScreen` via `goToVerse`.
- ALWAYS add an `AbortController` + timeout to the page-resolution fetch — no unbounded waits.
- NEVER pass `initialVerseKey` to `QuranProvider` for deep-link navigation; use `goToVerse` instead.

---

## Working Memory

Long-term patterns and decisions that future sessions must respect. Do not reinvent these.

### Refs vs state for async/listener code

When a value must be readable inside:
- An AppState listener
- A Supabase real-time subscription callback
- A setTimeout/setInterval callback
- An async function that outlives the render that created it

...always maintain a `ref` that stays in sync with the state. Pattern:

```typescript
const fooRef = useRef<Foo | null>(null);
// When updating state:
fooRef.current = value;
setFoo(value);
// In listeners/callbacks:
const current = fooRef.current; // always fresh
```

### Polling recovery pattern

Any hook that polls with `setTimeout` must implement this in its AppState `'active'` handler:

```typescript
if (timerRef.current) clearTimeout(timerRef.current);
const age = Date.now() - lastFetchTs.current;
const interval = pollInterval(dataRef.current);
if (age >= interval) {
  doFetch(); // stale — fetch now
} else {
  timerRef.current = setTimeout(() => doFetch(), interval - age); // fresh — reschedule remainder
}
```

### Notification deduplication pattern

Any hook that sends a push notification based on polling state must track the last notified identifier:

```typescript
const notifiedIdRef = useRef<string | null>(null);
// Before sending:
if (result.id !== notifiedIdRef.current) {
  notifiedIdRef.current = result.id;
  await sendNotification(...);
}
```

### Unmount safety

Any hook with async work must guard state setters:

```typescript
const mountedRef = useRef(true);
useEffect(() => {
  mountedRef.current = true;
  return () => { mountedRef.current = false; };
}, []);
// In async functions:
if (!mountedRef.current) return;
```

### update rules

- Reuse working solutions described here. Do not reinvent.
- Do not reintroduce bugs listed in "Previously Fixed Bugs".
- Validate any polling hook change against: stale closures, cleanup logic, polling recovery, notification deduplication.
- Update this file whenever an important fix or pattern is established.

---

## Booking Calendar Design Rules

### Visual style — iOS 26-inspired

- Day selection highlight is a **circular chip**: `width: 36, height: 36, borderRadius: 18`. Do not use rectangular or rounded-rect shapes.
- Do not use `borderRadius: 10` on day cells — this produces a boxy look.
- Selection states: `selected → T.accent fill`, `today (unselected) → #FF3B30 fill`, `plain → transparent`. Both states use `color: '#fff'` text.
- Booking dot below each cell is always present in the layout (`4×4px`) and uses `backgroundColor: 'transparent'` when no booking — this keeps row heights uniform without conditional spacers.
- Navigation arrows (`navBtn`) use `T.border` for `borderColor` (passed inline) so they are visible in both dark (`rgba(255,255,255,0.1)`) and light (`rgba(0,0,0,0.08)`) mode. Do not hardcode a dark border color in the static `StyleSheet`.

### Week numbers

- Each grid row shows its ISO 8601 week number in a fixed `WK_COL_W = 28` column on the left.
- Week number is derived from the **first non-null date in each row** via `getISOWeek()` (ISO 8601 — week starts Monday, week 1 contains the year's first Thursday).
- `getISOWeek` uses UTC date math to avoid local-timezone drift. Do not replace with simple `getDay()` math.
- Week number header spacer (`<View style={{ width: WK_COL_W }} />`) is added to the day-initials header row to keep the day columns aligned.
- Week number styling: `fontSize: 10`, `fontWeight: '500'`, `color: T.textMuted`, `opacity: isDark ? 0.45 : 0.55`. Must stay subtle and never compete visually with day numbers.

### Today button behavior

The "Idag" pill in the CalendarView bottom legend row must be visible when **either**:
1. The user is viewing a **different month** than the current month, OR
2. The user is in the current month but has **selected a date that is not today**

Condition: `!isCurrentMonth || toISO(selectedDate) !== toISO(today)`

Do NOT use `!isCurrentMonth` alone — that hides the button when the user is in the current month with a non-today date selected, which blocks the one-tap return to today.

`goToToday` sets both `anchor` (calendar view) and calls `onSelectDate(today)` (selected date). Both must be updated together.

### Dark / light mode

- `T.textMuted`: `#8E8E93` (dark) / `#6D6D72` (light) — use for week numbers and day-initial headers.
- `T.accent`: `#24645d` in both modes — used for selected day fill.
- `#FF3B30` is used for today indicator and the Idag button in both modes.
- `T.border`: `rgba(255,255,255,0.1)` (dark) / `rgba(0,0,0,0.08)` (light) — must be passed inline to components that need theme-adaptive borders and cannot use a static `StyleSheet`.
- Do not style dark mode as a simple inverted light mode — token values already differ.

---

## Previously Fixed Mistakes — Booking Calendar

| Mistake | Correct approach |
|---|---|
| Square/rounded-rect day cells (`borderRadius: 10`, `height: 40`) | Circular chips: `36×36, borderRadius: 18` |
| Today button hidden when viewing current month with non-today selected | Condition: `!isCurrentMonth \|\| toISO(selectedDate) !== toISO(today)` |
| No week numbers | ISO week via `getISOWeek()` in left column (28px wide), spacer in header |
| `navBtn` border hardcoded as dark rgba | Use `T.border` inline: `style={[styles.navBtn, { borderColor: T.border }]}` |
| Conditional spacer for booking dot (`{!hasB && <View style={{ height: 5 }} />}`) | Always-present transparent dot: `backgroundColor: hasB ? ... : 'transparent'` |
| Week number calculated without UTC (timezone drift) | Use `Date.UTC(...)` in `getISOWeek` — local Date objects cause DST drift |

---

## Zakat Feature

### Overview

Full Zakat calculator at `app/zakat.tsx`, accessible from the "Mer" screen (`app/(tabs)/more.tsx`). Two calculators in one screen:
1. **Zakat al-Mal (Årlig Zakat)** — 6-step wizard for annual wealth zakat
2. **Zakat al-Fitr** — simple per-person calculation for Eid

**Route:** `/zakat` (expo-router file-based route)
**Entry point:** `more.tsx` ITEMS array — card with `icon: 'zakat'`, `route: '/zakat'`

### Swedish UI Requirement

All labels, headings, error messages, placeholder text, and tooltips are in Swedish. No English copy in this screen. Key Swedish terms:
- Zakat = Zakat (unchanged)
- Nisab = Nisab (threshold)
- Guld = Gold, Silver = Silver, Kontanter = Cash
- Handelsgods = Trade goods, Fordringar = Receivable loans
- Missade år = Missed years, Berättigad = Eligible
- Årets zakat = This year's zakat, Totalt = Total

### Icon

`'zakat'` case in `components/SvgIcon.tsx`. SVG path from `/Downloads/zakat.svg`, viewBox `0 0 595.28 748.73`, `fillRule="evenodd"`. Do not change the path data.

### Calculation Rules (Booklet-Based)

**Nisab:** Use the LOWER of gold nisab vs silver nisab to protect the poor:
```
nisabGold   = 85g × goldPricePerGram (SEK)
nisabSilver = 595g × silverPricePerGram (SEK)
nisabApplied = min(nisabGold, nisabSilver)   // if both > 0
```
If only one price entered, use that one.

**Rate:** 2.5% (`ZAKAT_RATE = 0.025`)

**Pure gold formula:**
```
pureGoldGrams = (totalGrams / 24) × karat
```
Karats supported: 24k, 22k, 21k, 18k, 14k, 9k

**Eligible assets:**
- Cash in hand + bank balances
- Trade goods (business inventory × ownership %)
- Gold and silver jewelry (pure weight × spot price)
- Receivable loans (expected repayable amounts)

**NOT subtracted:** Personal debts. The booklet does not include a debt-subtraction step — do not add one.

**Trade goods (Handelsgods):** Multiply inventory value by ownership percentage:
```
ownerPct = min(100, max(0, ownershipPct)) / 100
inventory = inventoryValueSEK × ownerPct
```

**Missed years (Missade år):** Multiply this year's zakat by the number of missed years (integer 0–50). Total = current year + missed years.

### Zakat al-Fitr Rules

- 3 kg of staple food per person (`FITR_KG_PER_PERSON = 3`)
- User enters: number of people + price per kg (SEK) of their staple
- No nisab threshold applies

### 8 Recipients (Zakat Recipients)

Displayed in result screen (informational only, not calculated):
Fuqara, Masakin, Amils, Muallafat al-Qulub, Riqab, Gharimun, Fi Sabilillah, Ibn al-Sabil

### Eligibility Step (Step 1)

4 yes/no questions — all must be YES to continue:
1. Muslim?
2. Adult (Baligh)?
3. Free (not enslaved)?
4. Owns wealth above nisab for one lunar year (hawl)?

If any is NO, show ineligibility message and stop.

### Persistence

AsyncStorage key: `andalus_zakat_state_v1`

Saved state: gold price, silver price, all asset inputs, wizard step, Zakat al-Fitr inputs.

Do not change the key name — it is already in use in production.

### Architecture

```
app/zakat.tsx
  useZakatStorage()          — AsyncStorage hook (load on mount, save on change)
  calcAnnual(state) → result — pure calculation engine, no side effects
  AnnualZakatWizard          — 6-step wizard component (steps 1–6)
  ZakatAlFitrCalc            — Zakat al-Fitr card component
  ResultStep                 — breakdown: nisab, assets, zakat due, missed years, recipients
```

### Testing Checklist

- Enter gold price 950 SEK/g, silver 10 SEK/g → nisab should be silver-based (595 × 10 = 5 950 SEK)
- Enter 100g 18k gold → pure gold = (100/24)×18 = 75g → gold value = 75 × 950 = 71 250 SEK
- Cash 100 000 SEK, no other assets → zakat = 100 000 × 0.025 = 2 500 SEK
- Trade goods 200 000 SEK at 50% ownership → inventory = 100 000 SEK → zakat = 2 500 SEK
- Missed years = 3 → total = current year × 4
- Zakat al-Fitr: 4 people × 3 kg × 25 SEK/kg = 300 SEK
- All eligibility "Nej" → should not proceed to asset steps
- State persists across app restart (check AsyncStorage key `andalus_zakat_state_v1`)

---

## Zakat Feature – Implementation Memory

- **Built:** Native iOS React Native screen at `app/zakat.tsx`
- **Located in:** "Mer" tab (`more.tsx`) as a grid card — same pattern as Dhikr, Allahs namn
- **Icon:** Uses `zakat` case in `SvgIcon.tsx` — do not use external icon libraries
- **Language:** All UI copy in Swedish, no exceptions
- **Logic source:** Islamic booklet rules (not generic online formulas)

**Key design decisions:**
- Step-based flow (6 steps) chosen over single-scroll form — reduces cognitive load for a detailed calculation
- Eligibility check is Step 1 — avoids showing asset inputs to ineligible users
- No historical auto-tracking — user manually enters missed years (avoids complex state management + incorrect assumptions about user's history)
- Jewelry included in assets — gold/silver items with weight+karat entry + inline pure-gold weight display
- Debts NOT subtracted — per booklet; this was deliberate, do not add a debt step
- Business ownership % applied to inventory only — other business assets (equipment, premises) excluded
- Nisab takes the LOWER value — this is the protective/preferred opinion

**Future enhancements (do not implement without explicit request):**
- Fiqh options (different schools on debt subtraction)
- Annual reminder notifications
- Historical zakat log / automation
- Currency switching (SEK → EUR/USD)

---

## Coding Rules for This App

- **Minimize re-renders**: use `useMemo` for context values, `useCallback` for stable handlers, `useRef` for anything that doesn't need to trigger a render.
- **Refs for async access**: never read React state inside async callbacks or long-lived listeners — mirror state in a ref.
- **Explicit side effects**: every `useEffect` must have a clear purpose; its cleanup must undo every side effect it creates (timers, subscriptions, event listeners).
- **Proper cleanup always**: timers → `clearTimeout`, Supabase channels → `channel.unsubscribe()`, AppState → `sub.remove()`, AbortControllers → `controller.abort()`.
- **Document edge cases**: if a function behaves differently at boundaries (no stream, error, stale cache, background), note it inline.
- **No behavior changes without justification**: stable, working code should not be restructured speculatively. Improve incrementally.

---

## Native iOS Build — Troubleshooting Guide

### This Project's Build Model

This is an **Expo managed workflow** project using `expo-router` and Expo plugins defined in `app.json`. The native iOS project (`ios/`) is **generated** by Expo — it is NOT committed to git and does NOT exist by default. You must run `expo prebuild` to create it before Xcode can open or build anything.

**If `ios/` is empty or missing the `.xcworkspace`, that is the root cause of all Xcode build failures.**

---

### Root Cause of 2026-03-30 Build Failure

The `ios/` directory was completely empty — no `Podfile`, no `AppDelegate.swift`, no `.xcodeproj`, no `.xcworkspace`. Every Xcode error (`No such module 'Expo'`, `paths not found` for Hermes/RN, missing DerivedData artifacts) was a downstream consequence of the native project never having been generated.

**Fix:** Run `expo prebuild --clean` to generate the native project, then `pod install` to install CocoaPods, then open the `.xcworkspace` in Xcode.

---

### Key Concepts

#### `.xcodeproj` vs `.xcworkspace`

| | `.xcodeproj` | `.xcworkspace` |
|---|---|---|
| What it is | The bare Xcode project | Xcode project + all CocoaPods dependencies combined |
| When to use | Never for React Native / Expo apps | Always — this is the correct entry point |
| What happens if wrong | CocoaPods modules missing, `No such module` errors | Builds correctly |

**Rule: Always open `ios/AndalusApp.xcworkspace`, never `ios/AndalusApp.xcodeproj`.**

#### `pod install` vs `expo prebuild --clean`

| | `pod install` | `expo prebuild --clean` |
|---|---|---|
| What it does | Installs/updates CocoaPods dependencies into an existing native project | Generates the entire native iOS (and Android) project from scratch from `app.json` + installed Expo SDK |
| When to use | The native project already exists (`Podfile` present) and you've added/changed a native dependency | The `ios/` folder is missing, empty, corrupt, or out of sync with `app.json` / Expo SDK version |
| Destructive? | No — only modifies `Pods/` and `Podfile.lock` | Yes — wipes `ios/` and `android/` and regenerates. Use `--clean` flag when switching SDK versions or recovering from corruption. |
| Runs `pod install` internally? | N/A | Yes — `expo prebuild` runs `pod install` after generating the project |

**Rule: When in doubt, run `expo prebuild --clean`. It is always safe when the project is Expo managed.**

#### Build Issues vs Bundler Issues

| | Build Issues (Xcode/native) | Bundler Issues (Metro) |
|---|---|---|
| Where they surface | Xcode build log, red errors in Xcode UI | Terminal where `expo start` is running, red screen in simulator |
| Common symptoms | `No such module`, `file not found`, CocoaPods errors, DerivedData failures | `Unable to resolve module`, `SyntaxError`, JS bundle errors |
| Fix usually involves | `expo prebuild --clean` + `pod install` | Clear Metro cache: `npx expo start --clear` |
| Requires Xcode? | Yes | No — runs entirely in the terminal/simulator |

---

### Repair Sequence (from scratch)

Run these commands from the project root in order:

```bash
# 1. Regenerate native iOS project from app.json + Expo SDK
npx expo prebuild --clean

# 2. (Optional — prebuild already runs pod install, but repeat if it errored)
cd ios && pod install && cd ..

# 3. Open the workspace (NOT .xcodeproj) in Xcode
open ios/AndalusApp.xcworkspace
```

Then in Xcode: select a simulator or device, press ▶ (Run).

Alternatively, run directly via Expo CLI (skips Xcode UI):
```bash
npx expo run:ios
```

---

### When to Re-run `expo prebuild --clean`

- After upgrading `expo` SDK version
- After adding a new Expo plugin to `app.json`
- After adding a native module that requires `pod install` (any `expo-*` package with a plugin)
- After cloning the repo fresh (native project is not in git)
- After `ios/` becomes corrupted or emptied
- If Xcode reports `No such module 'Expo'` or CocoaPods-related errors

### When `pod install` alone is sufficient

- You changed a JS-only dependency
- You added a native npm package that already has its `.podspec` and just needs re-linking
- The native project exists and the `Podfile` was manually updated

---

### Verification Checklist After Fix

After running `expo prebuild --clean` and `pod install`:

- [ ] `ios/Podfile` exists
- [ ] `ios/AndalusApp.xcworkspace` exists
- [ ] `ios/Pods/` directory is populated
- [ ] `ios/AndalusApp/AppDelegate.swift` exists and contains `ExpoAppDelegate` (for Expo SDK 50+)
- [ ] Opening `ios/AndalusApp.xcworkspace` in Xcode shows no red errors in the project navigator
- [ ] Xcode → Product → Build succeeds
- [ ] App launches on simulator

---

## Mushaf Renderer Module

### Architecture

```
services/mushafApi.ts          Data layer — types, fetch, line-grouping, page composition
services/mushafFontManager.ts  Font loading — offline-first, 3 font types
components/MushafRenderer.tsx  Native SVG renderer — react-native-svg + Core Text
```

This is a rendering-only module. Navigation, audio, and settings are NOT part of the core renderer.

### Font Asset Source Map (all confirmed)

| Purpose | File | CDN URL | PostScript name (nameID 6) |
|---|---|---|---|
| Page text (verse_line) | `p{N}.ttf` | `https://verses.quran.foundation/fonts/quran/hafs/v2/ttf/p{N}.ttf` | `QCFp{NNN}` |
| Surah name banner (surah_header) | `surah_names.ttf` | `https://raw.githubusercontent.com/quran/quran.com-frontend/master/static/fonts/surah_names/surah_names.ttf` | `icomoon` ¹ |
| Bismillah header (bismillah) | `QCF_BSML.TTF` | `https://raw.githubusercontent.com/quran/quran.com-images/master/res/fonts/QCF_BSML.TTF` | `QCF_BSML` |
| Ornaments | none — SVG geometry | — | — |

¹ `icomoon` is confirmed from the SVG source font: `<font id="icomoon">` with no `font-family` on `<font-face>` — IcoMoon sets PostScript nameID 6 to the font element id. CSS aliases (`surahnames`, `surah_names`) are web-only and irrelevant for react-native-svg.

**WRONG URL (do not use, repo does not exist):**
`https://raw.githubusercontent.com/quran/quran-font-files/master/v2/{n}.ttf`

### QCF V2 Font System

- **Page fonts**: King Fahd Complex QCF V2 — one font file per Mushaf page (604 total)
- **Encoding**: Unicode Private Use Area codepoints — 1:1 cmap lookup, no shaping
- **code_v2 format**: API returns Unicode characters directly (not hex strings). Use `w.code_v2` as-is.
- **Surah name font**: One font file for all 114 surah names. Each surah maps to one PUA glyph (codepoint table in `mushafFontManager.ts`).
- **Bismillah font**: Single glyph at U+FDFD. Used for standalone bismillah headers only (not for Al-Fatihah verse 1:1 which is a regular verse word).
- **CRITICAL**: Never use any other font for Mushaf page content. No fallback. System font must never appear in page content.

### Data Source

**API**: `https://api.quran.com/api/v4/verses/by_page/{pageNumber}`
```
?words=true
&word_fields=code_v2,char_type_name,page_number,line_number,position,verse_key
&mushaf=1
&per_page=300
```

**Response structure** (relevant fields only):
```typescript
{
  verses: [{
    verse_key: string,      // e.g. "1:1"
    words: [{
      position:       number,  // 1-based within verse
      line_number:    number,  // 1-based Mushaf line on this page
      page_number:    number,
      char_type_name: string,  // "word" | "end" | "pause" | "sajdah" | "rab" | "hizb"
      code_v2:        string,  // Unicode character(s) — use as-is, no transformation
      verse_key:      string,
    }]
  }]
}
```

**Grouping**: Group words by `line_number` to build `MushafLine[]`. All char types included.

### Rendering Engine

Native `react-native-svg` canvas. `SvgText` on iOS → Core Text (`CTFontCreateWithName` → cmap lookup → `CGContextShowGlyphsAtPositions`). No WebView, no HTML, no layout engine.

**Layout**: Deterministic arithmetic — `slotY[i] = padV + (i+1) * slotH`. 15 slots per page. Same inputs → same positions on every device.

**Slot implementation status**:

| Slot type | Status | Font |
|---|---|---|
| `verse_line` | Complete | QCF page font (`QCFpNNN`) |
| `surah_header` | Complete ¹ | `surah_names` font |
| `bismillah` | Complete | `QCF_BSML` font, U+FDFD |
| `ornament` | Complete | No font — SVG geometry |
| `unknown` | Complete | null (blank) |

¹ Pending PostScript name verification (see Font Asset Source Map above).

### Offline Asset Plan (bundled mode)

```
assets/fonts/qcf/
  p001.ttf … p604.ttf    ← 604 page fonts (from verses.quran.foundation CDN)
  surah_names.ttf         ← surah name icon font
  bismillah.ttf           ← QCF_BSML.TTF renamed
```

Total: 606 files. Use a Node.js build script to generate all 604 BUNDLED_REQUIRES entries. Set `OFFLINE_MODE = 'bundled'` in `mushafFontManager.ts` after placing files.

### AsyncStorage Keys

| Key | Owner | Content |
|---|---|---|
| `andalus_mushaf_cache_v1_{n}` | `mushafApi.ts` | Per-page word data JSON |
| `andalus_mushaf_chapter_v1_{n}` | `mushafApi.ts` | Surah metadata JSON |
| `andalus_mushaf_timing_v3_{r}_{s}` | `mushafTimingService.ts` | Verse timestamps per reciter+surah (QuranCDN) |

Do NOT change the key prefixes — they will be in use on user devices after first launch.

**Note on timing cache versioning:**
- v1: wrong API endpoint → empty timing arrays (unused)
- v2: correct QuranCDN endpoint, but used `words=false&fields=page_number` for page numbers — the Quran.com API returns incorrect verse-level page numbers for some surahs (e.g. surah 94 verses 3-8 returned as page 596 instead of correct page 597)
- v3: uses `words=true&word_fields=code_v2,page_number` — including `code_v2` causes the API to return accurate word-level page numbers that match the physical Mushaf layout used by the renderer

### Constraints

- NEVER approximate line breaks — lines come from `line_number` in the API response, not from layout calculations.
- NEVER merge lines or split lines across pages.
- NEVER use a fallback font or System font for any Mushaf page content.
- NEVER use the wrong page font CDN (`quran-font-files` repo does not exist).
- NEVER call the YouTube API or any other API from `mushafApi.ts` — it is Quran Foundation API only.
- Arabic text (`code_v2` characters) must never be sanitized, trimmed, or transformed after parsing.

### Bismillah Handling — fixed 2026-04-04

**Rules:**

| Surah | Bismillah behavior |
|-------|-------------------|
| 1 (Al-Fatihah) | Verse 1:1 IS the bismillah — no separate/injected bismillah |
| 9 (At-Tawbah) | No bismillah at all |
| 2–8, 10–114 | Standalone bismillah before verse 1 |

**Architecture:** Bismillah is handled at three layers:

1. **Composition** (`services/mushafApi.ts`):
   - `NO_STANDALONE_BISMILLAH = new Set([1, 9])` guards all bismillah injection.
   - `composePage()` creates either a standalone `bismillah` slot (when 2+ gap slots exist) or sets `bismillahEmbedded: true` on the `surah_header` slot (when only 1 gap exists, e.g. mid-page surah transitions).

2. **Rendering** (`components/MushafRenderer.tsx`, `components/quran/QuranVerseView.tsx`):
   - **Reading mode:** `renderBismillahSlot()` renders standalone slots; `renderSurahHeaderSlot()` renders embedded bismillah inside the header banner.
   - **Verse-by-verse mode:** `buildVerseItems()` emits a `isBismillah: true` item for both standalone bismillah slots AND embedded bismillah (from `surah_header` with `bismillahEmbedded: true`).

3. **Audio timing** (`services/mushafTimingService.ts`):
   - `withBismillahEntry()` injects a synthetic `BSMLLH_{surahId}` timing entry at the start of each surah (except 1 and 9).

4. **Audio playback** (`components/quran/QuranAudioPlayer.tsx`):
   - **Critical fact:** QuranCDN chapter audio files do NOT contain Bismillah. Verse 1 starts at 0ms in both the audio file and timing data.
   - `startWithBismillah()` plays Al-Fatiha's verse 1:1 (which IS the Bismillah recitation) before starting the surah audio. Duration is fetched from Al-Fatiha's timing data per reciter.
   - `bismillahPendingRef` holds the surah URI+timings during bismillah playback; `bismillahTimerRef` fires after the bismillah portion ends and swaps to the surah player.
   - During bismillah, `verseTimingsRef` is null (prevents verse sync on Al-Fatiha positions) and `activeVerseKey` is set to `BSMLLH_{surahId}` manually.
   - `teardown()` clears both the timer and the pending ref.

**Highlight for BSMLLH_ keys** (`computeHighlightRects` + getBBox measurement):
- Checks both standalone `bismillah` slots AND `surah_header` slots with `bismillahEmbedded: true`.
- Embedded bismillah highlight targets the lower 40% of the header slot (where the bismillah ligature is drawn).

**Font:** `QCF_BSML.TTF` (PostScript name `QCF_BSML`), single glyph U+FDFD.

**Previously fixed bugs (2026-04-04):**
- `buildVerseItems()` did not emit a bismillah item for embedded bismillah → bismillah was missing in verse-by-verse mode for mid-page surah starts.
- `computeHighlightRects()` and getBBox measurement only checked standalone `bismillah` slots for `BSMLLH_` keys → embedded bismillah was never highlighted during audio playback.
- QuranCDN audio files were incorrectly assumed to contain Bismillah (comment in quranAudioService.ts was wrong). Audio files start directly with verse 1 at 0ms. Fixed by playing Al-Fatiha verse 1:1 before surah audio (`startWithBismillah` in QuranAudioPlayer.tsx).

**Permanent rules:**
- NEVER remove the `bismillahEmbedded` check from `buildVerseItems()` — it is the only path for embedded bismillah in verse-by-verse mode.
- NEVER assume all surahs have a standalone bismillah slot — mid-page transitions may only have 1 gap (header + embedded bismillah).
- NEVER add bismillah for surah 1 or surah 9 — guarded by `NO_STANDALONE_BISMILLAH`.
- NEVER assume QuranCDN chapter audio files contain Bismillah — they do NOT. Bismillah audio must be played separately from Al-Fatiha.
- When adding new highlight or interaction code for `BSMLLH_` keys, always check both `slot.kind === 'bismillah'` AND `slot.kind === 'surah_header' && slot.bismillahEmbedded`.

---

## Ruqyah Feature

### Overview

Full Ruqyah knowledge hub at `app/ruqyah/`, accessible from the "Mer" screen (`app/(tabs)/more.tsx`).

**Routes:**
- `/ruqyah` → `app/ruqyah/index.tsx` — home: search, categories, chips, article list
- `/ruqyah/[slug]` → `app/ruqyah/[slug].tsx` — article detail with inline YouTube player

**Entry point:** `more.tsx` ITEMS array — `{ name: 'ruqyah', title: 'Ruqyah', icon: 'ruqyah', route: '/ruqyah' }`

### Data Source

**File:** `data/ruqyahData.ts` — auto-generated from `ruqyah_app_import.json`

Do NOT edit `ruqyahData.ts` manually. Re-run the generation script if the JSON changes.

```
Types: RuqyahChipDef, RuqyahCategory, RuqyahArticle
Exports: RUQYAH_CATEGORIES (4), RUQYAH_ARTICLES (58)
Helpers: getRuqyahArticle(slug), getArticlesByCategory(categorySlug)
```

**Article fields used:**
- `slug` — derived from URL, used as route param
- `title`, `excerpt`, `landingPageText` — display
- `categorySlug`, `categoryName` — grouping
- `chips`, `chipSlugs` — filtering
- `primaryYoutubeUrl`, `youtubeUrls`, `hasYoutube`, `isLecture` — video

### Icon

`'ruqyah'` case in `components/SvgIcon.tsx` delegates to `components/RuqyahIcon.tsx`.

`RuqyahIcon.tsx` is auto-generated from `ruqyah.svg` (2100×2100, 5 paths, translate transforms).
The original fill `#F6A15B` is replaced by the `color` prop so the icon respects theme.

Do NOT edit `RuqyahIcon.tsx` manually — regenerate from SVG if the icon changes.

### YouTube Playback

**Component:** `components/ruqyah/RuqyahYouTubePlayer.tsx`

Uses `react-native-webview` (already in project) with embed URL:
`https://www.youtube.com/embed/{videoId}?playsinline=1&rel=0&modestbranding=1`

- `playsinline=1` — prevents iOS fullscreen hijack
- `allowsInlineMediaPlayback` — required WebView prop for iOS inline playback
- `onShouldStartLoadWithRequest` — blocks navigation away from YouTube domain
- Never opens Safari / Chrome / YouTube app

### Architecture

```
app/ruqyah/
  index.tsx            Home: search + categories + chips + article list
  [slug].tsx           Detail: title + chips + YouTube player + body + related

components/ruqyah/
  RuqyahChip.tsx           Filter chip (active/inactive)
  RuqyahSearchBar.tsx      Search input with clear button
  RuqyahCategoryCard.tsx   Category row card
  RuqyahContentItem.tsx    Article list item (title, excerpt, badges, chips)
  RuqyahYouTubePlayer.tsx  Inline WebView YouTube player

components/
  RuqyahIcon.tsx           SVG icon (generated from ruqyah.svg)

data/
  ruqyahData.ts            Static article + category data (58 articles, 4 categories)
```

### Search

Searches across: `title`, `excerpt`, `landingPageText`, `categoryName`, `labels`, `chips`.
Empty state shown with "Rensa sökning" button when no results.

### Swedish UI Text

- Islamisk andlig läkedom (subtitle)
- Utforska autentisk kunskap… (intro)
- Kategorier, Ämnen, Föreläsningar, Alla artiklar
- Sök i Ruqyah…
- Sökresultat, Filtrerat, Inga träffar
- Relaterat innehåll, Föreläsning, Video
- Artikeln hittades inte, Gå tillbaka
- Kunde inte ladda videon, Försök igen
