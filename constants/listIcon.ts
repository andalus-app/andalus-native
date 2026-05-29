/**
 * List icon — used by the collapsed "Närmaste masjid"-knapp (the round ball
 * at the bottom-left that appears after dragging the list off-screen).
 *
 * Source: Downloads/list.svg (three bullet dots + bars). The inline `<style>`
 * has been flattened to per-element `fill="__C__"` so the icon themes via
 * `listIconXml(color)` exactly like masjidIcon.
 */
export const LIST_ICON_SVG = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><circle fill="__C__" cx="56.87" cy="388.36" r="34.99" transform="translate(-323.69 292.29) rotate(-67.5)"/><rect fill="__C__" x="135.59" y="351.82" width="354.53" height="73.08" rx="36.54" ry="36.54"/><circle fill="__C__" cx="56.87" cy="256" r="34.99" transform="translate(-164.36 115.19) rotate(-45)"/><rect fill="__C__" x="135.59" y="219.46" width="354.53" height="73.08" rx="36.54" ry="36.54"/><circle fill="__C__" cx="56.87" cy="123.64" r="34.99" transform="translate(-26.88 16.37) rotate(-13.28)"/><rect fill="__C__" x="135.59" y="87.09" width="354.53" height="73.08" rx="36.54" ry="36.54"/></svg>`;

export const listIconXml = (color: string): string =>
  LIST_ICON_SVG.replace(/__C__/g, color);
