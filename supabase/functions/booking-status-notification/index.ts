/**
 * booking-status-notification — Supabase Edge Function
 *
 * Triggered by a Supabase Database Webhook on UPDATE to the `bookings` table.
 * When a booking status changes to 'approved', 'rejected', or 'cancelled' (admin-initiated),
 * sends an Expo push notification to the booking owner's device.
 *
 * SETUP (one-time, in Supabase dashboard):
 *   Database → Webhooks → Create webhook:
 *     Name:   booking-status-notify
 *     Table:  bookings
 *     Events: UPDATE
 *     URL:    https://<project-ref>.supabase.co/functions/v1/booking-status-notification
 *     Headers:
 *       Content-Type: application/json
 *       Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 *   Deploy:
 *     npx supabase functions deploy booking-status-notification
 *
 * NOTE: requires the push_tokens table (created by booking-notification setup).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, unknown>;
  old_record: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  try {
    const payload: WebhookPayload = await req.json();

    if (payload.type !== "UPDATE" || payload.table !== "bookings") {
      return new Response("ignored", { status: 200 });
    }

    const record = payload.record;
    const oldRecord = payload.old_record;
    const newStatus = String(record.status ?? "");
    const oldStatus = String(oldRecord?.status ?? "");

    // Only notify when status actually changes to approved, rejected, or cancelled.
    // Use oldStatus when available (requires REPLICA IDENTITY FULL on the bookings table).
    // Falls back gracefully when old_record is absent — may send a duplicate on retries,
    // but that is safer than silently dropping a notification.
    if (newStatus === oldStatus) return new Response("no change", { status: 200 });
    if (newStatus !== "approved" && newStatus !== "rejected" && newStatus !== "cancelled") {
      return new Response("irrelevant status", { status: 200 });
    }

    // Note: user self-cancellations never set bookings.status = 'cancelled' directly —
    // they insert a row in booking_exceptions instead. Any UPDATE that sets
    // status = 'cancelled' on the bookings table is therefore always admin-initiated.
    // The previous deleted_by guard was unreliable because RLS (anon key) blocks
    // writing deleted_by to the DB, so the webhook never saw it set.

    const userId = String(record.user_id ?? "");
    if (!userId) return new Response("no user_id", { status: 200 });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch the booking owner's push token
    const { data: tokenRow } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", userId)
      .single();

    if (!tokenRow?.token) {
      return new Response("no token for user", { status: 200 });
    }

    const activity = String(record.activity ?? "din bokning");
    const timeSlot = record.time_slot ? String(record.time_slot) : "";
    const adminComment = record.admin_comment ? String(record.admin_comment) : "";
    const date = record.start_date ? String(record.start_date) : "";
    const bookingId = String(record.id ?? "");

    const isApproved  = newStatus === "approved";
    const isCancelled = newStatus === "cancelled";
    const title = isApproved
      ? "Bokning godkänd ✓"
      : isCancelled
        ? "Bokning avbokad"
        : "Bokning avböjd";
    const bodyParts = [activity, timeSlot].filter(Boolean).join(" · ");
    const defaultMsg = isApproved
      ? "Din bokning har godkänts."
      : isCancelled
        ? "Din bokning har avbokats av administratören."
        : "Din bokning har avböjts.";
    const body = adminComment
      ? `${bodyParts}${bodyParts ? " – " : ""}${adminComment}`
      : bodyParts || defaultMsg;

    // `url` uses the app's registered scheme so iOS opens the native app
    // directly when the user taps from a locked/background screen.
    const deepLinkUrl = `hidayah://booking?bookingId=${bookingId}&date=${encodeURIComponent(date)}&view=my-bookings`;

    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{
        to: tokenRow.token,
        title,
        body,
        data: {
          url: deepLinkUrl,
          bookingId,
          date,
          screen: "my-bookings",
        },
        sound: "default",
        priority: "high",
      }]),
    });

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[booking-status-notification]", err);
    return new Response(String(err), { status: 500 });
  }
});
