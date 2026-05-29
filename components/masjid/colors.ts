/**
 * Local color helpers for the masjid feature.
 *
 * The global theme tokens (T.textMuted #8E8E93, T.accent #668468) read too
 * dim against the deep black background in this dense map UI — addresses,
 * distances, FAB icons and form labels all fade into the background. These
 * helpers swap them for higher-contrast whites IN DARK MODE ONLY; light mode
 * falls through to the original tokens unchanged (no complaints there).
 *
 * Hierarchy used by the masjid screens:
 *   masjidIconColor  → 100% white for prominent FAB / search icons
 *   masjidLabelColor →  ~78% white for form labels & placeholders
 *   masjidSubColor   →  ~55% white for list sub-text (address, distance, "Visa fler")
 */
import type { Theme } from '../../theme/colors';

export function masjidIconColor(T: Theme): string {
  return T.isDark ? '#FFFFFF' : T.accent;
}
export function masjidLabelColor(T: Theme): string {
  return T.isDark ? 'rgba(255,255,255,0.78)' : T.textMuted;
}
export function masjidSubColor(T: Theme): string {
  return T.isDark ? 'rgba(255,255,255,0.55)' : T.textMuted;
}
