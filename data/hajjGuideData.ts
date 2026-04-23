/**
 * Hajj Guide — TypeScript types and typed data export.
 * Reuses the same section/step types as the Umrah Guide (identical structure).
 * All content comes from hajjGuideContent.json — do NOT hardcode copy here.
 */

import rawContent from './hajjGuideContent.json';

// Re-export the shared section/step types from umrahGuideData so the same
// card components can render both guides without modification.
export type {
  UmrahSection as HajjSection,
  UmrahStep    as HajjStep,
  HeroImageConfig,
  SummarySection,
  SpiritualIntroSection,
  OverviewSection,
  TipsSection,
  NoteSection,
  HadithSection,
  SplitInfoSection,
  DuaSection,
  AccordionSection,
  ImportantSection,
  WarningSection,
  ListSection,
  QuranReferenceSection,
  FaqSection,
  CelebrationSection,
  ReflectionSection,
} from '@/data/umrahGuideData';

import type { UmrahStep, HeroImageConfig } from '@/data/umrahGuideData';

// ── Root document ─────────────────────────────────────────────────────────────

type HajjGuideContent = {
  version:      string;
  locale:       string;
  namespace:    string;
  lastUpdated:  string;
  uiLabels:     Record<string, string>;
  heroImageMap: Record<string, string>;
  steps:        UmrahStep[];
};

// ── Typed export ──────────────────────────────────────────────────────────────

export const HAJJ_GUIDE  = rawContent as unknown as HajjGuideContent;
export const HAJJ_STEPS: UmrahStep[] = HAJJ_GUIDE.steps;
export const HAJJ_UI_LABELS = HAJJ_GUIDE.uiLabels;

export function getHajjStepById(id: string): UmrahStep | undefined {
  return HAJJ_STEPS.find(s => s.id === id);
}

export function getHajjStepIndex(id: string): number {
  return HAJJ_STEPS.findIndex(s => s.id === id);
}

// ── Hero image registry ───────────────────────────────────────────────────────

export const HAJJ_HERO_IMAGE_SOURCES: Record<string, number | null> = {
  welcome:          require('@/assets/images/hajj_welcome_hero.jpg'),
  virtues:          require('@/assets/images/hajj_virtues_hero.jpg'),
  foundations:      require('@/assets/images/hajj_foundations_hero.jpg'),
  transition_umrah: require('@/assets/images/hajj_transition_umrah_hero.jpg'),
  day8_mina:        require('@/assets/images/hajj_day8_mina_hero.jpg'),
  day9_arafah:      require('@/assets/images/hajj_day9_arafah_hero.jpg'),
  day10_eid:        require('@/assets/images/hajj_day10_eid_hero.jpg'),
  tashriq:          require('@/assets/images/hajj_tashriq_hero.jpg'),
  daily_schedule:   require('@/assets/images/hajj_daily_schedule_hero.jpg'),
  common_mistakes:  require('@/assets/images/hajj_common_mistakes_hero.jpg'),
  complete:         require('@/assets/images/hajj_complete_hero.jpg'),
};

export const HAJJ_HERO_IMAGE_CONFIG: Record<string, HeroImageConfig> = {
  welcome:          { fit: 'cover', bgColor: '#1A1410' },
  virtues:          { fit: 'cover', bgColor: '#1A2E20' },
  foundations:      { fit: 'cover', bgColor: '#1E2A1A' },
  transition_umrah: { fit: 'cover', bgColor: '#3A3020' },
  day8_mina:        { fit: 'cover', bgColor: '#1A1A2A' },
  day9_arafah:      { fit: 'cover', bgColor: '#2A2010' },
  day10_eid:        { fit: 'cover', bgColor: '#1A1A1A' },
  tashriq:          { fit: 'cover', bgColor: '#1A2820' },
  daily_schedule:   { fit: 'cover', bgColor: '#1A2030' },
  common_mistakes:  { fit: 'cover', bgColor: '#2A1A1A' },
  complete:         { fit: 'cover', bgColor: '#1A4A3C' },
};

export const HAJJ_HERO_BG_COLORS: Record<string, string> = {
  welcome:          '#1A3D36',
  virtues:          '#1A3D28',
  foundations:      '#223A1A',
  transition_umrah: '#4A3A22',
  day8_mina:        '#22223A',
  day9_arafah:      '#3A2E1A',
  day10_eid:        '#3A1A1A',
  tashriq:          '#1A3A2A',
  daily_schedule:   '#1A2A3A',
  common_mistakes:  '#3A1A1A',
  complete:         '#1A4A3C',
};
