/**
 * booking-notification — Supabase Edge Function
 *
 * Triggered by a Supabase Database Webhook on INSERT to the `bookings` table.
 * Fetches all registered admin push tokens and sends an Expo push notification
 * to each admin device so they are notified instantly even when the app is
 * in the background or the screen is locked.
 *
 * SETUP (one-time, in Supabase dashboard):
 *   1. SQL Editor — create the push_tokens table:
 *        create table if not exists push_tokens (
 *          user_id  text primary key,
 *          token    text not null,
 *          role     text not null default 'user',
 *          updated_at timestamptz not null default now()
 *        );
 *
 *   2. Database → Webhooks → Create webhook:
 *        Name:   new-booking-notify
 *        Table:  bookings
 *        Events: INSERT
 *        URL:    https://<project-ref>.supabase.co/functions/v1/booking-notification
 *        Headers:
 *          Content-Type: application/json
 *          Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 *   3. Deploy this function:
 *        npx supabase functions deploy booking-notification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, unknown>;
  schema: string;
}

Deno.serve(async (req: Request) => {
  try {
    const payload: WebhookPayload = await req.json();

    // Only handle new bookings with pending status
    if (payload.type !== "INSERT" || payload.table !== "bookings") {
      return new Response("ignored", { status: 200 });
    }

    const booking = payload.record;
    if (booking.status !== "pending") {
      return new Response("not pending", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch all admin push tokens
    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("role", "admin");

    if (!tokens || tokens.length === 0) {
      return new Response("no admin tokens", { status: 200 });
    }

    const name = String(booking.name ?? "Okänd");
    const timeSlot = booking.time_slot ? String(booking.time_slot) : "";
    const activity = booking.activity ? String(booking.activity) : "";
    const date = booking.start_date ? String(booking.start_date) : "";

    // Format: "Fatih – 08:00–09:00 · Koranskola"
    const bodyParts = [timeSlot, activity].filter(Boolean).join(" · ");

    // `url` uses the app's registered scheme (hidayah://) so iOS opens the
    // native app directly instead of falling through to Safari.
    // expo-router also reads this field for in-app navigation on cold starts.
    const bookingUrl = `hidayah://booking?bookingId=${String(booking.id ?? "")}&date=${encodeURIComponent(date)}`;

    const messages = tokens.map(({ token }: { token: string }) => ({
      to: token,
      title: `Ny bokningsförfrågan – ${name}`,
      body: bodyParts || "En ny bokning väntar på godkännande.",
      data: {
        url: bookingUrl,
        bookingId: String(booking.id ?? ""),
        date,
        screen: "booking",
      },
      sound: "default",
      priority: "high",
    }));

    // Expo push API accepts up to 100 messages per request
    const chunks: typeof messages[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }
    await Promise.all(
      chunks.map((chunk) =>
        fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
        })
      ),
    );

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[booking-notification]", err);
    return new Response(String(err), { status: 500 });
  }
});
