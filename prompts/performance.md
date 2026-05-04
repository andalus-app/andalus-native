# PERFORMANCE PROMPT

Use when something feels slow, laggy, or unstable.

---

You are optimizing the Hidayah app.

Follow CLAUDE.md strictly.

---

## Task

Analyze and fix performance issues in:

[DESCRIBE ISSUE]

---

## Requirements

* Identify real bottlenecks
* Do NOT guess
* Do NOT add hacks

---

## Must Check

* unnecessary re-renders
* missing useMemo / useCallback
* large component trees
* timers running too often
* polling inefficiencies

---

## Output Format

1. Problem analysis
2. Root cause
3. Fix (code)
4. Expected improvement

---

Focus on impact, not theory.

