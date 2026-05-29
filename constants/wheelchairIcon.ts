/**
 * Wheelchair (accessibility) icon used by:
 *   - MasjidCard, right of the "Parkering"-chip → tooltip "Rullstolstillgänglig ingång"
 *
 * Source: Downloads/wheelchair_bold.svg (bold filled wheelchair, 800×800).
 * The original used a `<style>`/class for its fill (#275d9c); we inline the fill
 * via the `__C__` token instead — react-native-svg's SvgXml handles inline
 * `fill` far more reliably than CSS classes.
 *
 * It is rendered in its fixed brand blue (WHEELCHAIR_ICON_COLOR) in BOTH light
 * and dark mode — it is NOT themed. To swap in a different wheelchair.svg later,
 * replace WHEELCHAIR_ICON_SVG and keep `fill="__C__"` so the colour still applies.
 */
export const WHEELCHAIR_ICON_SVG = `<svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg"><path fill="__C__" d="M775.16,602.61l22.23,44.79c6.14,12.37,1.09,27.37-11.28,33.51l-102.29,51.38c-25.08,12.45-55.56,1.87-67.48-23.52l-98.09-208.76h-218.25c-24.88,0-45.98-18.3-49.5-42.93-52.95-370.65-49.91-347.63-50.5-357.07C200,43.19,247.37-2.55,304.77.11c51.99,2.41,93.83,45.16,95.2,97.19,1.36,51.46-36.17,94.41-85.33,101.62l7.3,51.08h203.06c13.81,0,25,11.19,25,25v50c0,13.81-11.19,25-25,25h-188.78l7.14,50h206.63c19.38,0,37.01,11.2,45.25,28.74l89.87,191.26,56.53-28.67c12.37-6.14,27.37-1.09,33.51,11.28h0ZM486.5,550h-38.29c-12.17,84.69-85.2,150-173.21,150-96.5,0-175-78.5-175-175,0-64.85,35.46-121.58,88.01-151.81-5.8-40.57-10.69-74.78-14.82-103.65C71.81,310.1,0,409.32,0,525c0,151.64,123.36,275,275,275,112.3,0,209.07-67.67,251.73-164.36l-40.24-85.64Z"/></svg>`;

/** Fixed brand blue from the source SVG — used in both light and dark mode. */
export const WHEELCHAIR_ICON_COLOR = '#275d9c';

/** Returns the icon markup with a colour applied (mirrors masjidIconXml). */
export const wheelchairIconXml = (color: string): string =>
  WHEELCHAIR_ICON_SVG.replace(/__C__/g, color);
