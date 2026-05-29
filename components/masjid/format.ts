/** Format a distance in metres for Swedish UI (decimal comma). */
export function formatDistance(meters: number): string {
  if (!isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/**
 * Render opening_hours jsonb ({ dag: "tid" }) as "Dag: tid" lines.
 * The legacy "alla" key (used by the simple HH:MM–HH:MM picker, since the
 * masjid is open the same hours every day) is shown as "Mån–Sön" so the card
 * never displays the awkward technical label "Alla:".
 *
 * Strips any already-embedded day prefix from the value (older rows were
 * saved as e.g. `{ alla: "Mån-Sön: 05:00-23:00" }`, which would otherwise
 * render as "Mån–Sön: Mån-Sön: 05:00-23:00").
 */
const EMBEDDED_DAY_PREFIX = /^\s*(m[åa]n[\s\-–]*s[öo]n|mon[\s\-–]*sun|alla|all)\s*:\s*/i;

export function formatOpeningHours(hours: Record<string, string> | null | undefined): string[] {
  if (!hours || typeof hours !== 'object') return [];
  return Object.entries(hours).map(([k, v]) => {
    const label = k.toLowerCase() === 'alla'
      ? 'Mån–Sön'
      : k.charAt(0).toUpperCase() + k.slice(1);
    const cleaned = (v ?? '').replace(EMBEDDED_DAY_PREFIX, '').trim();
    return `${label}: ${cleaned}`;
  });
}

/**
 * Format a Swedish postal code as the user types: strip non-digits, cap at
 * five, then insert a space after the third digit. So "16370" → "163 70" and
 * "163  70" → "163 70". Returns digits only while shorter than four chars so
 * the user can still see a partial entry without a trailing space appearing.
 *
 * Use this in `onChangeText` for any postal-code input so what the user sees,
 * what gets stored in state, and what gets written to Supabase all match the
 * Swedish postal convention.
 */
export function formatSwedishPostalCode(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 5);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
