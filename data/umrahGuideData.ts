/**
 * Umrah Guide — TypeScript types and typed data export.
 * All content comes from umrahGuideContent.json — do NOT hardcode copy here.
 */

import rawContent from './umrahGuideContent.json';

// ── Section types ─────────────────────────────────────────────────────────────

export type SummarySection = {
  type: 'summary';
  title: string;
  body?: string;
  arabic?: string;
  items?: string[];
};

export type SpiritualIntroSection = {
  type: 'spiritual_intro';
  title: string;
  body: string;
};

export type OverviewSection = {
  type: 'overview';
  title: string;
  items: string[];
};

export type TipsSection = {
  type: 'tips';
  title: string;
  items: string[];
};

export type NoteSection = {
  type: 'note';
  title: string;
  body: string;
};

export type HadithSection = {
  type: 'hadith';
  body: string;
};

export type SplitInfoColumn = {
  label: string;
  items: string[];
};

export type SplitInfoSection = {
  type: 'split_info';
  title: string;
  columns: SplitInfoColumn[];
};

export type DuaSection = {
  type: 'dua';
  title: string;
  arabic: string;
  transliteration: string;
  translation: string;
  audioFile?: string;
  reference?: string;
};

export type AccordionItem = {
  title: string;
  body: string;
  extra?: string;
  arabic?: string;
};

export type AccordionSection = {
  type: 'accordion';
  title: string;
  items: AccordionItem[];
};

export type ImportantSection = {
  type: 'important';
  title: string;
  items: string[];
};

export type WarningSection = {
  type: 'warning';
  title: string;
  items: string[];
};

export type ListSection = {
  type: 'list';
  title: string;
  items: string[];
};

export type QuranReferenceSection = {
  type: 'quran_reference';
  title: string;
  reference: string;
  arabic?: string;
  transliteration: string;
  translation: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export type FaqSection = {
  type: 'faq';
  items: FaqItem[];
};

export type CelebrationSection = {
  type: 'celebration';
  title: string;
  body: string;
};

export type ReflectionSection = {
  type: 'reflection';
  title: string;
  items: string[];
};

export type UmrahSection =
  | SummarySection
  | SpiritualIntroSection
  | OverviewSection
  | TipsSection
  | NoteSection
  | HadithSection
  | SplitInfoSection
  | DuaSection
  | AccordionSection
  | ImportantSection
  | WarningSection
  | ListSection
  | QuranReferenceSection
  | FaqSection
  | CelebrationSection
  | ReflectionSection;

// ── Counter / Checklist / Actions ─────────────────────────────────────────────

export type CounterConfig = {
  type: 'roundCounter' | 'legCounter';
  title: string;
  currentLabelTemplate: string;
  startValue: number;
  minValue: number;
  maxValue: number;
  incrementButtonLabel: string;
  completionMessage: string;
};

export type StepAction = {
  label: string;
  action: string;
  targetStepId?: string;
};

// ── Step ──────────────────────────────────────────────────────────────────────

export type UmrahStep = {
  id: string;
  title: string;
  subtitle: string;
  heroImageKey: string;
  stepNumber: number;
  totalSteps: number;
  showProgress: boolean;
  sections: UmrahSection[];
  counter?: CounterConfig;
  checklist?: string[];
  primaryAction?: StepAction;
  actions?: StepAction[];
  nextButtonLabel?: string;
};

// ── Root document ─────────────────────────────────────────────────────────────

export type UmrahGuideContent = {
  version: string;
  locale: string;
  namespace: string;
  lastUpdated: string;
  uiLabels: Record<string, string>;
  heroImageMap: Record<string, string>;
  steps: UmrahStep[];
};

// ── Typed export ──────────────────────────────────────────────────────────────

export const UMRAH_GUIDE = rawContent as unknown as UmrahGuideContent;
export const UMRAH_STEPS: UmrahStep[] = UMRAH_GUIDE.steps;
export const UI_LABELS = UMRAH_GUIDE.uiLabels;

export function getStepById(id: string): UmrahStep | undefined {
  return UMRAH_STEPS.find(s => s.id === id);
}

export function getStepIndex(id: string): number {
  return UMRAH_STEPS.findIndex(s => s.id === id);
}

// ── Hero image registry ───────────────────────────────────────────────────────

export const HERO_IMAGE_SOURCES: Record<string, number | null> = {
  welcome:          require('@/assets/images/umrah_welcome_hero.jpg'),
  before_you_begin: require('@/assets/images/umrah_before_you_begin_hero.jpg'),
  ihram:            require('@/assets/images/umrah_ihram_hero.jpg'),
  miqat:            require('@/assets/images/umrah_miqat_hero.jpg'),
  tawaf:            require('@/assets/images/umrah_tawaf_hero.jpg'),
  after_tawaf:      require('@/assets/images/umrah_after_tawaf_hero.jpg'),
  sai:              require('@/assets/images/umrah_sai_hero.jpg'),
  halq_taqsir:      require('@/assets/images/umrah_halq_taqsir_hero.jpg'),
  complete:         require('@/assets/images/umrah_complete_hero.jpg'),
  faq:              require('@/assets/images/umrah_faq_header.jpg'),
};

// Per-image display config.
// Illustration images with light gray backgrounds use 'contain' + a matching
// background color so the full illustration is visible without aggressive cropping.
// Photo images use 'cover' which fills the header naturally.
export type HeroImageConfig = {
  fit:     'cover' | 'contain';
  bgColor: string;
  // Vertical pixel offset applied via transform after centering.
  // Negative = shift image up (reveals content below center).
  // Positive = shift image down (reveals content above center).
  offsetY?: number;
};

export const HERO_IMAGE_CONFIG: Record<string, HeroImageConfig> = {
  welcome:          { fit: 'cover',   bgColor: '#1A1410' },
  before_you_begin: { fit: 'cover',   bgColor: '#1E2E40' },
  ihram:            { fit: 'contain', bgColor: '#E6E5E2', offsetY: -20 },
  miqat:            { fit: 'cover',   bgColor: '#3A3020' },
  tawaf:            { fit: 'contain', bgColor: '#E8E8E6' },
  after_tawaf:      { fit: 'cover',   bgColor: '#1A1A1A' },
  sai:              { fit: 'cover',   bgColor: '#D8ECD8' },
  halq_taqsir:      { fit: 'contain', bgColor: '#E8E8E6' },
  complete:         { fit: 'cover',   bgColor: '#1A1A26' },
  faq:              { fit: 'cover',   bgColor: '#C8BFB0' },
};

// ── Dua audio sources ─────────────────────────────────────────────────────────

export const DUA_AUDIO_SOURCES: Record<string, number> = {
  talbiyah: require('@/assets/audio/talbiyah.mp3'),
};

// Fallback hero background colors — shown when no image is available.
export const HERO_BG_COLORS: Record<string, string> = {
  welcome:          '#1A3D36',
  before_you_begin: '#2A3A4A',
  ihram:            '#1A4740',
  miqat:            '#4A3A22',
  tawaf:            '#1E3560',
  after_tawaf:      '#3D2E00',
  sai:              '#1A3D2C',
  halq_taqsir:      '#2E3B4A',
  complete:         '#1A4A3C',
  faq:              '#2C2C3E',
};
