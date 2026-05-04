/**
   * youtube-streams — Supabase Edge Function                                                  
   *                                                                                         
   * QUOTA BUDGET (default config, 10,000 units/day):
   *   Normal mode : NORMAL_TTL_SEC=1800 → 48 refreshes/day × 202 units = ~9,696 units ✓       
   *   Hot mode    : 80 polls × 2 units = 160 units per live event                             
   *                                                                                           
   * ⚠️   Do NOT set NORMAL_TTL_SEC below 900 — exceeds 10k/day quota.                          
   */                                                                                          
                                                                                             
  import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
                                                                                             
  // ─── Types ────────────────────────────────────────────────────────────────────            
                                                                                             
  type Mode = "normal" | "hot";                                                                
                                                                                             
  interface StreamItem {                                                                       
    videoId: string;
    title: string;                                                                             
    thumbnail: string;                                                                       
    liveBroadcastContent: "live" | "upcoming" | "none";
    scheduledStartTime: string | null;
    actualStartTime: string | null;                                                            
  }
                                                                                               
  interface CacheRow {                                                                         
    channel_id: string;
    live: StreamItem[];                                                                        
    upcoming: StreamItem[];                                                                  
    mode: Mode;
    cached_at: string | null;
    hot_video_id: string | null;                                                               
    hot_scheduled_at: string | null;
    refreshing: boolean;                                                                       
    refresh_started_at: string | null;                                                       
  }

  interface FetchSearchResult {
    live: StreamItem[];
    upcoming: StreamItem[];                                                                    
    units: number;
  }                                                                                            
                                                                                             
  // ─── Config ───────────────────────────────────────────────────────────────────

  const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;                                 
  const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const YOUTUBE_API_KEY       = Deno.env.get("YOUTUBE_API_KEY")!;                              
  const NORMAL_TTL_SEC        = parseInt(Deno.env.get("NORMAL_TTL_SEC")          ?? "1800",    
  10);                                                                                         
  const HOT_TTL_SEC           = parseInt(Deno.env.get("HOT_TTL_SEC")             ?? "30",      
  10);                                                                                         
  const HOT_WINDOW_BEFORE_MIN = parseInt(Deno.env.get("HOT_WINDOW_BEFORE_MIN")   ?? "30",    
  10);                                                                                         
  const HOT_WINDOW_AFTER_MIN  = parseInt(Deno.env.get("HOT_WINDOW_AFTER_MIN")    ?? "30",
  10);                                                                                         
  const LOCK_TIMEOUT_SEC      = 30;                                                          
  const DEFAULT_CHANNEL_ID    = "UCQhN1h0T-02TYWf-mD3-2hQ";                                    
  const YT_BASE               = "https://www.googleapis.com/youtube/v3";                     
                                                                                               
  const CORS: Record<string, string> = {                                                       
    "Access-Control-Allow-Origin":  "*",                                                       
    "Access-Control-Allow-Methods": "GET, OPTIONS",                                            
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",    
  };                                                                                           
  
  // ─── Utilities ────────────────────────────────────────────────────────────────            
                                                                                             
  function jsonResp(data: unknown, status = 200): Response {                                   
    return new Response(JSON.stringify(data), {                                              
      status,                                                                                  
      headers: { ...CORS, "Content-Type": "application/json" },
    });                                                                                        
  }                                                                                          
                                                                                               
  function addLog(                                                                           
    sb: SupabaseClient, channelId: string, source: string, mode: Mode | null,
    apiUnits: number, durationMs: number, success = true, error?: string                       
  ): void {
    sb.from("yt_fetch_log")                                                                    
      .insert({ channel_id: channelId, source, mode, api_units: apiUnits,                      
                duration_ms: durationMs, success, error: error ?? null })
      .then(() => {});                                                                         
  }                                                                                          
                                                                                               
  // ─── Hot-window detection ─────────────────────────────────────────────────────            
  
  function detectHotCandidate(                                                                 
    upcoming: StreamItem[], nowMs: number                                                    
  ): { videoId: string; scheduledAt: Date } | null {                                           
    const windowStart = nowMs - HOT_WINDOW_AFTER_MIN  * 60_000;
    const windowEnd   = nowMs + HOT_WINDOW_BEFORE_MIN * 60_000;                                
    for (const item of upcoming) {                                                           
      if (!item.scheduledStartTime) continue;                                                  
      const t = new Date(item.scheduledStartTime).getTime();                                   
      if (t >= windowStart && t <= windowEnd) {
        return { videoId: item.videoId, scheduledAt: new Date(item.scheduledStartTime) };      
      }                                                                                        
    }
    return null;                                                                               
  }                                                                                          

  // ─── YouTube helpers ──────────────────────────────────────────────────────────

  function mapSearchItem(item: Record<string, unknown>): StreamItem {
    const id      = item.id      as Record<string, string>;
    const snippet = item.snippet as Record<string, unknown>;                                   
    const thumbs  = (snippet.thumbnails as Record<string, Record<string, string>>) ?? {};
    return {                                                                                   
      videoId:             id.videoId ?? "",                                                 
      title:               (snippet.title as string) ?? "",                                    
      thumbnail:           thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.default?.url ?? "",
      liveBroadcastContent: (snippet.liveBroadcastContent as "live" | "upcoming" | "none") ??  
  "none",                                                                                    
      scheduledStartTime:  null,                                                               
      actualStartTime:     null,                                                               
    };
  }                                                                                            
                                                                                             
  async function ytSearch(channelId: string, eventType: "live" | "upcoming"):                  
  Promise<StreamItem[]> {
    const url = new URL(`${YT_BASE}/search`);                                                  
    url.searchParams.set("part", "snippet");                                                 
    url.searchParams.set("channelId", channelId);                                              
    url.searchParams.set("eventType", eventType);
    url.searchParams.set("type", "video");                                                     
    url.searchParams.set("maxResults", "5");                                                   
    url.searchParams.set("key", YOUTUBE_API_KEY);
    const res = await fetch(url.toString());                                                   
    if (!res.ok) {                                                                             
      const body = await res.text().catch(() => "");
      throw new Error(`search.list [${eventType}] HTTP ${res.status}: ${body.slice(0, 200)}`); 
    }                                                                                          
    const json = await res.json() as { items?: Record<string, unknown>[] };
    return (json.items ?? []).map(mapSearchItem);                                              
  }                                                                                            
  
  async function fetchVideoDetailsMap(                                                         
    videoIds: string[]                                                                       
  ): Promise<Map<string, { scheduledStartTime: string | null; actualStartTime: string | null
  }>> {                                                                                        
    const map = new Map<string, { scheduledStartTime: string | null; actualStartTime: string |
  null }>();                                                                                   
    if (!videoIds.length) return map;                                                        
    const url = new URL(`${YT_BASE}/videos`);                                                  
    url.searchParams.set("part", "liveStreamingDetails");                                    
    url.searchParams.set("id", videoIds.join(","));                                            
    url.searchParams.set("key", YOUTUBE_API_KEY);
    const res = await fetch(url.toString());                                                   
    if (!res.ok) return map;                                                                   
    const json = await res.json() as {
      items?: Array<{ id: string; liveStreamingDetails?: { scheduledStartTime?: string;        
  actualStartTime?: string } }>;                                                               
    };
    for (const item of json.items ?? []) {                                                     
      map.set(item.id, {                                                                     
        scheduledStartTime: item.liveStreamingDetails?.scheduledStartTime ?? null,
        actualStartTime:    item.liveStreamingDetails?.actualStartTime    ?? null,             
      });
    }                                                                                          
    return map;                                                                              
  }
                                                                                               
  async function fetchFromSearch(channelId: string): Promise<FetchSearchResult> {
    // 200 units: two parallel search.list calls                                               
    const [liveItems, upcomingItems] = await Promise.all([                                     
      ytSearch(channelId, "live"),                                                             
      ytSearch(channelId, "upcoming"),                                                         
    ]);                                                                                        
    // ~2 units: enrich upcoming with scheduledStartTime                                     
    const upcomingIds = upcomingItems.map((v) => v.videoId).filter(Boolean);                   
    const detailsMap  = await fetchVideoDetailsMap(upcomingIds);
    const upcoming    = upcomingItems.map((item) => {                                          
      const d = detailsMap.get(item.videoId);                                                  
      return { ...item, scheduledStartTime: d?.scheduledStartTime ?? null, actualStartTime:    
  d?.actualStartTime ?? null };                                                                
    });                                                                                      
    return { live: liveItems, upcoming, units: 202 };                                          
  }                                                                                          

  async function fetchVideoById(videoId: string): Promise<StreamItem | null> {                 
    const url = new URL(`${YT_BASE}/videos`);
    url.searchParams.set("part", "snippet,liveStreamingDetails");                              
    url.searchParams.set("id", videoId);                                                     
    url.searchParams.set("key", YOUTUBE_API_KEY);                                              
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`videos.list [${videoId}] HTTP ${res.status}`);               
    const json = await res.json() as {                                                         
      items?: Array<{
        id: string;                                                                            
        snippet?: { title?: string; liveBroadcastContent?: string; thumbnails?: Record<string,
  { url?: string }> };                                                                         
        liveStreamingDetails?: { scheduledStartTime?: string; actualStartTime?: string };
      }>;                                                                                      
    };                                                                                       
    const item = json.items?.[0];
    if (!item) return null;                                                                    
    const thumbs = item.snippet?.thumbnails ?? {};
    return {                                                                                   
      videoId:             item.id,                                                          
      title:               item.snippet?.title ?? "",
      thumbnail:           thumbs["maxres"]?.url ?? thumbs["high"]?.url ??                     
  thumbs["default"]?.url ?? "",
      liveBroadcastContent: (item.snippet?.liveBroadcastContent ?? "none") as "live" |         
  "upcoming" | "none",                                                                         
      scheduledStartTime:  item.liveStreamingDetails?.scheduledStartTime ?? null,
      actualStartTime:     item.liveStreamingDetails?.actualStartTime    ?? null,              
    };                                                                                         
  }
                                                                                               
  // ─── Push notifications ───────────────────────────────────────────────────────
  //
  // Called when a new live stream is first detected (videoId not seen before).
  // Fetches all Expo push tokens from `push_tokens` and sends via Expo Push API.
  // Batches in groups of 100 (Expo API limit). Errors are logged but never thrown —
  // a push failure must never prevent the cache from being updated.

  async function sendLivePushToAll(
    sb: SupabaseClient,
    videoId: string,
    title: string,
  ): Promise<void> {
    const { data: rows, error } = await sb
      .from("push_tokens")
      .select("token")
      .eq("live_notif", true)
      .not("token", "is", null);

    if (error || !rows || rows.length === 0) {
      console.warn("[Push] no tokens found or error:", error?.message ?? "empty");
      return;
    }

    const messages = rows.map((r: { token: string }) => ({
      to:        r.token,
      title:     "Direktsändning pågår nu",
      body:      title,
      sound:     "default",
      priority:  "high",
      channelId: "default", // Android notification channel
      data:      { screen: "youtube_live", videoId },
    }));

    console.log(`[Push] Sending live push to ${messages.length} devices for "${title}"`);

    // Expo Push API accepts max 100 messages per request
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body:    JSON.stringify(batch),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.warn(`[Push] Expo API error ${res.status}:`, body.slice(0, 200));
        }
      } catch (e) {
        console.warn("[Push] fetch error:", e);
      }
    }
  }

  // ─── Handler ──────────────────────────────────────────────────────────────────

  Deno.serve(async (req: Request): Promise<Response> => {                                      
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
                                                                                               
    const t0 = Date.now();                                                                   
    const { searchParams } = new URL(req.url);                                                 
    const channelId = searchParams.get("channel_id") ?? DEFAULT_CHANNEL_ID;                    
  
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !YOUTUBE_API_KEY) {                          
      return jsonResp({ error: "Server misconfiguration: missing environment variables." },  
  500);                                                                                        
    }                                                                                        
                                                                                               
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false
   } });
                                                                                               
    // ── 1. Read cache ───────────────────────────────────────────────────────────            
    const { data: row, error: rowErr } = await sb
      .from("yt_stream_cache")                                                                 
      .select("*")                                                                           
      .eq("channel_id", channelId)                                                             
      .maybeSingle<CacheRow>();                                                              
                                                                                               
    if (rowErr) {
      addLog(sb, channelId, "error", null, 0, Date.now() - t0, false, rowErr.message);         
      return jsonResp({ error: "Database error.", detail: rowErr.message }, 500);              
    }                                                                                          
                                                                                               
    const nowMs = Date.now();                                                                  
                                                                                             
    // ── 2. Determine mode ───────────────────────────────────────────────────────
    let mode: Mode           = row?.mode ?? "normal";
    let hotVideoId: string | null = row?.hot_video_id ?? null;                                 
    let hotScheduledAt: Date | null = row?.hot_scheduled_at ? new Date(row.hot_scheduled_at) : 
  null;                                                                                        
                                                                                               
    const candidate = detectHotCandidate((row?.upcoming ?? []) as StreamItem[], nowMs);        
    if (candidate) {
      mode           = "hot";                                                                  
      hotVideoId     = candidate.videoId;                                                    
      hotScheduledAt = candidate.scheduledAt;                                                  
    } else if (mode === "hot") {
      mode           = "normal";                                                               
      hotVideoId     = null;                                                                 
      hotScheduledAt = null;                                                                   
    }
                                                                                               
    // ── 3. Return if cache is fresh ─────────────────────────────────────────────            
    const ttlMs = (mode === "hot" ? HOT_TTL_SEC : NORMAL_TTL_SEC) * 1000;
    if (row?.cached_at && nowMs - new Date(row.cached_at).getTime() < ttlMs) {                 
      addLog(sb, channelId, "cache", mode, 0, Date.now() - t0);                              
      return jsonResp({ live: row.live, upcoming: row.upcoming, cachedAt: row.cached_at,       
  source: "cache", mode });                                                                    
    }                                                                                          
                                                                                               
    // ── 4. Acquire distributed lock ─────────────────────────────────────────────          
    const { data: lockAcquired, error: lockErr } = await sb.rpc("acquire_yt_refresh_lock", {
      p_channel_id: channelId, p_timeout_sec: LOCK_TIMEOUT_SEC,                                
    });                                                                                        
                                                                                               
    if (lockErr || !lockAcquired) {                                                            
      addLog(sb, channelId, "cache_stale_locked", mode, 0, Date.now() - t0);                 
      return jsonResp({                                                                        
        live: row?.live ?? [], upcoming: row?.upcoming ?? [],
        cachedAt: row?.cached_at ?? null, source: "cache_stale_locked", mode,                  
      });                                                                                    
    }                                                                                          
                                                                                             
    // ── 5. Fetch from YouTube ───────────────────────────────────────────────────            
    let newLive: StreamItem[] = [];
    let newUpcoming: StreamItem[] = [];                                                        
    let apiUnits = 0;                                                                        
    let source: string;                                                                        
   
    try {                                                                                      
      if (mode === "hot" && hotVideoId) {                                                    
        const video = await fetchVideoById(hotVideoId);
        apiUnits = 2;                                                                          
        source   = "hot";
                                                                                               
        if (!video || video.liveBroadcastContent === "none") {                                 
          // Stream ended — fall back to normal search
          const r = await fetchFromSearch(channelId);                                          
          newLive = r.live; newUpcoming = r.upcoming;                                          
          apiUnits += r.units; source = "normal";
          mode = "normal"; hotVideoId = null; hotScheduledAt = null;                           
        } else if (video.liveBroadcastContent === "live") {                                  
          newLive = [video]; newUpcoming = [];                                                 
        } else {                                                                             
          newLive = []; newUpcoming = [video];                                                 
          hotScheduledAt = video.scheduledStartTime ? new Date(video.scheduledStartTime) :   
  hotScheduledAt;                                                                              
        }                                                                                    
      } else {                                                                                 
        const r = await fetchFromSearch(channelId);                                          
        newLive = r.live; newUpcoming = r.upcoming;
        apiUnits = r.units; source = "normal";
                                                                                               
        const c = detectHotCandidate(newUpcoming, nowMs);
        if (c) { mode = "hot"; hotVideoId = c.videoId; hotScheduledAt = c.scheduledAt; }       
      }                                                                                        
   
      // ── 5b. Push notification for new live streams ──────────────────────────────
      // Compare what was live BEFORE this refresh vs what is live NOW.
      // If a new videoId appears in the live list, push to all registered devices.
      // Deduplication: as long as the cache is valid, the old `row.live` contains
      // the videoId → prevLiveIds.has() returns true → no re-send.
      // Uses Expo Push API which delivers to devices even when the app is killed.
      const prevLiveIds = new Set((row?.live ?? []).map((s: StreamItem) => s.videoId));
      const newLiveFirst = newLive[0];
      if (newLiveFirst && !prevLiveIds.has(newLiveFirst.videoId)) {
        // New live stream — fire-and-forget, never let push failure block cache update
        sendLivePushToAll(sb, newLiveFirst.videoId, newLiveFirst.title).catch((e) => {
          console.warn("[Push] sendLivePushToAll failed:", e);
        });
      }

      // ── 6. Persist cache ──────────────────────────────────────────────────────
      const cachedAt = new Date().toISOString();                                             
      const { error: upsertErr } = await sb.from("yt_stream_cache").upsert({                   
        channel_id:         channelId,                                                         
        live:               newLive,                                                           
        upcoming:           newUpcoming,                                                       
        mode,                                                                                
        cached_at:          cachedAt,                                                          
        hot_video_id:       hotVideoId,
        hot_scheduled_at:   hotScheduledAt?.toISOString() ?? null,                             
        refreshing:         false,                                                           
        refresh_started_at: null,                                                              
      }, { onConflict: "channel_id" });
                                                                                               
      if (upsertErr) throw new Error(`Cache upsert: ${upsertErr.message}`);                    
   
      addLog(sb, channelId, source!, mode, apiUnits, Date.now() - t0);                         
      return jsonResp({ live: newLive, upcoming: newUpcoming, cachedAt, source: source!, mode
  });                                                                                          
   
    } catch (err: unknown) {                                                                   
      const msg = err instanceof Error ? err.message : String(err);                          
      // Always release lock on error
      await sb.from("yt_stream_cache")                                                         
        .update({ refreshing: false, refresh_started_at: null })
        .eq("channel_id", channelId);                                                          
      addLog(sb, channelId, "error", mode, apiUnits, Date.now() - t0, false, msg);           
      // Return stale cache rather than 500 — keeps app functional                             
      return jsonResp({                                                                        
        live: row?.live ?? [], upcoming: row?.upcoming ?? [],                                  
        cachedAt: row?.cached_at ?? null, source: "cache_stale_error", mode, error: msg,       
      });                                                                                    
    }                                                                                          
  });
