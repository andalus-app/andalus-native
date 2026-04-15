/**
 * announcement-notification — Supabase Edge Function
 *
 * Triggered by a Database Webhook on INSERT and UPDATE to the `announcements` table.
 * When an announcement with notification_mode='push' becomes active, sends an Expo
 * push notification to ALL registered user devices (every token in push_tokens).
 *
 * Sends only on activation transitions to avoid re-notifying on minor edits:
 *   - INSERT  → is_active=true  AND notification_mode='push'
 *   - UPDATE  → is_active=true  AND notification_mode='push'
 *              AND (was previously inactive OR previously mode='none')
 *
 * Invalid token handling:
 *   - DeviceNotRegistered → token deleted from push_tokens immediately
 *   - InvalidCredentials  → token deleted from push_tokens immediately
 *   - Temporary errors (MessageTooBig, MessageRateExceeded, ExpoError) → logged only
 *
 * SETUP (one-time, in Supabase dashboard):
 *   Database → Webhooks → Create webhook:
 *     Name:   announcement-notify
 *     Table:  announcements
 *     Events: INSERT, UPDATE
 *     URL:    https://<project-ref>.supabase.co/functions/v1/announcement-notification
 *     Headers:
 *       Content-Type:  application/json
 *       Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Deploy:
 *   npx supabase functions deploy announcement-notification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Permanent errors — token should be deleted immediately
const PERMANENT_ERRORS = new Set(["DeviceNotRegistered", "InvalidCredentials"]);

interface WebhookPayload {
  type:       "INSERT" | "UPDATE" | "DELETE";
  table:      string;
  schema:     string;
  record:     Record<string, unknown>;
  old_record: Record<string, unknown> | null;
}

interface ExpoTicket {
  status:  "ok" | "error";
  id?:     string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req: Request) => {
  try {
    const payload: WebhookPayload = await req.json();

    if (payload.table !== "announcements") {
      return new Response("ignored", { status: 200 });
    }

    const rec = payload.record;
    const old = payload.old_record;

    const isActive = rec.is_active === true;
    const isPush   = rec.notification_mode === "push";

    // Only proceed when this event represents a push announcement becoming active
    if (!isActive || !isPush) {
      return new Response("not a push activation", { status: 200 });
    }

    // For UPDATE: only send if this is a real activation transition.
    // Skip if the announcement was already active+push before (i.e. admin just edited text).
    if (payload.type === "UPDATE" && old) {
      const wasActive = old.is_active === true;
      const wasPush   = old.notification_mode === "push";
      if (wasActive && wasPush) {
        return new Response("already active+push — skipped", { status: 200 });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch tokens where user has not opted out of announcement notifications
    const { data: rows, error: tokenErr } = await supabase
      .from("push_tokens")
      .select("token")
      .neq("announcement_notif", false);

    if (tokenErr) {
      console.error("[announcement-notification] token fetch error:", tokenErr);
      return new Response(tokenErr.message, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return new Response("no tokens registered", { status: 200 });
    }

    const tokens: string[] = rows.map((r: { token: string }) => r.token);
    const title   = String(rec.title ?? "Nytt meddelande");
    const message = rec.message ? String(rec.message) : "";

    const messages = tokens.map((token) => ({
      to:       token,
      title,
      body:     message,
      sound:    "default",
      priority: "high",
      data:     { announcementId: String(rec.id ?? "") },
    }));

    // Expo push API: max 100 per request
    const chunks: typeof messages[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    // Send all chunks and collect tickets
    const allTickets: ExpoTicket[] = [];
    await Promise.all(
      chunks.map(async (chunk) => {
        const res = await fetch(EXPO_PUSH_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(chunk),
        });
        if (!res.ok) {
          console.error(`[announcement-notification] Expo HTTP ${res.status}`);
          return;
        }
        const json = await res.json() as { data: ExpoTicket[] };
        allTickets.push(...(json.data ?? []));
      }),
    );

    // Identify permanently invalid tokens and delete them from Supabase
    const deadTokens: string[] = [];
    allTickets.forEach((ticket, i) => {
      if (
        ticket.status === "error" &&
        ticket.details?.error &&
        PERMANENT_ERRORS.has(ticket.details.error)
      ) {
        const token = messages[i]?.to;
        if (token) {
          deadTokens.push(token);
          console.warn(
            `[announcement-notification] dead token (${ticket.details.error}): ${token}`,
          );
        }
      } else if (ticket.status === "error") {
        // Temporary error — log only, do not delete
        console.warn(
          `[announcement-notification] temporary error for token ${messages[i]?.to}:`,
          ticket.details?.error ?? ticket.message,
        );
      }
    });

    if (deadTokens.length > 0) {
      const { error: deleteErr } = await supabase
        .from("push_tokens")
        .delete()
        .in("token", deadTokens);
      if (deleteErr) {
        console.error("[announcement-notification] failed to delete dead tokens:", deleteErr.message);
      } else {
        console.log(`[announcement-notification] deleted ${deadTokens.length} dead token(s)`);
      }
    }

    const okCount   = allTickets.filter((t) => t.status === "ok").length;
    const errCount  = allTickets.filter((t) => t.status === "error").length;
    console.log(
      `[announcement-notification] sent "${title}" → ${okCount} ok, ${errCount} error(s), ${deadTokens.length} deleted`,
    );

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[announcement-notification]", err);
    return new Response(String(err), { status: 500 });
  }
});
