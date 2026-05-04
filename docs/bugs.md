# Bugs & Fixes (Historical Reference)

This file contains previously discovered bugs and how they were fixed.
It is a knowledge base — NOT a rule file.

---

## 🔴 Common Problem Patterns

### 1. Stale State in Listeners

Problem:

* AppState, timers, subscriptions use outdated state

Solution:

* Always use `useRef`

Rule:
Never read state directly inside long-lived callbacks.

---

### 2. Polling Stops After Background

Problem:

* Polling does not restart after app resumes

Solution:

* Check "age vs interval"
* Always reschedule timer

Rule:
Polling must NEVER stop.

---

### 3. Duplicate Notifications

Problem:

* Same event triggers multiple pushes

Solution:

* Track last ID in a ref

Rule:
All notifications must be deduplicated.

---

### 4. Timer Leaks

Problem:

* Timers continue after unmount

Solution:

* Always clear in cleanup and on background

---

### 5. Async Race Conditions

Problem:

* setState runs after unmount

Solution:

* mountedRef guard

---

## 🧠 Key Insight

90% of bugs come from:

* async behavior
* timing
* lifecycle

Not UI.

