/** Format a distance in metres for Swedish UI (decimal comma). */
export function formatDistance(meters: number): string {
  if (!isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** Render opening_hours jsonb ({ dag: "tid" }) as "Dag: tid" lines. */
export function formatOpeningHours(hours: Record<string, string> | null | undefined): string[] {
  if (!hours || typeof hours !== 'object') return [];
  return Object.entries(hours).map(([k, v]) => {
    const label = k.charAt(0).toUpperCase() + k.slice(1);
    return `${label}: ${v}`;
  });
}
