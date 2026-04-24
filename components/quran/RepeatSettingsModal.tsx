/**
 * RepeatSettingsModal.tsx
 *
 * Bottom sheet modal for configuring audio repeat behavior.
 * Allows setting a verse interval (Från → Till) and toggling
 * interval repeat or single verse repeat (mutually exclusive).
 *
 * Swedish UI:
 *   Title: "Repetitionsinställningar"
 *   Sections: "Intervall" (Från, Till), "Repetition" (Upprepa intervall, Upprepa vers)
 */

import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Modal,
  StyleSheet,
  Switch,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { SURAH_INDEX, type SurahInfo } from '../../data/surahIndex';
import { fetchSurahVerseList, type SurahVerseEntry } from '../../services/mushafApi';
import { loadQCFPageFont, qcfPagePsName } from '../../services/mushafFontManager';

// ── Types ────────────────────────────────────────────────────────────────────

export type RepeatSettings = {
  fromSurahId: number;
  fromVerse: number;
  toSurahId: number;
  toVerse: number;
  repeatInterval: boolean;
  repeatVerse: boolean;
  /** null = infinite loops; number = play N times total (1 = play once, no repeat) */
  repeatCount: number | null;
  /** null = repeat each verse forever; number = play each verse N times then advance */
  repeatVerseCount: number | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  settings: RepeatSettings;
  onUpdate: (settings: RepeatSettings) => void;
  currentSurahId: number;
};

// ── Verse Picker Sub-component ──────────────────────────────────────────────

type PickerTarget = 'from' | 'to' | null;

const SURAH_ROW_H = 65;
const VERSE_ROW_H = 62;
const ARABIC_FS    = 18;

type VerseLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; verses: SurahVerseEntry[] }
  | { status: 'error' };

function VersePicker({
  surahId,
  verse,
  onSelectSurah,
  onSelectVerse,
  onClose,
  currentSurahId,
  theme: T,
  isDark,
}: {
  surahId: number;
  verse: number;
  onSelectSurah: (id: number) => void;
  onSelectVerse: (v: number) => void;
  onClose: () => void;
  currentSurahId: number;
  theme: ReturnType<typeof useTheme>['theme'];
  isDark: boolean;
}) {
  const { width: screenW } = useWindowDimensions();
  const [step, setStep] = useState<'surah' | 'verse'>('surah');
  const selectedSurah = SURAH_INDEX.find((s) => s.id === surahId) ?? SURAH_INDEX[0];

  // ── Surah list ──────────────────────────────────────────────────────────────

  const surahListRef = useRef<FlatList<SurahInfo>>(null);

  // Auto-scroll to currentSurahId when surah step is shown.
  useEffect(() => {
    if (step !== 'surah') return;
    const idx = SURAH_INDEX.findIndex((s) => s.id === currentSurahId);
    if (idx < 0) return;
    const t = setTimeout(() => {
      surahListRef.current?.scrollToIndex({
        index: idx,
        animated: false,
        viewPosition: 0.3,
      });
    }, 80);
    return () => clearTimeout(t);
  }, [step, currentSurahId]);

  // ── Verse list with QCF Arabic ──────────────────────────────────────────────

  const [verseLoad, setVerseLoad] = useState<VerseLoadState>({ status: 'idle' });
  const abortRef   = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Reset verse load when going back to surah step.
  useEffect(() => {
    if (step === 'surah') {
      abortRef.current?.abort();
      setVerseLoad({ status: 'idle' });
    }
  }, [step]);

  // Fetch verse list + pre-load QCF fonts when verse step opens.
  useEffect(() => {
    if (step !== 'verse') return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setVerseLoad({ status: 'loading' });

    fetchSurahVerseList(selectedSurah.id, ctrl.signal)
      .then(async (verses) => {
        if (!mountedRef.current || ctrl.signal.aborted) return;
        const pages = [...new Set(verses.map((v) => v.pageNumber).filter((p) => p > 0))];
        await Promise.allSettled(pages.map((p) => loadQCFPageFont(p)));
        if (!mountedRef.current || ctrl.signal.aborted) return;
        setVerseLoad({ status: 'ready', verses });
      })
      .catch(() => {
        if (!mountedRef.current || ctrl.signal.aborted) return;
        setVerseLoad({ status: 'error' });
      });
  }, [step, selectedSurah.id]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSurahSelect = useCallback(
    (s: SurahInfo) => {
      onSelectSurah(s.id);
      setStep('verse');
    },
    [onSelectSurah],
  );

  const handleVerseSelect = useCallback(
    (v: number) => {
      onSelectVerse(v);
      onClose();
    },
    [onSelectVerse, onClose],
  );

  // ── Surah list render helpers ────────────────────────────────────────────────

  const surahGetItemLayout = useCallback(
    (_: ArrayLike<SurahInfo> | null | undefined, idx: number) => ({
      length: SURAH_ROW_H, offset: SURAH_ROW_H * idx, index: idx,
    }),
    [],
  );

  const renderSurahItem = useCallback(
    ({ item: s }: ListRenderItemInfo<SurahInfo>) => (
      <TouchableOpacity
        style={[
          pickerStyles.pickerRow,
          s.id === surahId && { backgroundColor: T.accentGlow },
          { borderBottomColor: T.separator },
        ]}
        onPress={() => handleSurahSelect(s)}
        activeOpacity={0.7}
      >
        <View style={pickerStyles.surahNum}>
          <Text style={[pickerStyles.surahNumText, { color: T.textMuted }]}>{s.id}</Text>
        </View>
        <View style={pickerStyles.surahInfo}>
          <Text style={[pickerStyles.surahName, { color: T.text }]}>{s.nameSimple}</Text>
          <Text style={[pickerStyles.surahArabic, { color: T.textMuted }]}>{s.nameArabic}</Text>
        </View>
        <Text style={[pickerStyles.verseCount, { color: T.textMuted }]}>{s.versesCount} verser</Text>
      </TouchableOpacity>
    ),
    [surahId, T, handleSurahSelect],
  );

  const surahKeyExtractor = useCallback((s: SurahInfo) => String(s.id), []);

  // ── Verse list render helpers ────────────────────────────────────────────────

  // Arabic layout: modal (screenW-40) minus row padding + pill + gaps + checkmark slot
  const arabicAreaW = Math.max(80, screenW - 40 - 16 - 34 - 8 - 8 - 22 - 16);
  const arabicLineH = Math.round(ARABIC_FS * 1.9);
  const svgH        = arabicLineH + 8;
  const baselineY   = Math.round(arabicLineH - arabicLineH * 0.15);
  const arabicColor = isDark ? '#FFFEF0' : '#1A1106';

  const verseGetItemLayout = useCallback(
    (_: ArrayLike<SurahVerseEntry> | null | undefined, idx: number) => ({
      length: VERSE_ROW_H, offset: VERSE_ROW_H * idx, index: idx,
    }),
    [],
  );

  const renderVerseItem = useCallback(
    ({ item: v }: ListRenderItemInfo<SurahVerseEntry>) => {
      const isSelected = v.verseNumber === verse;
      return (
        <TouchableOpacity
          style={[pickerStyles.verseRow, { borderBottomColor: T.separator }]}
          onPress={() => handleVerseSelect(v.verseNumber)}
          activeOpacity={0.7}
        >
          {/* Verse number pill */}
          <View style={[pickerStyles.versePill, {
            backgroundColor: isSelected
              ? T.accent
              : isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)',
          }]}>
            <Text style={[pickerStyles.versePillText, { color: isSelected ? '#fff' : T.textMuted }]}>
              {v.verseNumber}
            </Text>
          </View>

          {/* QCF Arabic text */}
          <View style={[pickerStyles.verseArabicArea, { width: arabicAreaW }]}>
            {v.firstLineGlyph ? (
              <Svg width={arabicAreaW} height={svgH} {...{ overflow: 'visible' } as object}>
                <SvgText
                  x={arabicAreaW}
                  y={baselineY}
                  fontFamily={qcfPagePsName(v.pageNumber)}
                  fontSize={ARABIC_FS}
                  textAnchor="end"
                  fill={arabicColor}
                >
                  {v.firstLineGlyph}
                </SvgText>
              </Svg>
            ) : null}
          </View>

          {/* Checkmark */}
          {isSelected && (
            <View style={[pickerStyles.checkmark, { backgroundColor: T.accent }]}>
              <Text style={pickerStyles.checkmarkText}>✓</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [verse, T, isDark, arabicAreaW, svgH, baselineY, arabicColor, handleVerseSelect],
  );

  const verseKeyExtractor = useCallback((v: SurahVerseEntry) => v.verseKey, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (step === 'surah') {
    return (
      <View style={pickerStyles.container}>
        <View style={pickerStyles.pickerHeader}>
          <Text style={[pickerStyles.pickerTitle, { color: T.text }]}>Välj surah</Text>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={[pickerStyles.cancelText, { color: T.accent }]}>Avbryt</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          ref={surahListRef}
          data={SURAH_INDEX}
          renderItem={renderSurahItem}
          keyExtractor={surahKeyExtractor}
          getItemLayout={surahGetItemLayout}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={({ index }) => {
            surahListRef.current?.scrollToOffset({ offset: index * SURAH_ROW_H, animated: false });
          }}
        />
      </View>
    );
  }

  // Verse step
  return (
    <View style={pickerStyles.container}>
      <View style={pickerStyles.pickerHeader}>
        <TouchableOpacity onPress={() => setStep('surah')} activeOpacity={0.7}>
          <SvgIcon name="chevron-left" size={20} color={T.accent} />
        </TouchableOpacity>
        <Text style={[pickerStyles.pickerTitle, { color: T.text }]}>
          {selectedSurah.nameSimple}
        </Text>
        <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
          <Text style={[pickerStyles.cancelText, { color: T.accent }]}>Klar</Text>
        </TouchableOpacity>
      </View>

      {(verseLoad.status === 'loading' || verseLoad.status === 'idle') && (
        <View style={pickerStyles.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      )}

      {verseLoad.status === 'error' && (
        <View style={pickerStyles.center}>
          <Text style={[pickerStyles.errorText, { color: T.textMuted }]}>
            Kunde inte ladda verser
          </Text>
        </View>
      )}

      {verseLoad.status === 'ready' && (
        <FlatList
          data={verseLoad.verses}
          renderItem={renderVerseItem}
          keyExtractor={verseKeyExtractor}
          getItemLayout={verseGetItemLayout}
          showsVerticalScrollIndicator={false}
          initialScrollIndex={Math.max(0, verse - 1)}
          onScrollToIndexFailed={({ index }) => {
            // no-op fallback — list will render at top
          }}
        />
      )}
    </View>
  );
}

// ── Repeat Count Stepper ────────────────────────────────────────────────────

const MAX_COUNT = 30;

function RepeatCountStepper({
  count,
  onChange,
  theme: T,
  isDark,
}: {
  count: number | null;
  onChange: (count: number | null) => void;
  theme: ReturnType<typeof useTheme>['theme'];
  isDark: boolean;
}) {
  const isInfinite = count === null;
  // The numeric value displayed in the count box — always a number.
  const displayCount = isInfinite ? 1 : count;

  const handleMinus = useCallback(() => {
    // Field shows 1 when infinite — can't go lower, no-op.
    if (isInfinite) return;
    if (count > 1) onChange(count - 1);
    // at 1: no-op
  }, [isInfinite, count, onChange]);

  const handlePlus = useCallback(() => {
    if (isInfinite) {
      // Field shows 1 — pressing + deactivates ∞ and moves to 2.
      onChange(2);
    } else if (count >= MAX_COUNT) {
      // 30 → ∞
      onChange(null);
    } else {
      onChange(count + 1);
    }
  }, [isInfinite, count, onChange]);

  const handleInfinity = useCallback(() => {
    onChange(null);
  }, [onChange]);

  // − is disabled when showing 1 (both infinite mode and numeric 1).
  const minusDisabled = isInfinite || count === 1;
  const plusDisabled = false;

  return (
    <View style={[
      stepperStyles.container,
      { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderColor: T.border },
    ]}>
      {/* ∞ pill button */}
      <TouchableOpacity
        style={[
          stepperStyles.infinityBtn,
          {
            backgroundColor: isInfinite ? T.accent : 'transparent',
            borderColor: isInfinite ? T.accent : T.border,
          },
        ]}
        onPress={handleInfinity}
        activeOpacity={0.7}
      >
        <Text style={[stepperStyles.infinitySymbol, { color: isInfinite ? '#fff' : T.textMuted }]}>
          ∞
        </Text>
      </TouchableOpacity>

      {/* Stepper: − count + */}
      <View style={stepperStyles.stepper}>
        <TouchableOpacity
          style={[
            stepperStyles.stepBtn,
            { borderColor: T.border, opacity: minusDisabled ? 0.3 : 1 },
          ]}
          onPress={handleMinus}
          activeOpacity={minusDisabled ? 1 : 0.7}
          disabled={minusDisabled}
        >
          <Text style={[stepperStyles.stepBtnText, { color: T.text }]}>−</Text>
        </TouchableOpacity>

        <View style={stepperStyles.countBox}>
          <Text style={[stepperStyles.countText, { color: T.text }]}>
            {displayCount}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            stepperStyles.stepBtn,
            { borderColor: T.border, opacity: plusDisabled ? 0.3 : 1 },
          ]}
          onPress={handlePlus}
          activeOpacity={plusDisabled ? 1 : 0.7}
          disabled={plusDisabled}
        >
          <Text style={[stepperStyles.stepBtnText, { color: T.text }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main Modal Component ────────────────────────────────────────────────────

function RepeatSettingsModal({ visible, onClose, settings, onUpdate, currentSurahId }: Props) {
  const { theme: T, isDark } = useTheme();
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

  // Format verse label: "Surah Name: verse"
  const formatVerseLabel = useCallback((surahId: number, verse: number): string => {
    const surah = SURAH_INDEX.find((s) => s.id === surahId);
    if (!surah) return `${surahId}:${verse}`;
    return `${surah.nameSimple}: ${verse}`;
  }, []);

  const handleToggleRepeatInterval = useCallback(
    (value: boolean) => {
      onUpdate({
        ...settings,
        repeatInterval: value,
        repeatVerse: value ? false : settings.repeatVerse,
        // Reset count to ∞ when enabling for the first time
        repeatCount: value ? settings.repeatCount : settings.repeatCount,
      });
    },
    [settings, onUpdate],
  );

  const handleToggleRepeatVerse = useCallback(
    (value: boolean) => {
      onUpdate({
        ...settings,
        repeatVerse: value,
        repeatInterval: value ? false : settings.repeatInterval,
      });
    },
    [settings, onUpdate],
  );

  const handleRepeatCountChange = useCallback(
    (count: number | null) => {
      onUpdate({ ...settings, repeatCount: count });
    },
    [settings, onUpdate],
  );

  const handleRepeatVerseCountChange = useCallback(
    (count: number | null) => {
      onUpdate({ ...settings, repeatVerseCount: count });
    },
    [settings, onUpdate],
  );

  const handleFromSurah = useCallback(
    (id: number) => onUpdate({ ...settings, fromSurahId: id, fromVerse: 1 }),
    [settings, onUpdate],
  );

  const handleFromVerse = useCallback(
    (v: number) => onUpdate({ ...settings, fromVerse: v }),
    [settings, onUpdate],
  );

  const handleToSurah = useCallback(
    (id: number) => onUpdate({ ...settings, toSurahId: id, toVerse: 1 }),
    [settings, onUpdate],
  );

  const handleToVerse = useCallback(
    (v: number) => {
      onUpdate({ ...settings, toVerse: v });
    },
    [settings, onUpdate],
  );

  const fromLabel = formatVerseLabel(settings.fromSurahId, settings.fromVerse);
  const toLabel = formatVerseLabel(settings.toSurahId, settings.toVerse);

  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={modalStyles.centeredWrapper}>
        {/* Backdrop — sits behind the card, closes on tap */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />

        {/* Centered card — NOT a child of the backdrop TouchableOpacity */}
        <View style={[modalStyles.card, { backgroundColor: cardBg }]}>
          {/* Handle */}
          <View style={modalStyles.handleWrapper}>
            <View style={[modalStyles.handle, { backgroundColor: T.textMuted }]} />
          </View>

          {pickerTarget !== null ? (
            /* Verse picker view */
            <VersePicker
              surahId={pickerTarget === 'from' ? settings.fromSurahId : settings.toSurahId}
              verse={pickerTarget === 'from' ? settings.fromVerse : settings.toVerse}
              onSelectSurah={pickerTarget === 'from' ? handleFromSurah : handleToSurah}
              onSelectVerse={pickerTarget === 'from' ? handleFromVerse : handleToVerse}
              onClose={() => setPickerTarget(null)}
              currentSurahId={currentSurahId}
              theme={T}
              isDark={isDark}
            />
          ) : (
            /* Main settings view */
            <>
              {/* Header */}
              <View style={modalStyles.header}>
                <Text style={[modalStyles.title, { color: T.text }]}>
                  Repetitionsinställningar
                </Text>
                <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
                  <Text style={[modalStyles.doneText, { color: T.accent }]}>Klar</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={modalStyles.scrollContent}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
              >
                {/* Interval Section */}
                <Text style={[modalStyles.sectionTitle, { color: T.textMuted }]}>
                  INTERVALL
                </Text>
                <View
                  style={[
                    modalStyles.groupedSection,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)', borderColor: T.border },
                  ]}
                >
                  {/* Från */}
                  <TouchableOpacity
                    style={[modalStyles.row, { borderBottomColor: T.separator }]}
                    onPress={() => setPickerTarget('from')}
                    activeOpacity={0.7}
                  >
                    <Text style={[modalStyles.rowLabel, { color: T.text }]}>Från</Text>
                    <View style={modalStyles.rowValueWrap}>
                      <Text style={[modalStyles.rowValue, { color: T.text }]}>{fromLabel}</Text>
                      <SvgIcon name="chevron-right" size={14} color={T.accent} />
                    </View>
                  </TouchableOpacity>

                  {/* Till */}
                  <TouchableOpacity
                    style={modalStyles.row}
                    onPress={() => setPickerTarget('to')}
                    activeOpacity={0.7}
                  >
                    <Text style={[modalStyles.rowLabel, { color: T.text }]}>Till</Text>
                    <View style={modalStyles.rowValueWrap}>
                      <Text style={[modalStyles.rowValue, { color: T.text }]}>{toLabel}</Text>
                      <SvgIcon name="chevron-right" size={14} color={T.accent} />
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Repetition Section */}
                <Text style={[modalStyles.sectionTitle, { color: T.textMuted }]}>
                  REPETITION
                </Text>
                <View
                  style={[
                    modalStyles.groupedSection,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)', borderColor: T.border },
                  ]}
                >
                  {/* Upprepa intervall */}
                  <View style={[
                    modalStyles.toggleRow,
                    settings.repeatInterval
                      ? { borderBottomColor: T.separator, borderBottomWidth: StyleSheet.hairlineWidth }
                      : { borderBottomColor: T.separator, borderBottomWidth: StyleSheet.hairlineWidth },
                  ]}>
                    <Text style={[modalStyles.rowLabel, { color: T.text }]}>Upprepa intervall</Text>
                    <Switch
                      value={settings.repeatInterval}
                      onValueChange={handleToggleRepeatInterval}
                      trackColor={{ false: isDark ? '#3A3A3C' : '#E5E5EA', true: T.accent }}
                      thumbColor="#fff"
                      ios_backgroundColor={isDark ? '#3A3A3C' : '#E5E5EA'}
                    />
                  </View>

                  {/* Repeat count stepper — shown only when interval is on */}
                  {settings.repeatInterval && (
                    <View style={[modalStyles.stepperRow, { borderBottomColor: T.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                      <Text style={[modalStyles.rowLabel, { color: T.textMuted, fontSize: 13 }]}>
                        Antal upprepningar
                      </Text>
                      <RepeatCountStepper
                        count={settings.repeatCount}
                        onChange={handleRepeatCountChange}
                        theme={T}
                        isDark={isDark}
                      />
                    </View>
                  )}

                  {/* Upprepa vers */}
                  <View style={[
                    modalStyles.toggleRow,
                    settings.repeatVerse
                      ? { borderBottomColor: T.separator, borderBottomWidth: StyleSheet.hairlineWidth }
                      : undefined,
                  ]}>
                    <Text style={[modalStyles.rowLabel, { color: T.text }]}>Upprepa vers</Text>
                    <Switch
                      value={settings.repeatVerse}
                      onValueChange={handleToggleRepeatVerse}
                      trackColor={{ false: isDark ? '#3A3A3C' : '#E5E5EA', true: T.accent }}
                      thumbColor="#fff"
                      ios_backgroundColor={isDark ? '#3A3A3C' : '#E5E5EA'}
                    />
                  </View>

                  {/* Verse repeat count stepper — shown only when verse repeat is on */}
                  {settings.repeatVerse && (
                    <View style={modalStyles.stepperRow}>
                      <Text style={[modalStyles.rowLabel, { color: T.textMuted, fontSize: 13 }]}>
                        Antal upprepningar per vers
                      </Text>
                      <RepeatCountStepper
                        count={settings.repeatVerseCount}
                        onChange={handleRepeatVerseCountChange}
                        theme={T}
                        isDark={isDark}
                      />
                    </View>
                  )}
                </View>

                {/* Explanatory text */}
                <Text style={[modalStyles.footnote, { color: T.textMuted }]}>
                  {settings.repeatVerse
                    ? settings.repeatVerseCount === null
                      ? 'Varje vers upprepas oändligt tills du stoppar.'
                      : `Varje vers spelas ${settings.repeatVerseCount} ${settings.repeatVerseCount === 1 ? 'gång' : 'gånger'} innan nästa.`
                    : settings.repeatInterval
                    ? settings.repeatCount === null
                      ? `Uppspelningen loopar från ${fromLabel} till ${toLabel} oändligt.`
                      : `Uppspelningen loopar från ${fromLabel} till ${toLabel} ${settings.repeatCount} ${settings.repeatCount === 1 ? 'gång' : 'gånger'}.`
                    : 'Aktivera en repetitionsläge ovan.'}
                </Text>
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Stepper Styles ──────────────────────────────────────────────────────────

const stepperStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
  },
  infinityBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infinitySymbol: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 22,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 24,
    marginTop: -1,
  },
  countBox: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

// ── Picker Styles ───────────────────────────────────────────────────────────

const pickerStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  // Surah list row
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: SURAH_ROW_H,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  surahNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  surahNumText: {
    fontSize: 13,
    fontWeight: '600',
  },
  surahInfo: {
    flex: 1,
  },
  surahName: {
    fontSize: 14,
    fontWeight: '600',
  },
  surahArabic: {
    fontSize: 13,
    marginTop: 2,
  },
  verseCount: {
    fontSize: 12,
  },
  // Verse list row
  verseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: VERSE_ROW_H,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  versePill: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versePillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  verseArabicArea: {
    flex: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  checkmark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
});

// ── Modal Styles ────────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  centeredWrapper: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    // Fixed height so flex:1 ScrollView inside has a parent height to fill.
    // overflow:'hidden' must NOT be set — it collapses flex children to zero height.
    height: 500,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  },
  handleWrapper: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  doneText: {
    fontSize: 15,
    fontWeight: '600',
  },
  scrollContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  groupedSection: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  stepperRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  rowValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  footnote: {
    fontSize: 12,
    marginTop: 12,
    marginLeft: 4,
    lineHeight: 18,
  },
});

export default memo(RepeatSettingsModal);
