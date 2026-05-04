# Performance Rules

This app is sensitive to re-renders and timers.

---

## 🔴 Critical Rules

### useCallback

All handlers passed as props must be memoized

---

### useMemo

All context values must be memoized

---

### useRef

Use for:

* timers
* polling state
* listeners

---

## Rendering

Avoid:

* large components re-rendering often
* inline objects in props

---

## Polling

* Pause in background
* Resume correctly
* Never leave polling inactive

---

## Common Performance Issues

* Stale closures
* Unnecessary re-renders
* Timers running uncontrolled

---

## Rule

If something feels slow:
It is almost always:

* rendering
* or polling

