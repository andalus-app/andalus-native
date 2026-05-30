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

/**
 * Offline-banner palette — premium "light red bg / dark red text", tuned per
 * theme so it stays legible in both light and dark mode.
 */
export function masjidOfflineColors(isDark: boolean) {
  return isDark
    ? { bg: '#3A1F1F', text: '#FF8A8A' } // deep red tint / legible red on dark
    : { bg: '#FDE7E7', text: '#B3261E' }; // light red / dark red
}
