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

