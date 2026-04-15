/**
 * Umrah Guide — main screen.
 *
 * - Opens in LIGHT MODE by default, independent of app theme.
 * - User can toggle dark mode; choice persists across visits.
 * - Simplified view toggle hides supplementary content.
 * - Step-based flow with progress, counters, checklists.
 * - Auto-resumes at last active step.
 */

import React, {
  useState, useEffect, useCallback, useRef, memo,
} from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  StatusBar, Share, Switch,
} from 'react-native';
import SvgIcon from '@/components/SvgIcon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { umrahLight, umrahDark, UmrahTheme } from '@/components/umrah/umrahTheme';
import UmrahHeroHeader from '@/components/umrah/UmrahHeroHeader';
import {
  SummaryCard, SpiritualIntroCard, DuaCard, ImportantCard, WarningCard,
  NoteCard, HadithCard, SplitInfoCard, QuranRefCard, CelebrationCard, ReflectionCard,
} from '@/components/umrah/UmrahCards';
import UmrahAccordionCard from '@/components/umrah/UmrahAccordionCard';
import UmrahCounter from '@/components/umrah/UmrahCounter';
import UmrahChecklist from '@/components/umrah/UmrahChecklist';
import UmrahFAQAccordion from '@/components/umrah/UmrahFAQAccordion';

import {
  UMRAH_STEPS, UI_LABELS, getStepIndex,
  UmrahStep, UmrahSection,
  HERO_IMAGE_SOURCES,
} from '@/data/umrahGuideData';

// ── AsyncStorage key ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'andalus_umrah_progress_v1';

// Font scale steps — index 0 is the minimum (current default size)
const FONT_SCALE_STEPS = [1, 1.15, 1.3, 1.45, 1.6] as const;

type PersistedState = {
  stepIndex:       number;
  completedSteps:  string[];
  isGuideDark:     boolean;
  isSimplified:    boolean;
  fontScaleIndex?: number;
  counterValues:  Record<string, number>;
  checklistState: Record<string, boolean[]>;
};

// ── Simplified view — which section types to hide ─────────────────────────────

const SIMPLIFIED_HIDE = new Set([
  'note', 'accordion', 'split_info', 'tips',
  'spiritual_intro', 'quran_reference', 'reflection',
]);

// Non-content steps where simplified mode doesn't apply
const NO_SIMPLIFY_STEPS = new Set(['welcome', 'complete', 'faq']);

// ── StepRenderer ──────────────────────────────────────────────────────────────

type StepRendererProps = {
  T:              UmrahTheme;
  step:           UmrahStep;
  isSimplified:   boolean;
  counterValue:   number;
  checklistState: boolean[];
  onCounterChange: (v: number) => void;
  onChecklistChange: (index: number, value: boolean) => void;
};

const StepRenderer = memo(function StepRenderer({
  T, step, isSimplified, counterValue, checklistState,
  onCounterChange, onChecklistChange,
}: StepRendererProps) {
  const applySimplified = isSimplified && !NO_SIMPLIFY_STEPS.has(step.id);

  function renderSection(section: UmrahSection, i: number) {
    if (applySimplified && SIMPLIFIED_HIDE.has(section.type)) return null;

    switch (section.type) {
      case 'summary':
        return <SummaryCard key={i} T={T} section={section} />;
      case 'spiritual_intro':
        return <SpiritualIntroCard key={i} T={T} section={section} />;
      case 'overview':
        return <SummaryCard key={i} T={T} section={section} />;
      case 'tips':
        return <SummaryCard key={i} T={T} section={section} />;
      case 'list':
        return <SummaryCard key={i} T={T} section={section} />;
      case 'note':
        return <NoteCard key={i} T={T} section={section} />;
      case 'hadith':
        return <HadithCard key={i} T={T} section={section} />;
      case 'split_info':
        return <SplitInfoCard key={i} T={T} section={section} />;
      case 'dua':
        return <DuaCard key={i} T={T} section={section} />;
      case 'accordion':
        return <UmrahAccordionCard key={i} T={T} section={section} />;
      case 'important':
        return <ImportantCard key={i} T={T} section={section} />;
      case 'warning':
        // Always show warnings regardless of simplified mode
        return <WarningCard key={i} T={T} section={section} />;
      case 'quran_reference':
        return <QuranRefCard key={i} T={T} section={section} />;
      case 'faq':
        return <UmrahFAQAccordion key={i} T={T} items={section.items} />;
      case 'celebration':
        return <CelebrationCard key={i} T={T} section={section} />;
      case 'reflection':
        return <ReflectionCard key={i} T={T} section={section} />;
      default:
        return null;
    }
  }

  return (
    <>
      {step.sections.map((section, i) => renderSection(section, i))}

      {/* Counter (Tawaf / Sa'i) */}
      {step.counter && (
        <UmrahCounter
          T={T}
          config={step.counter}
          value={counterValue}
          onChange={onCounterChange}
        />
      )}

      {/* Checklist */}
      {step.checklist && step.checklist.length > 0 && (
        <UmrahChecklist
          T={T}
          items={step.checklist}
          checked={checklistState}
          onChange={onChecklistChange}
        />
      )}
    </>
  );
});

// ── Settings panel ────────────────────────────────────────────────────────────

type SettingsProps = {
  T:                   UmrahTheme;
  isGuideDark:         boolean;
  isSimplified:        boolean;
  fontScaleIndex:      number;
  onToggleDark:        () => void;
  onToggleSimple:      () => void;
  onFontScaleDecrease: () => void;
  onFontScaleIncrease: () => void;
  onClose:             () => void;
  topOffset?:          number;
};

const SettingsPanel = memo(function SettingsPanel({
  T, isGuideDark, isSimplified, fontScaleIndex,
  onToggleDark, onToggleSimple, onFontScaleDecrease, onFontScaleIncrease,
  onClose, topOffset,
}: SettingsProps) {
  const atMin = fontScaleIndex === 0;
  const atMax = fontScaleIndex === FONT_SCALE_STEPS.length - 1;

  return (
    <View style={[
      styles.settingsPanel,
      topOffset != null && { position: 'absolute', top: topOffset + 6, left: 16, right: 16 },
      {
        backgroundColor: T.card,
        borderColor:     T.border,
        shadowColor:     T.shadow,
      },
    ]}>
      {/* Dark mode */}
      <View style={styles.settingsRow}>
        <Text style={[styles.settingsLabel, { color: T.text }]}>
          {UI_LABELS.enableDarkMode}
        </Text>
        <Switch
          value={isGuideDark}
          onValueChange={onToggleDark}
          trackColor={{ false: T.isDark ? 'rgba(255,255,255,0.22)' : '#8E8E93', true: T.accent }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={[styles.settingsDivider, { backgroundColor: T.separator }]} />

      {/* Simplified view */}
      <View style={styles.settingsRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.settingsLabel, { color: T.text }]}>
            {UI_LABELS.enableSimplifiedView}
          </Text>
          <Text style={[styles.settingsHint, { color: T.textMuted }]}>
            Visa bara vad du ska göra och säga
          </Text>
        </View>
        <Switch
          value={isSimplified}
          onValueChange={onToggleSimple}
          trackColor={{ false: T.isDark ? 'rgba(255,255,255,0.22)' : '#8E8E93', true: T.accent }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={[styles.settingsDivider, { backgroundColor: T.separator }]} />

      {/* Font size */}
      <View style={styles.settingsRow}>
        <Text style={[styles.settingsLabel, { color: T.text }]}>Textstorlek</Text>
        <View style={styles.fontSizeRow}>
          {/* Decrease button — small A */}
          <TouchableOpacity
            onPress={onFontScaleDecrease}
            disabled={atMin}
            activeOpacity={0.7}
            style={[styles.fontSizeBtn, { borderColor: T.border, backgroundColor: T.card }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: atMin ? T.textMuted : T.text }}>A</Text>
          </TouchableOpacity>

          {/* Level dots */}
          <View style={styles.fontScaleDots}>
            {FONT_SCALE_STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.fontScaleDot,
                  { backgroundColor: i <= fontScaleIndex ? T.accent : T.border },
                ]}
              />
            ))}
          </View>

          {/* Increase button — large A */}
          <TouchableOpacity
            onPress={onFontScaleIncrease}
            disabled={atMax}
            activeOpacity={0.7}
            style={[styles.fontSizeBtn, { borderColor: T.border, backgroundColor: T.card }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ fontSize: 19, fontWeight: '700', color: atMax ? T.textMuted : T.text }}>A</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function UmrahScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  // ── Local state ─────────────────────────────────────────────────────────────
  const [stepIndex,       setStepIndex]       = useState(0);
  const [completedSteps,  setCompletedSteps]  = useState<string[]>([]);
  const [isGuideDark,     setIsGuideDark]     = useState(false);
  const [isSimplified,    setIsSimplified]    = useState(false);
  const [fontScaleIndex,  setFontScaleIndex]  = useState(0);
  const [counterValues,   setCounterValues]   = useState<Record<string, number>>({});
  const [checklistState,  setChecklistState]  = useState<Record<string, boolean[]>>({});
  const [showSettings,    setShowSettings]    = useState(false);
  const [loaded,          setLoaded]          = useState(false);

  const scrollRef    = useRef<ScrollView>(null);
  const [topBarHeight, setTopBarHeight] = useState(0);

  const T: UmrahTheme = { ...(isGuideDark ? umrahDark : umrahLight), fontScale: FONT_SCALE_STEPS[fontScaleIndex] };
  const step          = UMRAH_STEPS[stepIndex];
  const isFirst       = stepIndex === 0;
  const isLast        = stepIndex === UMRAH_STEPS.length - 1;

  // ── Preload all hero images into memory on mount (silent, fire-and-forget) ───
  useEffect(() => {
    const sources = Object.values(HERO_IMAGE_SOURCES).filter((s): s is number => s != null);
    Asset.loadAsync(sources).catch(() => {});
  }, []);

  // ── Load persisted state ────────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try {
          const saved: PersistedState = JSON.parse(raw);
          setStepIndex(saved.stepIndex ?? 0);
          setCompletedSteps(saved.completedSteps ?? []);
          setIsGuideDark(saved.isGuideDark ?? false);
          setIsSimplified(saved.isSimplified ?? false);
          setFontScaleIndex(Math.min(saved.fontScaleIndex ?? 0, FONT_SCALE_STEPS.length - 1));
          setCounterValues(saved.counterValues ?? {});
          setChecklistState(saved.checklistState ?? {});
        } catch { /* corrupt storage — use defaults */ }
      }
      setLoaded(true);
    });
  }, []);

  // ── Persist on every relevant change ───────────────────────────────────────
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const state: PersistedState = {
      stepIndex, completedSteps, isGuideDark, isSimplified,
      fontScaleIndex, counterValues, checklistState,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [stepIndex, completedSteps, isGuideDark, isSimplified, fontScaleIndex, counterValues, checklistState, loaded]);

  // ── Scroll to top on every step change ─────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [stepIndex]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const goToStep = useCallback((targetStepId: string) => {
    const idx = getStepIndex(targetStepId);
    if (idx >= 0) {
      setStepIndex(idx);
      setShowSettings(false);
    }
  }, []);

  const handleNext = useCallback(() => {
    if (stepIndex < UMRAH_STEPS.length - 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStepIndex(i => i + 1);
    }
  }, [stepIndex]);

  const handlePrev = useCallback(() => {
    if (stepIndex > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStepIndex(i => i - 1);
    }
  }, [stepIndex]);

  const handleMarkComplete = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const id = step.id;
    if (!completedSteps.includes(id)) {
      setCompletedSteps(prev => [...prev, id]);
    }
    if (stepIndex < UMRAH_STEPS.length - 1) {
      setStepIndex(i => i + 1);
    }
  }, [step.id, completedSteps, stepIndex]);

  const handlePrimaryAction = useCallback(() => {
    if (!step.primaryAction) return;
    const { action, targetStepId } = step.primaryAction;
    if (action === 'go_to_step' && targetStepId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      goToStep(targetStepId);
    }
  }, [step, goToStep]);

  const handleStepAction = useCallback((action: string) => {
    if (action === 'restart_guide') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setStepIndex(0);
      setCompletedSteps([]);
      setCounterValues({});
      setChecklistState({});
    } else if (action === 'share') {
      Share.share({
        message: 'Umrah Guide — Steg för steg genom din Umrah. Andalus App.',
      });
    }
  }, []);

  // ── Counter handlers ────────────────────────────────────────────────────────
  const handleCounterChange = useCallback((newValue: number) => {
    setCounterValues(prev => ({ ...prev, [step.id]: newValue }));
  }, [step.id]);

  // ── Checklist handlers ──────────────────────────────────────────────────────
  const handleChecklistChange = useCallback((index: number, value: boolean) => {
    setChecklistState(prev => {
      const current = prev[step.id] ?? Array(step.checklist?.length ?? 0).fill(false);
      const next    = [...current];
      next[index]   = value;
      return { ...prev, [step.id]: next };
    });
  }, [step.id, step.checklist]);

  // ── Settings toggles ────────────────────────────────────────────────────────
  const handleToggleDark = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsGuideDark(v => !v);
  }, []);

  const handleToggleSimple = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSimplified(v => !v);
  }, []);

  const handleFontScaleDecrease = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFontScaleIndex(i => Math.max(0, i - 1));
  }, []);

  const handleFontScaleIncrease = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFontScaleIndex(i => Math.min(FONT_SCALE_STEPS.length - 1, i + 1));
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────────
  const counterValue    = counterValues[step.id]    ?? step.counter?.startValue ?? 1;
  const stepChecklist   = checklistState[step.id]   ?? Array(step.checklist?.length ?? 0).fill(false);
  const isCompleted = completedSteps.includes(step.id);

  // Progress bar width percentage
  const progressPct = ((stepIndex) / (UMRAH_STEPS.length - 1)) * 100;

  if (!loaded) return null;

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      <StatusBar
        barStyle={isGuideDark ? 'light-content' : 'dark-content'}
        backgroundColor={T.bg}
      />

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <View
        onLayout={e => setTopBarHeight(e.nativeEvent.layout.height)}
        style={[
          styles.topBar,
          {
            paddingTop:      insets.top + 8,
            backgroundColor: T.bg,
            borderBottomColor: T.separator,
          },
        ]}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={[styles.iconBtn, { borderColor: T.border, backgroundColor: T.card }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.backChevron, { color: T.text }]}>‹</Text>
        </TouchableOpacity>

        <View style={styles.topCenter}>
          <Text style={[styles.topTitle, { color: T.text }]} numberOfLines={1}>
            Umrah Guide
          </Text>
          {!isFirst && (
            <Text style={[styles.topSubtitle, { color: T.textMuted }]}>
              Steg {step.stepNumber} av {step.totalSteps}
            </Text>
          )}
        </View>

        <TouchableOpacity
          onPress={() => setShowSettings(v => !v)}
          activeOpacity={0.7}
          style={[
            styles.iconBtn,
            {
              borderColor:     showSettings ? T.accent : T.border,
              backgroundColor: showSettings ? T.accentSoft : T.card,
            },
          ]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <SvgIcon name="settings" size={18} color={showSettings ? T.accent : T.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ── Progress bar ────────────────────────────────────────────────────── */}
      {!isFirst && (
        <View style={[styles.progressTrack, { backgroundColor: T.progressTrack }]}>
          <View style={[
            styles.progressFill,
            {
              backgroundColor: T.progressFill,
              width:           `${progressPct}%`,
            },
          ]} />
        </View>
      )}

      {/* ── Step content ────────────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <UmrahHeroHeader
          T={T}
          heroKey={step.heroImageKey}
          title={step.title}
          subtitle={step.subtitle}
          stepNumber={step.stepNumber}
          totalSteps={step.totalSteps}
          showProgress={step.showProgress}
          isWelcome={isFirst}
        />

        {/* Section cards */}
        <View style={styles.sectionsContainer}>
          <StepRenderer
            T={T}
            step={step}
            isSimplified={isSimplified}
            counterValue={counterValue}
            checklistState={stepChecklist}
            onCounterChange={handleCounterChange}
            onChecklistChange={handleChecklistChange}
          />
        </View>

        {/* Welcome CTA */}
        {isFirst && (
          <View style={styles.welcomeActions}>
            <TouchableOpacity
              onPress={handlePrimaryAction}
              activeOpacity={0.7}
              style={[styles.startBtn, { backgroundColor: T.accent }]}
            >
              <Text style={[styles.startBtnText, { color: '#FFFFFF' }]}>
                {UI_LABELS.startGuide}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Complete step actions */}
        {step.actions && (
          <View style={styles.completeActions}>
            {step.actions.map((action, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => handleStepAction(action.action)}
                activeOpacity={0.7}
                style={[
                  styles.completeActionBtn,
                  {
                    backgroundColor: i === 0 ? T.accent : T.card,
                    borderColor:     T.border,
                  },
                ]}
              >
                <Text style={[
                  styles.completeActionText,
                  { color: i === 0 ? '#FFFFFF' : T.text },
                ]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Primary action (e.g. "Min Umrah är klar") */}
        {step.primaryAction && !isFirst && (
          <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
            <TouchableOpacity
              onPress={handlePrimaryAction}
              activeOpacity={0.7}
              style={[styles.primaryActionBtn, { backgroundColor: T.accent }]}
            >
              <Text style={styles.primaryActionText}>
                {step.primaryAction.label}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* ── Bottom navigation ───────────────────────────────────────────────── */}
      {!isFirst && (
        <View style={[
          styles.bottomNav,
          {
            backgroundColor: T.bg,
            borderTopColor:  T.separator,
            paddingBottom:   insets.bottom + 8,
          },
        ]}>
          {/* Previous */}
          <TouchableOpacity
            onPress={handlePrev}
            activeOpacity={0.7}
            style={[
              styles.navBtn,
              {
                borderColor: T.border,
                backgroundColor: T.card,
              },
            ]}
          >
            <Text style={[styles.navBtnText, { color: T.text }]}>
              ‹ {UI_LABELS.previousStep}
            </Text>
          </TouchableOpacity>

          {/* Mark complete / Next */}
          {!isLast ? (
            <View style={styles.navRight}>
              <TouchableOpacity
                onPress={handleMarkComplete}
                activeOpacity={0.7}
                style={[
                  styles.completeBtn,
                  {
                    backgroundColor: isCompleted ? T.importantBg : T.accentSoft,
                    borderColor:     isCompleted ? T.importantBorder : T.accentBorder,
                  },
                ]}
              >
                <Text style={[
                  styles.completeBtnText,
                  { color: isCompleted ? T.important : T.accent },
                ]}>
                  {isCompleted ? '✓ Klar' : UI_LABELS.markComplete}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleNext}
                activeOpacity={0.7}
                style={[styles.nextBtn, { backgroundColor: T.accent }]}
              >
                <Text style={[styles.nextBtnText, { color: '#FFFFFF' }]}>
                  {step.nextButtonLabel ?? UI_LABELS.nextStep} ›
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => handleStepAction('restart_guide')}
              activeOpacity={0.7}
              style={[styles.nextBtn, { backgroundColor: T.accent }]}
            >
              <Text style={[styles.nextBtnText, { color: '#FFFFFF' }]}>
                {UI_LABELS.restartGuide}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Settings panel (floating overlay) ─────────────────────────────── */}
      {showSettings && topBarHeight > 0 && (
        <>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowSettings(false)}
          />
          <SettingsPanel
            T={T}
            isGuideDark={isGuideDark}
            isSimplified={isSimplified}
            fontScaleIndex={fontScaleIndex}
            onToggleDark={handleToggleDark}
            onToggleSimple={handleToggleSimple}
            onFontScaleDecrease={handleFontScaleDecrease}
            onFontScaleIncrease={handleFontScaleIncrease}
            onClose={() => setShowSettings(false)}
            topOffset={topBarHeight}
          />
        </>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // Top bar
  topBar: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: 16,
    paddingBottom:  10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topCenter: {
    flex:      1,
    alignItems: 'center',
  },
  topTitle: {
    fontSize:   17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  topSubtitle: {
    fontSize:  12,
    marginTop: 1,
  },
  iconBtn: {
    width:          36,
    height:         36,
    borderRadius:   18,
    alignItems:     'center',
    justifyContent: 'center',
    borderWidth:    0.5,
  },
  backChevron: {
    fontSize:   20,
    lineHeight: 22,
    marginTop:  -1,
  },
  // Settings panel
  settingsPanel: {
    borderRadius:     14,
    borderWidth:      0.5,
    paddingHorizontal: 16,
    shadowOffset:     { width: 0, height: 6 },
    shadowOpacity:    0.18,
    shadowRadius:     16,
    elevation:        8,
    zIndex:           100,
  },
  settingsRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 14,
  },
  settingsLabel: {
    fontSize:   15,
    fontWeight: '500',
    flex:       1,
  },
  settingsHint: {
    fontSize:  13,
    marginTop: 2,
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
  },
  fontSizeRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            10,
  },
  fontSizeBtn: {
    width:          32,
    height:         32,
    borderRadius:   16,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
  },
  fontScaleDots: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  fontScaleDot: {
    width:        7,
    height:       7,
    borderRadius: 4,
  },

  // Progress bar
  progressTrack: {
    height:   3,
    width:    '100%',
    marginTop: 1,
  },
  progressFill: {
    height:       3,
    borderRadius: 2,
  },

  // Sections
  sectionsContainer: {
    paddingHorizontal: 16,
    paddingTop:        16,
  },

  // Welcome CTAs
  welcomeActions: {
    paddingHorizontal: 16,
    paddingTop:        8,
    gap:              10,
  },
  startBtn: {
    height:         54,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
  },
  startBtnText: {
    fontSize:   17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  // Complete step actions
  completeActions: {
    paddingHorizontal: 16,
    paddingTop:        8,
    gap:              10,
  },
  completeActionBtn: {
    height:         50,
    borderRadius:   14,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
  },
  completeActionText: {
    fontSize:   15,
    fontWeight: '600',
  },

  // Primary action button (e.g. "Min Umrah är klar")
  primaryActionBtn: {
    height:         52,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color:      '#FFFFFF',
    fontSize:   16,
    fontWeight: '600',
  },

  // Bottom nav
  bottomNav: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: 16,
    paddingTop:     12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap:            8,
  },
  navBtn: {
    height:         46,
    paddingHorizontal: 16,
    borderRadius:   14,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  navBtnText: {
    fontSize:   14,
    fontWeight: '500',
  },
  navRight: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    justifyContent: 'flex-end',
  },
  completeBtn: {
    height:         46,
    paddingHorizontal: 12,
    borderRadius:   14,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     1,
    minWidth:       0,
  },
  completeBtnText: {
    fontSize:   13,
    fontWeight: '600',
  },
  nextBtn: {
    height:         46,
    paddingHorizontal: 18,
    borderRadius:   14,
    alignItems:     'center',
    justifyContent: 'center',
  },
  nextBtnText: {
    fontSize:   15,
    fontWeight: '600',
  },
});
