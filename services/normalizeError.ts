/**
 * Coerces any thrown / rejected value into a real `Error` with a readable
 * message.
 *
 * Why this exists: a startup crash surfaced as the literal string
 * `[object Object]` in a TestFlight build. That happens when code throws or
 * rejects a non-Error value — a plain object (e.g. a Supabase error
 * `{ message, code }`, a fetch Response, or a bare `{}`) — and the runtime /
 * expo-router stringifies it with the default `Object.prototype.toString`,
 * which yields `"[object Object]"` and loses the real cause.
 *
 * Passing every caught value through `normalizeError` guarantees a stable,
 * inspectable `Error.message`, so logs and the root ErrorBoundary show what
 * actually failed instead of `[object Object]`.
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;

  if (typeof error === 'string') return new Error(error);

  // Common shapes that carry a usable message but are NOT Error instances:
  // Supabase PostgrestError ({ message, code, details }), AuthError, fetch
  // error payloads, RN bridge rejections, etc. Surface the message and keep
  // the rest as context.
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const message =
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.error === 'string'
          ? obj.error
          : undefined;

    let serialized: string;
    try {
      serialized = JSON.stringify(error);
    } catch {
      // Circular / non-serialisable (e.g. a Response object).
      serialized = String(error);
    }

    const err = new Error(message ?? serialized);
    // Preserve the original payload for deeper inspection in logs / Sentry.
    (err as Error & { cause?: unknown }).cause = error;
    return err;
  }

  // null / undefined / number / boolean / symbol
  return new Error(String(error));
}

/**
 * Convenience: normalize and return the human-readable message in one call.
 * Used by the root ErrorBoundary and startup logging.
 */
export function describeError(error: unknown): string {
  return normalizeError(error).message;
}
