/**
 * Process-global toast pub/sub.
 *
 * Any module can call `showToast('text')` to surface a single-line pill at the
 * top of the active screen. The matching `ToastHost` component subscribes to
 * the same emitter and renders the pill — typically mounted once at the root
 * of a page (sibling of the ScrollView) so it overlays everything without
 * intercepting taps.
 *
 * Decoupled from React on purpose: callers don't need to thread props or use
 * context, and rapid back-to-back calls go straight through to the host's
 * queue state machine.
 */

export type ToastListener = (message: string) => void;

const listeners = new Set<ToastListener>();

export function showToast(message: string): void {
  listeners.forEach(fn => {
    try { fn(message); } catch {}
  });
}

export function subscribeToast(fn: ToastListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
