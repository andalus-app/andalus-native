/**
 * dhikrRepository.ts
 *
 * Data layer for the Dhikr & Du'a feature.
 * Source of truth: dhikrData.json (lossless — original hierarchy preserved,
 * wellbeing metadata added as additive layer).
 *
 * Exports:
 *  - Types: DhikrPost, Undersida, Kategori, WellbeingMetadata, FlatSearchEntry, WellbeingMood
 *  - KATEGORIER     — original 26-category hierarchy (never mutated)
 *  - GRUPPER        — 9 UI super-groups (same grouping as original dhikr.tsx)
 *  - ALL_DHIKR      — flat list of all 269 dhikr enriched with wellbeing_metadata
 *  - DHIKR_BY_ID    — Map<wellbeing_id, DhikrPost> for O(1) lookup from search results
 *  - FLAT_SEARCH_INDEX — pre-computed search index from JSON
 *  - WELLBEING_MOODS — 10 mood definitions
 *  - WELLBEING_TAB  — tab metadata
 */

import rawData from './dhikrData.json';

// ── Raw JSON shape ─────────────────────────────────────────────────────────────

type RawWellbeingMeta = {
  id: string;
  mood_tags: string[];
  problem_tags: string[];
  situation_tags: string[];
  intent_tags: string[];
  search_synonyms_sv: string[];
  priority_score: number;
  wellbeing_description?: string;
  source_context: { kategori: string; undersida: string };
};

type RawDelpost = {
  titel: string;
  arabisk_text: string;
  translitteration: string;
  svensk_text: string;
  kallhanvisning: string;
  qcf_page?:      number;
  qcf_glyphs?:    string;
  qcf_bismillah?: boolean;
};

type RawDhikrPost = {
  titel: string;
  url?: string;
  arabisk_text: string;
  translitteration: string;
  svensk_text: string;
  kallhanvisning: string;
  mp3_url: string;
  wellbeing_metadata: RawWellbeingMeta;
  source_integrity?: { original_post_index: number; source_url_present: boolean };
  lases_info?: string;
  hadiths?: { text: string; kalla: string }[];
  delposter?: RawDelpost[];
  presentation_type?: string;
  display_fields_from?: string;
  qcf_page?:      number;
  qcf_glyphs?:    string;
  qcf_bismillah?: boolean;
};

type RawUndersida = {
  titel: string;
  url?: string;
  dhikr_poster: RawDhikrPost[];
  source_integrity?: { original_subpage_index: number };
};

type RawKategori = {
  kategori: string;
  kategori_url?: string;
  undersidor: RawUndersida[];
  source_integrity?: { original_category_index: number };
};

type RawFlatEntry = {
  id: string;
  titel: string;
  kategori: string;
  undersida: string;
  mood_tags: string[];
  problem_tags: string[];
  situation_tags: string[];
  intent_tags: string[];
  search_synonyms_sv: string[];
  priority_score: number;
};

type RawMood = {
  id: string;
  label: string;
  synonyms: string[];
  description: string;
  intent_tags: string[];
  recommended_item_ids?: string[];
  recommended_preview?: Array<{
    id: string;
    titel: string;
    kategori: string;
    undersida: string;
    priority_score: number;
  }>;
};

const data = rawData as unknown as {
  integrity_validation?: {
    original_counts?: { categories: number; subpages: number; posts: number };
    rebuilt_counts?: { categories: number; subpages: number; posts: number };
    counts_match?: boolean;
  };
  kategorier: RawKategori[];
  flat_search_index: RawFlatEntry[];
  wellbeing_moods: RawMood[];
  wellbeing_tab: {
    title: string;
    description: string;
    moods: RawMood[];
  };
};

// ── Public Types ───────────────────────────────────────────────────────────────

export type WellbeingMetadata = {
  id: string;
  mood_tags: string[];
  problem_tags: string[];
  situation_tags: string[];
  intent_tags: string[];
  search_synonyms_sv: string[];
  priority_score: number;
  wellbeing_description?: string;
};

export type Delpost = {
  titel: string;
  arabisk_text: string;
  translitteration: string;
  svensk_text: string;
  kallhanvisning: string;
  qcf_page?:      number;
  qcf_glyphs?:    string;
  qcf_bismillah?: boolean;
};

export type DhikrPost = {
  titel: string;
  url?: string;
  arabisk_text: string;
  translitteration: string;
  svensk_text: string;
  kallhanvisning: string;
  mp3_url: string;
  // Navigation context (injected during build)
  _undersida: string;
  _kategori: string;
  // Wellbeing metadata (from lossless JSON)
  _wellbeing?: WellbeingMetadata;
  // Enriched fields
  lases_info?: string;
  hadiths?: { text: string; kalla: string }[];
  delposter?: Delpost[];
  // QCF V2 Mushaf font rendering (optional — present for Quranic verses)
  qcf_page?:      number;
  qcf_glyphs?:    string;
  qcf_bismillah?: boolean;
};

export type Undersida = {
  titel: string;
  url?: string;
  dhikr_poster: DhikrPost[];
};

export type Kategori = {
  kategori: string;
  kategori_url?: string;
  undersidor: Undersida[];
};

export type GruppUndersida = Undersida & { _kategorinamn: string };

export type Grupp = {
  id: string;
  namn: string;
  emoji: string;
  undersidor: GruppUndersida[];
};

export type FlatSearchEntry = {
  id: string;
  titel: string;
  kategori: string;
  undersida: string;
  mood_tags: string[];
  problem_tags: string[];
  situation_tags: string[];
  intent_tags: string[];
  search_synonyms_sv: string[];
  priority_score: number;
};

export type WellbeingMood = {
  id: string;
  label: string;
  synonyms: string[];
  description: string;
  intent_tags: string[];
  recommended_item_ids: string[];
};

// ── Build original hierarchy with wellbeing metadata injected ──────────────────

export const KATEGORIER: Kategori[] = data.kategorier.map((rawCat) => ({
  kategori: rawCat.kategori,
  kategori_url: rawCat.kategori_url,
  undersidor: rawCat.undersidor.map((rawUs) => ({
    titel: rawUs.titel,
    url: rawUs.url,
    dhikr_poster: rawUs.dhikr_poster.map((rawPost) => {
      const post: DhikrPost = {
        titel: rawPost.titel,
        url: rawPost.url,
        arabisk_text: rawPost.arabisk_text,
        translitteration: rawPost.translitteration,
        svensk_text: rawPost.svensk_text,
        kallhanvisning: rawPost.kallhanvisning,
        mp3_url: rawPost.mp3_url,
        _undersida: rawUs.titel,
        _kategori: rawCat.kategori,
        _wellbeing: rawPost.wellbeing_metadata
          ? {
              id: rawPost.wellbeing_metadata.id,
              mood_tags: rawPost.wellbeing_metadata.mood_tags,
              problem_tags: rawPost.wellbeing_metadata.problem_tags,
              situation_tags: rawPost.wellbeing_metadata.situation_tags,
              intent_tags: rawPost.wellbeing_metadata.intent_tags,
              search_synonyms_sv: rawPost.wellbeing_metadata.search_synonyms_sv,
              priority_score: rawPost.wellbeing_metadata.priority_score,
              wellbeing_description: rawPost.wellbeing_metadata.wellbeing_description,
            }
          : undefined,
        lases_info: rawPost.lases_info,
        hadiths: rawPost.hadiths,
        delposter: rawPost.delposter?.map(dp => ({
          titel:           dp.titel,
          arabisk_text:    dp.arabisk_text,
          translitteration: dp.translitteration,
          svensk_text:     dp.svensk_text,
          kallhanvisning:  dp.kallhanvisning,
          qcf_page:        dp.qcf_page,
          qcf_glyphs:      dp.qcf_glyphs,
          qcf_bismillah:   dp.qcf_bismillah,
        })),
        qcf_page:      rawPost.qcf_page,
        qcf_glyphs:    rawPost.qcf_glyphs,
        qcf_bismillah: rawPost.qcf_bismillah,
      };
      return post;
    }),
  })),
}));

export const ACTUAL_COUNTS = {
  categories: KATEGORIER.length,
  subpages: KATEGORIER.reduce((sum, cat) => sum + cat.undersidor.length, 0),
  posts: KATEGORIER.reduce(
    (sum, cat) => sum + cat.undersidor.reduce((inner, us) => inner + us.dhikr_poster.length, 0),
    0,
  ),
};

export const EXPECTED_COUNTS =
  data.integrity_validation?.rebuilt_counts ??
  data.integrity_validation?.original_counts ??
  ACTUAL_COUNTS;

if (__DEV__) {
  if (
    ACTUAL_COUNTS.categories !== EXPECTED_COUNTS.categories ||
    ACTUAL_COUNTS.posts !== EXPECTED_COUNTS.posts
  ) {
    console.warn(
      `[dhikrRepository] Integrity mismatch: expected ${JSON.stringify(EXPECTED_COUNTS)} got ${JSON.stringify(ACTUAL_COUNTS)}`,
    );
  }
}

// ── Fast lookup map: wellbeing_id → DhikrPost ─────────────────────────────────

export const DHIKR_BY_ID = new Map<string, DhikrPost>();
for (const kat of KATEGORIER) {
  for (const us of kat.undersidor) {
    for (const post of us.dhikr_poster) {
      if (post._wellbeing?.id) {
        DHIKR_BY_ID.set(post._wellbeing.id, post);
      }
    }
  }
}

// ── Flat list of all dhikr ────────────────────────────────────────────────────

export const ALL_DHIKR: DhikrPost[] = KATEGORIER.flatMap((k) =>
  k.undersidor.flatMap((u) => u.dhikr_poster),
);

// ── Category lookup map for mergeCats ─────────────────────────────────────────

const CAT_MAP = new Map<string, Kategori>();
for (const k of KATEGORIER) CAT_MAP.set(k.kategori, k);

function mergeCats(names: string[]): GruppUndersida[] {
  const result: GruppUndersida[] = [];
  for (const name of names) {
    const cat = CAT_MAP.get(name);
    if (!cat) continue;
    for (const us of cat.undersidor) {
      result.push({ ...us, _kategorinamn: name });
    }
  }
  return result;
}

// ── 9 UI super-groups (same grouping as original dhikr.tsx) ───────────────────

export const GRUPPER: Grupp[] = [
  { id: 'morgon',      emoji: '🌅', namn: 'Morgon & Kväll',        undersidor: mergeCats(['Morgon och kväll']) },
  { id: 'bonen',       emoji: '🧎', namn: 'Bönen',                  undersidor: mergeCats(['Bönen', 'Moskén', 'Sittningar', 'Koranen']) },
  { id: 'dagligt',     emoji: '🏠', namn: 'Dagligt liv',            undersidor: mergeCats(['Hemmet', 'Mat och dryck', 'Kläder', 'Toalett', 'Hälsningsrelaterat', 'Nysning', 'Glädje och ilska', 'Djurrelaterat']) },
  { id: 'svarigheter', emoji: '🛡️', namn: 'Svårigheter & Skydd',  undersidor: mergeCats(['Svårigheter och motgångar', 'Skydd', 'Synder och ånger']) },
  { id: 'somn',        emoji: '😴', namn: 'Sömn',                   undersidor: mergeCats(['Sömn']) },
  { id: 'resa',        emoji: '✈️', namn: 'Resa',                   undersidor: mergeCats(['Resa']) },
  { id: 'pilgrim',     emoji: '🕋', namn: 'Pilgrimsfärd',           undersidor: mergeCats(['Pilgrimsfärd']) },
  { id: 'begravning',  emoji: '🕊️', namn: 'Sjukdom & Begravning',  undersidor: mergeCats(['Begravning & dödsrelaterat', 'Vid besök av den sjuke']) },
  { id: 'ovrigt',      emoji: '🤲', namn: 'Familj & Övrigt',       undersidor: mergeCats(['Äktenskap', 'Skulder', 'Övrigt', 'Ramadan och fasta', 'Väder']) },
];

// ── Flat search index ─────────────────────────────────────────────────────────

export const FLAT_SEARCH_INDEX: FlatSearchEntry[] = data.flat_search_index;

// O(1) lookup for enriched search entries
export const FLAT_INDEX_BY_ID = new Map<string, FlatSearchEntry>();
for (const entry of FLAT_SEARCH_INDEX) {
  FLAT_INDEX_BY_ID.set(entry.id, entry);
}

// ── Wellbeing moods ───────────────────────────────────────────────────────────

export const WELLBEING_MOODS: WellbeingMood[] = data.wellbeing_moods.map((m) => ({
  id: m.id,
  label: m.label,
  synonyms: m.synonyms,
  description: m.description,
  intent_tags: m.intent_tags,
  recommended_item_ids: m.recommended_item_ids ?? [],
}));

// ── Wellbeing tab metadata ────────────────────────────────────────────────────

export const WELLBEING_TAB = {
  title: data.wellbeing_tab.title,
  description: data.wellbeing_tab.description,
  moods: data.wellbeing_tab.moods.map((m) => ({
    id: m.id,
    label: m.label,
    synonyms: m.synonyms ?? [],
    description: m.description,
    intent_tags: m.intent_tags,
    recommended_item_ids: m.recommended_item_ids ?? [],
    recommended_preview: m.recommended_preview ?? [],
  })),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export const dhikrKey = (d: DhikrPost): string => d._wellbeing?.id || d.url || d.titel;

export const groupCount = (g: Grupp): number =>
  g.undersidor.reduce((s, us) => s + us.dhikr_poster.length, 0);
