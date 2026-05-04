# DEBUG PROMPT

Use this when something is broken.

---

You are working on the Hidayah React Native app (Expo + TypeScript + Supabase).

Follow CLAUDE.md strictly. Do NOT violate any rules.

---

## Task

Investigate and fix the following issue:

[DESCRIBE BUG HERE]

---

## Requirements

* Find the ROOT CAUSE (not symptoms)
* Explain WHY it happens
* Provide a FIX that is:

  * minimal
  * safe
  * production-ready

---

## Constraints

* Do NOT introduce new architecture
* Do NOT add unnecessary complexity
* Do NOT use `any`
* Do NOT break existing patterns

---

## Must Check

* stale state in listeners (useRef vs state)
* timers not cleaned up
* polling logic (background / resume)
* async race conditions
* unnecessary re-renders

---

## Output Format

1. Root cause
2. Fix (code)
3. Why this fix works
4. Edge cases checked

---

Be direct. No guessing. No generic advice.

