/**
 * quranPerfLogger.ts
 *
 * Temporary performance logger for TestFlight / production verification.
 *
 * HOW TO USE:
 *   Set ENABLE_QURAN_PERF_LOGS = true  → logs appear in device console / Xcode
 *   Set ENABLE_QURAN_PERF_LOGS = false → zero overhead, no output
 *
 * HOW TO READ IN XCODE:
 *   Open Xcode → Window → Devices and Simulators → select device → open console.
 *   Filter by "[QURAN_PERF]" to see only these logs.
 *
 * WHEN DONE TESTING:
 *   Set ENABLE_QURAN_PERF_LOGS = false and ship.
 *   Do NOT delete the qLog/qWarn call sites — just flip the flag.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ↓ Toggle this to enable / disable all Quran performance logs
const ENABLE_QURAN_PERF_LOGS = true;
// ─────────────────────────────────────────────────────────────────────────────

const PREFIX = '[QURAN_PERF]';

/**
 * Logs a Quran performance event.
 * No-op when ENABLE_QURAN_PERF_LOGS is false.
 */
export function qLog(message: string): void {
  if (!ENABLE_QURAN_PERF_LOGS) return;
  console.warn(`${PREFIX} ${message}`);
}

/**
 * Logs a Quran performance warning.
 * No-op when ENABLE_QURAN_PERF_LOGS is false.
 */
export function qWarn(message: string): void {
  if (!ENABLE_QURAN_PERF_LOGS) return;
  console.warn(`${PREFIX} ${message}`);
}
