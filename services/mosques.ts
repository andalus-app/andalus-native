/**
 * Data layer for "Närmaste masjid".
 *
 * Supabase is the ONLY data source. No Google APIs are used anywhere.
 * All reads go through the SECURITY DEFINER `nearby_mosques` RPC, which returns
 * ONLY approved mosques (status='approved') sorted ascending by distance.
 * Pending / rejected / blocked rows and non-approved images are never returned.
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { sha256 } from './cryptoUtils';

export type Mosque = {
  id: string;
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  opening_hours: Record<string, string> | null;
  parking_available: boolean | null;
  access_info: string | null;
  phone: string | null;
  website: string | null;
  prayer_times_url: string | null;
  image_url: string | null;
  distance_meters: number;
};

/** How many masjid are shown in the default (compact) list — the "3 närmaste". */
export const MASJID_COLLAPSED_COUNT = 3;
/** How many approved masjid to fetch in one go (markers + expandable list). */
export const MASJID_FETCH_LIMIT = 50;

/**
 * Fetch approved mosques sorted by distance from (lat, lng).
 *
 * @param signal AbortSignal — pass the screen's controller so an in-flight
 *               request is cancelled when the feature closes or a new query
 *               supersedes it. A cancelled request throws AbortError, which the
 *               caller treats as a no-op (no state update).
 */
export async function fetchNearbyApprovedMosques(
  lat: number,
  lng: number,
  limit: number,
  offset: number,
  signal?: AbortSignal,
): Promise<Mosque[]> {
  let query = supabase.rpc('nearby_mosques', {
    p_lat: lat,
    p_lng: lng,
    p_limit: limit,
    p_offset: offset,
  });
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) {
    // AbortError surfaces here as a thrown error from supabase-js — rethrow so
    // the caller's try/catch can distinguish abort from real failures.
    throw error;
  }
  return (data ?? []) as Mosque[];
}

/** A matched approved masjid from text search (no distance — not from the RPC). */
export type MosqueSearchResult = Omit<Mosque, 'distance_meters'>;

/**
 * Text-search APPROVED mosques by name / city / address / postal_code.
 * Approved-only (RLS also enforces this). Pass an AbortSignal so the query is
 * cancelled on the next keystroke or when the feature closes.
 */
export async function searchApprovedMosques(
  query: string,
  signal?: AbortSignal,
): Promise<MosqueSearchResult[]> {
  // Sanitise: commas separate .or() filters and %/() are PostgREST syntax.
  const term = query.replace(/[%,()*]/g, ' ').trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;

  let q = supabase
    .from('mosques')
    .select('id,name,address,postal_code,city,country,latitude,longitude,opening_hours,parking_available,access_info,phone,website,prayer_times_url,image_url')
    .eq('status', 'approved')
    .or(`name.ilike.${like},city.ilike.${like},address.ilike.${like},postal_code.ilike.${like}`)
    .limit(8);
  if (signal) q = q.abortSignal(signal);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MosqueSearchResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2B — user submission ("Lägg till masjid")
// ─────────────────────────────────────────────────────────────────────────────

export const MOSQUE_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export type MosqueSubmission = {
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  opening_hours: Record<string, string> | null;
  parking_available: boolean | null;
  access_info: string | null;
  phone: string | null;
  website: string | null;
  prayer_times_url: string | null;
  image_url: string | null;
  image_storage_path: string | null;
};

/** Server-side error codes raised by the submit_mosque RPC. */
export type SubmitErrorCode =
  | 'rate_limit_hour' | 'rate_limit_day' | 'submitter_blocked'
  | 'mosque_name_required' | 'mosque_coords_required' | 'unknown';

function classifySubmitError(message: string): SubmitErrorCode {
  const m = (message || '').toLowerCase();
  if (m.includes('rate_limit_hour')) return 'rate_limit_hour';
  if (m.includes('rate_limit_day')) return 'rate_limit_day';
  if (m.includes('submitter_blocked')) return 'submitter_blocked';
  if (m.includes('mosque_name_required')) return 'mosque_name_required';
  if (m.includes('mosque_coords_required')) return 'mosque_coords_required';
  return 'unknown';
}

/**
 * Stable submitter identity. The raw device id is NEVER sent — only its SHA-256
 * hash. user_id (app_users.id) is included when the user is known, else null.
 */
async function getSubmitterIdentity(): Promise<{ userId: string | null; deviceIdHash: string }> {
  const existing = await AsyncStorage.getItem('islamnu_device_id');
  let deviceId: string;
  if (existing) {
    deviceId = existing;
  } else {
    const rnd: string | undefined = (globalThis as any)?.crypto?.randomUUID?.();
    deviceId = rnd ?? `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem('islamnu_device_id', deviceId);
  }
  const userId = await AsyncStorage.getItem('islamnu_user_id'); // null for non-linked users
  return { userId, deviceIdHash: sha256(deviceId) };
}

/**
 * Upload a submission image to the public `mosque-images` bucket under the
 * `submissions/` folder (the only path anon may write). Returns the public URL
 * and storage path. Caller should enforce the 5 MB / single-image limits.
 */
export async function uploadMosqueSubmissionImage(
  localUri: string,
  mimeType: string = 'image/jpeg',
  base64Data?: string,
  folder: 'submissions' | 'approved' = 'submissions',
): Promise<{ url?: string; path?: string; error?: string }> {
  try {
    // Normalise to a bucket-allowed mime. expo-image-picker (quality set) exports
    // JPEG, but asset.mimeType can be heic/unknown — force a supported type so the
    // bucket's allowed_mime_types check never rejects the upload.
    const contentType = mimeType === 'image/png' ? 'image/png'
      : mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    // anon may only write to submissions/; admins (RLS) may write to approved/.
    const path = `${folder}/mosque_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Reuse base64 already read for size validation; else read it now.
    const base64 = base64Data ?? await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const { error } = await supabase.storage
      .from('mosque-images')
      .upload(path, bytes, { contentType, upsert: false });
    if (error) return { error: error.message };

    const { data } = supabase.storage.from('mosque-images').getPublicUrl(path);
    return { url: data.publicUrl, path };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Submit a masjid proposal via the SECURITY DEFINER submit_mosque RPC. The RPC
 * forces status='pending' and enforces blocked-submitter + rate-limit checks
 * server-side. Regular users can NEVER create an approved row.
 */
export async function submitMosque(
  input: MosqueSubmission,
): Promise<{ id?: string; errorCode?: SubmitErrorCode; error?: string }> {
  const { userId, deviceIdHash } = await getSubmitterIdentity();
  const { data, error } = await supabase.rpc('submit_mosque', {
    p_name: input.name,
    p_address: input.address,
    p_postal_code: input.postal_code,
    p_city: input.city,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_opening_hours: input.opening_hours,
    p_parking_available: input.parking_available,
    p_access_info: input.access_info,
    p_image_url: input.image_url,
    p_image_storage_path: input.image_storage_path,
    p_user_id: userId,
    p_device_id_hash: deviceIdHash,
    p_phone: input.phone,
    p_website: input.website,
    p_prayer_times_url: input.prayer_times_url,
  });
  if (error) return { errorCode: classifySubmitError(error.message), error: error.message };
  return { id: data as string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — admin moderation & management
// All functions below require an authenticated admin Supabase session; the RLS
// policies (is_linked_admin()) enforce this server-side — there are no
// client-only admin checks. anon callers are rejected by RLS.
// ─────────────────────────────────────────────────────────────────────────────

export type MosqueStatus = 'pending' | 'approved' | 'rejected' | 'blocked';

/** Full mosque row as seen by admins (includes moderation/provenance fields). */
export type AdminMosque = {
  id: string;
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  opening_hours: Record<string, string> | null;
  parking_available: boolean | null;
  access_info: string | null;
  phone: string | null;
  website: string | null;
  prayer_times_url: string | null;
  image_url: string | null;
  image_storage_path: string | null;
  status: MosqueStatus;
  submitted_by_user_id: string | null;
  submitted_device_hash: string | null;
  approved_by_admin_id: string | null;
  rejection_reason: string | null;
  address_source: string | null;
  address_verified: boolean | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

/** Fields an admin can write when editing or manually adding a masjid. */
export type AdminMosqueInput = {
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  opening_hours: Record<string, string> | null;
  parking_available: boolean | null;
  access_info: string | null;
  phone: string | null;
  website: string | null;
  prayer_times_url: string | null;
  image_url: string | null;
  image_storage_path: string | null;
  address_verified?: boolean;
  address_source?: string | null;
};

const ADMIN_COLS =
  'id,name,address,postal_code,city,country,latitude,longitude,opening_hours,' +
  'parking_available,access_info,phone,website,prayer_times_url,image_url,image_storage_path,status,' +
  'submitted_by_user_id,submitted_device_hash,approved_by_admin_id,rejection_reason,' +
  'address_source,address_verified,created_at,updated_at,approved_at';

async function authUid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** List mosques by status, newest first (admin-only via RLS). */
export async function adminListMosques(status: MosqueStatus): Promise<AdminMosque[]> {
  const { data, error } = await supabase
    .from('mosques')
    .select(ADMIN_COLS)
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AdminMosque[];
}

/** Approve a submission: status='approved' + approver + timestamp. */
export async function adminApproveMosque(id: string): Promise<void> {
  const uid = await authUid();
  const { error } = await supabase
    .from('mosques')
    .update({ status: 'approved', approved_by_admin_id: uid, approved_at: new Date().toISOString(), rejection_reason: null })
    .eq('id', id);
  if (error) throw error;
}

/** Reject a submission with an optional reason. */
export async function adminRejectMosque(id: string, reason: string | null): Promise<void> {
  const { error } = await supabase
    .from('mosques')
    .update({ status: 'rejected', rejection_reason: reason || null })
    .eq('id', id);
  if (error) throw error;
}

/** Set an arbitrary status (e.g. unpublish approved → rejected/blocked, or restore). */
export async function adminSetMosqueStatus(id: string, status: MosqueStatus): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'approved') {
    patch.approved_by_admin_id = await authUid();
    patch.approved_at = new Date().toISOString();
    patch.rejection_reason = null;
  }
  const { error } = await supabase.from('mosques').update(patch).eq('id', id);
  if (error) throw error;
}

/** Edit an existing mosque's fields. */
export async function adminUpdateMosque(id: string, input: AdminMosqueInput): Promise<void> {
  const { error } = await supabase.from('mosques').update(input).eq('id', id);
  if (error) throw error;
}

/** Create a masjid directly as approved (bypasses pending moderation). */
export async function adminCreateApprovedMosque(input: AdminMosqueInput): Promise<string> {
  const uid = await authUid();
  const { data, error } = await supabase
    .from('mosques')
    .insert({
      ...input,
      country: 'Sweden',
      status: 'approved',
      approved_by_admin_id: uid,
      approved_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Mark an address as admin-verified. */
export async function adminVerifyMosqueAddress(id: string): Promise<void> {
  const { error } = await supabase
    .from('mosques')
    .update({ address_verified: true, address_source: 'admin' })
    .eq('id', id);
  if (error) throw error;
}

/** Block a submitter by user_id and/or device hash (permanent if blockedUntil null). */
export async function adminBlockSubmitter(args: {
  user_id: string | null;
  device_id_hash: string | null;
  reason: string | null;
  blocked_until: string | null;
}): Promise<void> {
  if (!args.user_id && !args.device_id_hash) throw new Error('no_block_target');
  const uid = await authUid();
  const { error } = await supabase.from('blocked_submitters').insert({
    user_id: args.user_id,
    device_id_hash: args.device_id_hash,
    reason: args.reason,
    blocked_until: args.blocked_until,
    created_by_admin_id: uid,
  });
  if (error) throw error;
}
