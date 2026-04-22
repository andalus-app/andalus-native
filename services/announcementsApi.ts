/**
 * Announcements API — Supabase CRUD and image upload.
 *
 * Two caller contexts:
 *  - Public / users: fetchActiveAnnouncements() — anon key, RLS filters to active+in-range rows.
 *  - Admin: all other functions — require an authenticated Supabase Auth session so that
 *    auth.uid() is set and the RLS "admin write" policy passes.
 */
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';

export type DisplayType    = 'popup' | 'banner' | 'notification_only' | 'home_top';
export type NotifMode      = 'none' | 'push';

export type Announcement = {
  id:                       string;
  title:                    string;
  message:                  string | null;
  image_url:                string | null;
  link_url:                 string | null;
  link_text:                string | null;
  display_type:             DisplayType;
  notification_mode:        NotifMode;
  is_active:                boolean;
  starts_at:                string | null;  // ISO timestamp
  ends_at:                  string | null;  // ISO timestamp
  created_by_app_user_id:   string | null;
  created_by_auth_user_id:  string | null;
  updated_at:               string;
  created_at:               string;
};

export type AnnouncementInput = Omit<Announcement,
  'id' | 'created_at' | 'updated_at' | 'created_by_auth_user_id'
>;

// ── Public ────────────────────────────────────────────────────────────────────

/** Fetch announcements that are active and within their optional date window.
 *  RLS enforces this server-side; we also filter client-side for safety. */
export async function fetchActiveAnnouncements(): Promise<Announcement[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[announcementsApi] fetchActive:', error.message); return []; }
  return (data ?? []) as Announcement[];
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/** Fetch ALL announcements regardless of active state. Admin view only. */
export async function fetchAllAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.warn('[announcementsApi] fetchAll:', error.message); return []; }
  return (data ?? []) as Announcement[];
}

export async function createAnnouncement(
  input: AnnouncementInput,
): Promise<{ data: Announcement | null; error: string | null }> {
  const { data, error } = await supabase
    .from('announcements')
    .insert([{ ...input, updated_at: new Date().toISOString() }])
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as Announcement, error: null };
}

export async function updateAnnouncement(
  id: string,
  patch: Partial<AnnouncementInput>,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('announcements')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteAnnouncement(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Upload an image from a local URI to Supabase Storage (bucket: 'announcements').
 * Returns the public URL of the uploaded file, or null on failure.
 *
 * Requires an active Supabase Auth session so the storage RLS policy passes.
 * Uses expo-file-system (already installed) to read the file as base64, then
 * decodes to a Uint8Array for the Supabase Storage SDK upload.
 */
export async function uploadAnnouncementImage(
  localUri: string,
  mimeType: string = 'image/jpeg',
): Promise<{ url: string | null; error: string | null }> {
  try {
    const ext      = mimeType === 'image/png' ? 'png' : 'jpg';
    const fileName = `announcement_${Date.now()}.${ext}`;
    const path     = `images/${fileName}`;

    // Read file as base64 via expo-file-system
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Decode base64 → Uint8Array for Supabase Storage upload
    const binary  = atob(base64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const { error: uploadError } = await supabase.storage
      .from('announcements')
      .upload(path, bytes, { contentType: mimeType, upsert: false });

    if (uploadError) return { url: null, error: uploadError.message };

    const { data } = supabase.storage.from('announcements').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  } catch (e: unknown) {
    return { url: null, error: String(e) };
  }
}
