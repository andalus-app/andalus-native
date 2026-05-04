# Architecture — Hidayah App

The app follows a simple and strict structure:

* UI (screens/components)
* State (Context + reducer)
* Services (API + logic)
* Hooks (connect everything)

---

## State Flow

UI → dispatch → reducer → state → UI

* No direct mutation
* All global state goes through reducer

---

## Data Flow

API / Supabase → services → hooks → UI

---

## Key Decisions

### Context instead of Redux

* Simpler
* Enough for this app

---

### AsyncStorage

* Used for caching
* Enables offline support

---

### Supabase

* Backend + realtime
* RLS handles security

---

## Design Principle

Simplicity > cleverness

If something feels too complex → it's probably wrong.

