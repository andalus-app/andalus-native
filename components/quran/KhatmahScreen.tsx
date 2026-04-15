/**
 * KhatmahScreen.tsx
 *
 * Khatmah (Quran completion plan) tab inside the QuranContentsScreen panel.
 *
 * Internal navigation (no routing — pure view-state stack):
 *   main          → empty state | active view | completed view
 *   plan-picker   → list of all plans grouped by recommendation
 *   start-picker  → "Börja från början" or "Välj startpunkt"
 *   surah-picker  → surah list for custom start point
 *   all-days      → scrollable list of all day ranges
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  memo,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Switch,
  Alert,
  Modal,
  StyleSheet,
  Animated,
  ActivityIndicator,
  type ListRenderItemInfo,
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import KhatmahCompleteAnimation from './KhatmahCompleteAnimation';
import {
  useKhatmah,
  KHATMAH_PLANS,
  type KhatmahPlan,
  type DayRange,
  type KhatmahData,
} from '../../hooks/quran/useKhatmah';
import { SURAH_INDEX, type SurahInfo } from '../../data/surahIndex';
import { fetchVersePage } from '../../services/mushafApi';
import SvgIcon from '../SvgIcon';
import * as Haptics from 'expo-haptics';

// ── Hook: resolved end page ────────────────────────────────────────────────────
//
// Fetches the actual Mushaf page for the end verse by scanning a narrow window
// around the pre-computed estimate.  Falls back to the estimate while loading.

function useResolvedEndPage(range: DayRange | null | undefined): number | null {
  const [page, setPage] = useState<number | null>(null);
  const abortRef        = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!range) { setPage(null); return; }

    setPage(null); // reset while fetching
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const endKey = `${range.endSurahId}:${range.endAyah}`;
    fetchVersePage(endKey, range.endPage)
      .then((p) => { if (!ctrl.signal.aborted) setPage(p); })
      .catch(() => {});

    return () => ctrl.abort();
  }, [range?.dayNumber, range?.endSurahId, range?.endAyah, range?.endPage]); // eslint-disable-line react-hooks/exhaustive-deps

  return page ?? range?.endPage ?? null;
}

// ── Hook: resolved start page ─────────────────────────────────────────────────
//
// Same pattern as useResolvedEndPage but for the start verse.
// JUZ_INDEX.firstPage values are sometimes off by 1-2 pages vs the actual API.

function useResolvedStartPage(range: DayRange | null | undefined): number | null {
  const [page, setPage] = useState<number | null>(null);
  const abortRef        = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!range) { setPage(null); return; }

    setPage(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const startKey = `${range.startSurahId}:${range.startAyah}`;
    fetchVersePage(startKey, range.startPage)
      .then((p) => { if (!ctrl.signal.aborted) setPage(p); })
      .catch(() => {});

    return () => ctrl.abort();
  }, [range?.dayNumber, range?.startSurahId, range?.startAyah, range?.startPage]); // eslint-disable-line react-hooks/exhaustive-deps

  return page ?? range?.startPage ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function surahName(id: number): string {
  return SURAH_INDEX.find((s) => s.id === id)?.nameSimple ?? `Surah ${id}`;
}

function padTime(n: number): string {
  return String(n).padStart(2, '0');
}

function rangeSummary(r: DayRange): string {
  return `${surahName(r.startSurahId)} ${r.startAyah} – ${surahName(r.endSurahId)} ${r.endAyah}`;
}

function pageRangeSummary(r: DayRange, resolvedEndPage?: number | null): string {
  const end = resolvedEndPage ?? r.endPage;
  return r.startPage === end
    ? `Sida ${r.startPage}`
    : `Sida ${r.startPage}–${end}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type KView = 'main' | 'plan-picker' | 'start-picker' | 'surah-picker' | 'all-days';

// ── Sub-view: Back header ─────────────────────────────────────────────────────

const BackHeader = memo(function BackHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack: () => void;
  onClose?: () => void;
}) {
  const { theme: T } = useTheme();
  return (
    <View style={[subStyles.backHeader, { borderBottomColor: T.separator }]}>
      <TouchableOpacity
        onPress={onBack}
        activeOpacity={0.7}
        style={subStyles.backBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <SvgIcon name="chevron-left" size={20} color={T.accent} />
        <Text style={[subStyles.backText, { color: T.accent }]}>Tillbaka</Text>
      </TouchableOpacity>
      <Text style={[subStyles.backTitle, { color: T.text }]} numberOfLines={1}>
        {title}
      </Text>
      {onClose ? (
        <TouchableOpacity
          onPress={onClose}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <SvgIcon name="close" size={20} color={T.textMuted} />
        </TouchableOpacity>
      ) : (
        <View style={{ width: 60 }} />
      )}
    </View>
  );
});

// ── Sub-view: Plan picker ─────────────────────────────────────────────────────

const PlanPicker = memo(function PlanPicker({
  onSelectPlan,
  onBack,
  bottomInset,
}: {
  onSelectPlan: (plan: KhatmahPlan) => void;
  onBack: () => void;
  bottomInset: number;
}) {
  const { theme: T } = useTheme();

  const recommended = useMemo(
    () => KHATMAH_PLANS.filter((p) => p.recommended),
    [],
  );
  const all = KHATMAH_PLANS;

  const renderRow = (plan: KhatmahPlan) => (
    <TouchableOpacity
      key={plan.id}
      style={[plStyles.row, { borderBottomColor: T.separator }]}
      onPress={() => onSelectPlan(plan)}
      activeOpacity={0.7}
    >
      <View style={plStyles.rowText}>
        <Text style={[plStyles.rowTitle, { color: T.text }]}>{plan.label}</Text>
        <Text style={[plStyles.rowMeta, { color: T.textMuted }]}>
          Daglig läsning: {plan.dailyLabel}
        </Text>
      </View>
      <SvgIcon name="chevron-right" size={18} color={T.textMuted} />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1 }}>
      <BackHeader title="Ny Khatmah" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[plStyles.sectionHeader, { color: T.textMuted }]}>
          REKOMMENDERAT
        </Text>
        <View style={[plStyles.section, { backgroundColor: T.card, borderColor: T.border }]}>
          {recommended.map(renderRow)}
        </View>

        <Text style={[plStyles.sectionHeader, { color: T.textMuted }]}>ALLA</Text>
        <View style={[plStyles.section, { backgroundColor: T.card, borderColor: T.border }]}>
          {all.map(renderRow)}
        </View>
      </ScrollView>
    </View>
  );
});

const plStyles = StyleSheet.create({
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 6,
    marginHorizontal: 16,
  },
  section: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 2,
  },
});

// ── Sub-view: Start picker ────────────────────────────────────────────────────

const StartPicker = memo(function StartPicker({
  plan,
  onStartFromBeginning,
  onPickSurah,
  onBack,
}: {
  plan: KhatmahPlan;
  onStartFromBeginning: () => void;
  onPickSurah: () => void;
  onBack: () => void;
}) {
  const { theme: T } = useTheme();

  return (
    <View style={{ flex: 1 }}>
      <BackHeader title="Start av Khatmah" onBack={onBack} />
      <View style={spStyles.content}>
        <TouchableOpacity
          style={[spStyles.option, { backgroundColor: T.card, borderColor: T.border }]}
          onPress={onStartFromBeginning}
          activeOpacity={0.7}
        >
          <Text style={[spStyles.optionText, { color: T.text }]}>
            Börja från början av Koranen
          </Text>
          <SvgIcon name="chevron-right" size={18} color={T.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[spStyles.option, spStyles.optionSecond, { backgroundColor: T.card, borderColor: T.border }]}
          onPress={onPickSurah}
          activeOpacity={0.7}
        >
          <Text style={[spStyles.optionText, { color: T.text }]}>
            Välj startpunkt...
          </Text>
        </TouchableOpacity>

        <Text style={[spStyles.planLabel, { color: T.textMuted }]}>
          {plan.label} · {plan.dailyLabel}
        </Text>
      </View>
    </View>
  );
});

const spStyles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  optionSecond: {},
  optionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  planLabel: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
});

// ── Sub-view: Surah picker ────────────────────────────────────────────────────

const SurahPicker = memo(function SurahPicker({
  onSelectSurah,
  onBack,
  bottomInset,
}: {
  onSelectSurah: (surahId: number) => void;
  onBack: () => void;
  bottomInset: number;
}) {
  const { theme: T } = useTheme();

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SurahInfo>) => (
      <TouchableOpacity
        style={[suStyles.row, { borderBottomColor: T.separator }]}
        onPress={() => onSelectSurah(item.id)}
        activeOpacity={0.7}
      >
        <View style={[suStyles.badge, { backgroundColor: T.border }]}>
          <Text style={[suStyles.badgeNum, { color: T.text }]}>{item.id}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[suStyles.name, { color: T.text }]}>{item.nameSimple}</Text>
          <Text style={[suStyles.meta, { color: T.textMuted }]}>
            {item.versesCount} ayah
          </Text>
        </View>
        <Text style={[suStyles.arabic, { color: T.textSecondary }]}>{item.nameArabic}</Text>
      </TouchableOpacity>
    ),
    [T, onSelectSurah],
  );

  return (
    <View style={{ flex: 1 }}>
      <BackHeader title="Välj startpunkt" onBack={onBack} />
      <FlatList
        data={SURAH_INDEX}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: bottomInset + 100 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={5}
      />
    </View>
  );
});

const suStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  badgeNum: { fontSize: 12, fontWeight: '700' },
  name:     { fontSize: 14, fontWeight: '600' },
  meta:     { fontSize: 11, marginTop: 1 },
  arabic:   { fontSize: 16, marginLeft: 8 },
});

// ── Sub-component: single day row (needs hook for resolved end page) ──────────

const DayRangeRow = memo(function DayRangeRow({
  item,
  currentDay,
  onDayTap,
}: {
  item:       DayRange;
  currentDay: number;
  onDayTap:   (range: DayRange) => void;
}) {
  const { theme: T } = useTheme();
  const isCurrent     = item.dayNumber === currentDay;
  const isCompleted   = item.completed;
  const resolvedEnd   = useResolvedEndPage(item);

  return (
    <TouchableOpacity
      style={[
        adStyles.row,
        { borderBottomColor: T.separator },
        isCurrent && { backgroundColor: T.accentGlow },
      ]}
      onPress={() => onDayTap(item)}
      activeOpacity={0.7}
    >
      <View style={adStyles.rowLeft}>
        <Text style={[adStyles.dayNum, { color: isCurrent ? T.accent : T.text }]}>
          Dag {item.dayNumber}
        </Text>
        <Text style={[adStyles.dayRange, { color: T.textMuted }]} numberOfLines={1}>
          {rangeSummary(item)}
        </Text>
        <Text style={[adStyles.dayPage, { color: T.textMuted }]}>
          {pageRangeSummary(item, resolvedEnd)}
        </Text>
      </View>
      {isCompleted ? (
        <SvgIcon name="check" size={18} color={T.accent} />
      ) : isCurrent ? (
        <View style={[adStyles.currentDot, { backgroundColor: T.accent }]} />
      ) : null}
    </TouchableOpacity>
  );
});

// ── Sub-view: All days ────────────────────────────────────────────────────────

const AllDaysView = memo(function AllDaysView({
  khatmah,
  onBack,
  onDayTap,
  bottomInset,
}: {
  khatmah: KhatmahData;
  onBack: () => void;
  onDayTap: (range: DayRange) => void;
  bottomInset: number;
}) {
  const { theme: T } = useTheme();

  const renderDay = useCallback(
    ({ item }: ListRenderItemInfo<DayRange>) => (
      <DayRangeRow
        item={item}
        currentDay={khatmah.currentDay}
        onDayTap={onDayTap}
      />
    ),
    [khatmah.currentDay, onDayTap],
  );

  return (
    <View style={{ flex: 1 }}>
      <BackHeader title="Alla dagar" onBack={onBack} />
      <FlatList
        data={khatmah.dayRanges}
        renderItem={renderDay}
        keyExtractor={(item) => String(item.dayNumber)}
        contentContainerStyle={{ paddingBottom: bottomInset + 100 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={30}
        maxToRenderPerBatch={30}
        windowSize={5}
      />
    </View>
  );
});

const adStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: { flex: 1 },
  dayNum: {
    fontSize: 14,
    fontWeight: '600',
  },
  dayRange: {
    fontSize: 12,
    marginTop: 2,
  },
  dayPage: {
    fontSize: 11,
    marginTop: 1,
    opacity: 0.7,
  },
  currentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
});

// ── Sub-component: Time picker modal ─────────────────────────────────────────

const TimePickerModal = memo(function TimePickerModal({
  visible,
  hour,
  minute,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  hour: number;
  minute: number;
  onConfirm: (h: number, m: number) => void;
  onDismiss: () => void;
}) {
  const { theme: T, isDark } = useTheme();
  const [h, setH] = useState(hour);
  const [m, setM] = useState(minute);

  // Re-sync when opened
  React.useEffect(() => {
    if (visible) { setH(hour); setM(minute); }
  }, [visible, hour, minute]);

  const adjH = useCallback((d: number) => setH((v) => (v + d + 24) % 24), []);
  const adjM = useCallback((d: number) => setM((v) => (v + d + 60) % 60), []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <TouchableOpacity
        style={tpStyles.overlay}
        activeOpacity={1}
        onPress={onDismiss}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[tpStyles.card, { backgroundColor: isDark ? T.cardElevated : T.card, borderColor: T.border }]}
          onPress={() => {}}
        >
          <Text style={[tpStyles.title, { color: T.text }]}>
            Välj tid för påminnelse
          </Text>

          <View style={tpStyles.controls}>
            {/* Hour */}
            <View style={tpStyles.column}>
              <TouchableOpacity onPress={() => adjH(1)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[tpStyles.arrow, { color: T.accent }]}>▲</Text>
              </TouchableOpacity>
              <Text style={[tpStyles.timeValue, { color: T.text }]}>{padTime(h)}</Text>
              <TouchableOpacity onPress={() => adjH(-1)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[tpStyles.arrow, { color: T.accent }]}>▼</Text>
              </TouchableOpacity>
            </View>

            <Text style={[tpStyles.colon, { color: T.text }]}>:</Text>

            {/* Minute */}
            <View style={tpStyles.column}>
              <TouchableOpacity onPress={() => adjM(5)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[tpStyles.arrow, { color: T.accent }]}>▲</Text>
              </TouchableOpacity>
              <Text style={[tpStyles.timeValue, { color: T.text }]}>{padTime(m)}</Text>
              <TouchableOpacity onPress={() => adjM(-5)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[tpStyles.arrow, { color: T.accent }]}>▼</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[tpStyles.confirmBtn, { backgroundColor: T.accent }]}
            onPress={() => onConfirm(h, m)}
            activeOpacity={0.8}
          >
            <Text style={tpStyles.confirmText}>Klar</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
});

const tpStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 260,
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 24,
    alignItems: 'center',
    gap: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  column: {
    alignItems: 'center',
    gap: 8,
  },
  arrow: {
    fontSize: 18,
    fontWeight: '700',
  },
  timeValue: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 2,
    minWidth: 60,
    textAlign: 'center',
  },
  colon: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 6,
  },
  confirmBtn: {
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderRadius: 22,
    width: '100%',
    alignItems: 'center',
  },
  confirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

// ── Sub-component: Reminder section ──────────────────────────────────────────

const ReminderSection = memo(function ReminderSection({
  khatmah,
  onToggle,
  onTimeChange,
}: {
  khatmah: KhatmahData;
  onToggle: (enabled: boolean) => void;
  onTimeChange: (hour: number, minute: number) => void;
}) {
  const { theme: T } = useTheme();
  const [showTimePicker, setShowTimePicker] = useState(false);

  const handleConfirm = useCallback(
    (h: number, m: number) => {
      setShowTimePicker(false);
      onTimeChange(h, m);
    },
    [onTimeChange],
  );

  return (
    <>
      <Text style={[remStyles.sectionLabel, { color: T.textMuted }]}>PÅMINNELSE</Text>
      <View style={[remStyles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={remStyles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[remStyles.rowTitle, { color: T.text }]}>Läsning varje dag</Text>
            <TouchableOpacity
              onPress={() => khatmah.reminderEnabled && setShowTimePicker(true)}
              activeOpacity={khatmah.reminderEnabled ? 0.7 : 1}
            >
              <Text style={[remStyles.timeText, { color: T.textMuted }]}>
                {padTime(khatmah.reminderHour)}:{padTime(khatmah.reminderMinute)}
              </Text>
            </TouchableOpacity>
          </View>
          <Switch
            value={khatmah.reminderEnabled}
            onValueChange={onToggle}
            trackColor={{ false: 'transparent', true: T.accent }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <TimePickerModal
        visible={showTimePicker}
        hour={khatmah.reminderHour}
        minute={khatmah.reminderMinute}
        onConfirm={handleConfirm}
        onDismiss={() => setShowTimePicker(false)}
      />
    </>
  );
});

const remStyles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 6,
    marginHorizontal: 16,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  timeText: {
    fontSize: 13,
    marginTop: 2,
  },
});

// ── Main view: Empty state ────────────────────────────────────────────────────

const EmptyState = memo(function EmptyState({
  onStart,
}: {
  onStart: () => void;
}) {
  const { theme: T } = useTheme();
  return (
    <View style={esStyles.container}>
      <Text style={[esStyles.desc, { color: T.textMuted }]}>
        Välj en period för att läsa klart Koranen och fortsätt din Khatmah under Ramadan och resten av året.
      </Text>
      <TouchableOpacity
        style={[esStyles.btn, { backgroundColor: T.accent }]}
        onPress={onStart}
        activeOpacity={0.8}
      >
        <Text style={esStyles.btnText}>Starta ny Khatmah</Text>
      </TouchableOpacity>
    </View>
  );
});

const esStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 28,
  },
  desc: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  btn: {
    paddingHorizontal: 32,
    paddingVertical: 15,
    borderRadius: 26,
    alignItems: 'center',
    width: '100%',
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

// ── Main view: Completed state ────────────────────────────────────────────────

const CompletedState = memo(function CompletedState({
  khatmah,
  onRepeat,
  onStartNew,
  onAllDays,
  onDelete,
  onReminderToggle,
  onReminderTimeChange,
}: {
  khatmah: KhatmahData;
  onRepeat: () => void;
  onStartNew: () => void;
  onAllDays: () => void;
  onDelete: () => void;
  onReminderToggle: (enabled: boolean) => void;
  onReminderTimeChange: (h: number, m: number) => void;
}) {
  const { theme: T } = useTheme();
  return (
    <ScrollView
      contentContainerStyle={csStyles.container}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[csStyles.doneText, { color: T.text }]}>
        Du har slutfört din Khatmah
      </Text>

      <TouchableOpacity
        style={[csStyles.btn, { backgroundColor: T.accent }]}
        onPress={onRepeat}
        activeOpacity={0.8}
      >
        <SvgIcon name="repeat" size={18} color="#fff" />
        <Text style={csStyles.btnText}>Upprepa Khatmah</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[csStyles.btn, { backgroundColor: T.accent }]}
        onPress={onStartNew}
        activeOpacity={0.8}
      >
        <Text style={csStyles.btnText}>Starta ny Khatmah</Text>
      </TouchableOpacity>

      <ReminderSection
        khatmah={khatmah}
        onToggle={onReminderToggle}
        onTimeChange={onReminderTimeChange}
      />

      <TouchableOpacity
        style={[csStyles.allDaysRow, { backgroundColor: T.card, borderColor: T.border }]}
        onPress={onAllDays}
        activeOpacity={0.7}
      >
        <Text style={[csStyles.allDaysText, { color: T.text }]}>Alla dagar</Text>
        <View style={csStyles.allDaysRight}>
          <Text style={[csStyles.allDaysCount, { color: T.textMuted }]}>
            {khatmah.totalDays}
          </Text>
          <SvgIcon name="chevron-right" size={18} color={T.textMuted} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[csStyles.deleteRow, { backgroundColor: T.card, borderColor: T.border }]}
        onPress={onDelete}
        activeOpacity={0.7}
      >
        <Text style={[csStyles.deleteText, { color: T.accentRed }]}>Radera Khatmah</Text>
      </TouchableOpacity>
    </ScrollView>
  );
});

const csStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: 120,
    gap: 12,
  },
  doneText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 26,
    gap: 8,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  allDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  allDaysText: { fontSize: 15, fontWeight: '500' },
  allDaysRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  allDaysCount: { fontSize: 15 },
  deleteRow: {
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  deleteText: { fontSize: 15, fontWeight: '500' },
});

// ── Main view: Active Khatmah ─────────────────────────────────────────────────

const ActiveView = memo(function ActiveView({
  khatmah,
  onMarkComplete,
  onAllDays,
  onDelete,
  onReminderToggle,
  onReminderTimeChange,
  onNavigateToStart,
  onNavigateToEnd,
}: {
  khatmah: KhatmahData;
  onMarkComplete: () => void;
  onAllDays: () => void;
  onDelete: () => void;
  onReminderToggle: (enabled: boolean) => void;
  onReminderTimeChange: (h: number, m: number) => void;
  onNavigateToStart: (range: DayRange, page: number) => void;
  onNavigateToEnd:   (range: DayRange, page: number) => void;
}) {
  const { theme: T } = useTheme();

  const currentRange      = khatmah.dayRanges.find((r) => r.dayNumber === khatmah.currentDay);
  const resolvedStartPage = useResolvedStartPage(currentRange);
  const resolvedEndPage   = useResolvedEndPage(currentRange);

  return (
    <ScrollView
      contentContainerStyle={avStyles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Day header */}
      <View style={avStyles.dayHeader}>
        <Text style={[avStyles.dayLabel, { color: T.textMuted }]}>
          DAG {khatmah.currentDay}
        </Text>
        <Text style={[avStyles.todayLabel, { color: T.textMuted }]}>IDAG</Text>
      </View>

      {/* Range card */}
      {currentRange ? (
        <View style={[avStyles.rangeCard, { backgroundColor: T.card, borderColor: T.border }]}>
          <TouchableOpacity
            style={[avStyles.rangeRow, { borderBottomColor: T.separator }]}
            onPress={() => onNavigateToStart(currentRange, resolvedStartPage ?? currentRange.startPage)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[avStyles.rangeDir, { color: T.textMuted }]}>Från</Text>
              <Text style={[avStyles.rangeMain, { color: T.text }]}>
                {surahName(currentRange.startSurahId)}: {currentRange.startAyah}
              </Text>
            </View>
            <Text style={[avStyles.pageNum, { color: T.textMuted }]}>
              {resolvedStartPage ?? currentRange.startPage}
            </Text>
            <SvgIcon name="chevron-right" size={18} color={T.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={avStyles.rangeRow}
            onPress={() => onNavigateToEnd(currentRange, resolvedEndPage ?? currentRange.endPage)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[avStyles.rangeDir, { color: T.textMuted }]}>Till</Text>
              <Text style={[avStyles.rangeMain, { color: T.text }]}>
                {surahName(currentRange.endSurahId)}: {currentRange.endAyah}
              </Text>
            </View>
            <Text style={[avStyles.pageNum, { color: T.textMuted }]}>
              {resolvedEndPage ?? currentRange.endPage}
            </Text>
            <SvgIcon name="chevron-right" size={18} color={T.textMuted} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Mark as complete button */}
      <TouchableOpacity
        style={[avStyles.completeBtn, { backgroundColor: T.accent }]}
        onPress={onMarkComplete}
        activeOpacity={0.8}
      >
        <Text style={avStyles.completeBtnText}>Markera som klar</Text>
      </TouchableOpacity>

      {/* Reminder */}
      <ReminderSection
        khatmah={khatmah}
        onToggle={onReminderToggle}
        onTimeChange={onReminderTimeChange}
      />

      {/* All days row */}
      <TouchableOpacity
        style={[avStyles.allDaysRow, { backgroundColor: T.card, borderColor: T.border }]}
        onPress={onAllDays}
        activeOpacity={0.7}
      >
        <Text style={[avStyles.allDaysText, { color: T.text }]}>Alla dagar</Text>
        <View style={avStyles.allDaysRight}>
          <Text style={[avStyles.allDaysCount, { color: T.textMuted }]}>
            {khatmah.totalDays}
          </Text>
          <SvgIcon name="chevron-right" size={18} color={T.textMuted} />
        </View>
      </TouchableOpacity>

      {/* Delete */}
      <TouchableOpacity
        style={[avStyles.deleteRow, { backgroundColor: T.card, borderColor: T.border }]}
        onPress={onDelete}
        activeOpacity={0.7}
      >
        <Text style={[avStyles.deleteText, { color: T.accentRed }]}>Radera Khatmah</Text>
      </TouchableOpacity>
    </ScrollView>
  );
});

const avStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 120,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  todayLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  rangeCard: {
    borderRadius: 12,
    borderWidth: 0.5,
    overflow: 'hidden',
    marginBottom: 16,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rangeDir: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  rangeMain: {
    fontSize: 15,
    fontWeight: '500',
  },
  pageNum: {
    fontSize: 14,
    fontWeight: '500',
    marginRight: 4,
  },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 26,
    gap: 8,
    marginBottom: 4,
  },
  completeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  allDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  allDaysText:  { fontSize: 15, fontWeight: '500' },
  allDaysRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  allDaysCount: { fontSize: 15 },
  deleteRow: {
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  deleteText: { fontSize: 15, fontWeight: '500' },
});

// ── Root component ────────────────────────────────────────────────────────────

type Props = {
  bottomInset: number;
};

function KhatmahScreen({ bottomInset }: Props) {
  const { theme: T } = useTheme();
  const { goToPage, closeContentsMenu, setKhatmahRange } = useQuranContext();

  const {
    khatmah,
    loading,
    isCompleted,
    createKhatmah,
    markCurrentDayComplete,
    repeatKhatmah,
    deleteKhatmah,
    setReminder,
  } = useKhatmah();

  const [view, setView]             = useState<KView>('main');
  const [pendingPlan, setPendingPlan] = useState<KhatmahPlan | null>(null);
  const [showCompleteAnim, setShowCompleteAnim] = useState(false);

  // ── Navigation handlers ───────────────────────────────────────────────────

  const handleStartNew = useCallback(() => setView('plan-picker'), []);

  const handleSelectPlan = useCallback((plan: KhatmahPlan) => {
    setPendingPlan(plan);
    setView('start-picker');
  }, []);

  const handleStartFromBeginning = useCallback(async () => {
    if (!pendingPlan) return;
    await createKhatmah(pendingPlan.id, pendingPlan.days, 1, 1);
    setView('main');
    setPendingPlan(null);
  }, [pendingPlan, createKhatmah]);

  const handlePickSurah = useCallback(() => setView('surah-picker'), []);

  const handleSelectSurah = useCallback(async (surahId: number) => {
    if (!pendingPlan) return;
    await createKhatmah(pendingPlan.id, pendingPlan.days, surahId, 1);
    setView('main');
    setPendingPlan(null);
  }, [pendingPlan, createKhatmah]);

  const handleAllDays = useCallback(() => setView('all-days'), []);

  const handleBackFromPlanPicker  = useCallback(() => setView('main'), []);
  const handleBackFromStartPicker = useCallback(() => setView('plan-picker'), []);
  const handleBackFromSurahPicker = useCallback(() => setView('start-picker'), []);
  const handleBackFromAllDays     = useCallback(() => setView('main'), []);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Radera Khatmah',
      'Är du säker på att du vill radera din Khatmah? All progress och påminnelser tas bort.',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Radera',
          style: 'destructive',
          onPress: () => {
            deleteKhatmah();
            setKhatmahRange(null);
            setView('main');
          },
        },
      ],
    );
  }, [deleteKhatmah]);

  // Called immediately when the button is pressed — fires haptic + shows animation.
  const handleCompletePress = useCallback(() => {
    if (!khatmah) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setShowCompleteAnim(true);
  }, [khatmah]);

  // Called by the animation overlay when it has finished — does the actual navigation.
  const handleMarkComplete = useCallback(async () => {
    setShowCompleteAnim(false);
    if (!khatmah) return;
    const nextDayNum  = khatmah.currentDay + 1;
    const nextRange   = khatmah.dayRanges.find((r) => r.dayNumber === nextDayNum);

    await markCurrentDayComplete();

    if (nextRange && nextDayNum <= khatmah.totalDays) {
      setKhatmahRange({
        startVerseKey: `${nextRange.startSurahId}:${nextRange.startAyah}`,
        endVerseKey:   `${nextRange.endSurahId}:${nextRange.endAyah}`,
        dayNumber:     nextRange.dayNumber,
      });
      // Resolve the actual start page (JUZ_INDEX.firstPage may be off by 1-2 pages)
      const startKey = `${nextRange.startSurahId}:${nextRange.startAyah}`;
      fetchVersePage(startKey, nextRange.startPage)
        .then((p) => goToPage(p))
        .catch(() => goToPage(nextRange.startPage));
    }
  }, [markCurrentDayComplete, khatmah, setKhatmahRange, goToPage]);

  const handleRepeat = useCallback(async () => {
    await repeatKhatmah();
  }, [repeatKhatmah]);

  const handleReminderToggle = useCallback(
    async (enabled: boolean) => {
      if (!khatmah) return;
      await setReminder(enabled, khatmah.reminderHour, khatmah.reminderMinute);
    },
    [khatmah, setReminder],
  );

  const handleReminderTimeChange = useCallback(
    async (h: number, m: number) => {
      await setReminder(true, h, m);
    },
    [setReminder],
  );

  const handleDayTap = useCallback(
    (range: DayRange) => {
      setKhatmahRange({
        startVerseKey: `${range.startSurahId}:${range.startAyah}`,
        endVerseKey:   `${range.endSurahId}:${range.endAyah}`,
        dayNumber:     range.dayNumber,
      });
      // Resolve actual start page before navigating — JUZ_INDEX.firstPage may be off
      const startKey = `${range.startSurahId}:${range.startAyah}`;
      fetchVersePage(startKey, range.startPage)
        .then((p) => { goToPage(p); closeContentsMenu(); })
        .catch(() => { goToPage(range.startPage); closeContentsMenu(); });
    },
    [goToPage, closeContentsMenu, setKhatmahRange],
  );

  const handleNavigateToStart = useCallback(
    (range: DayRange, page: number) => {
      setKhatmahRange({
        startVerseKey: `${range.startSurahId}:${range.startAyah}`,
        endVerseKey:   `${range.endSurahId}:${range.endAyah}`,
        dayNumber:     range.dayNumber,
      });
      goToPage(page);
      closeContentsMenu();
    },
    [goToPage, closeContentsMenu, setKhatmahRange],
  );

  const handleNavigateToEnd = useCallback(
    (range: DayRange, page: number) => {
      setKhatmahRange({
        startVerseKey: `${range.startSurahId}:${range.startAyah}`,
        endVerseKey:   `${range.endSurahId}:${range.endAyah}`,
        dayNumber:     range.dayNumber,
      });
      goToPage(page);
      closeContentsMenu();
    },
    [goToPage, closeContentsMenu, setKhatmahRange],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={rootStyles.centered}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  if (view === 'plan-picker') {
    return (
      <PlanPicker
        onSelectPlan={handleSelectPlan}
        onBack={handleBackFromPlanPicker}
        bottomInset={bottomInset}
      />
    );
  }

  if (view === 'start-picker' && pendingPlan) {
    return (
      <StartPicker
        plan={pendingPlan}
        onStartFromBeginning={handleStartFromBeginning}
        onPickSurah={handlePickSurah}
        onBack={handleBackFromStartPicker}
      />
    );
  }

  if (view === 'surah-picker') {
    return (
      <SurahPicker
        onSelectSurah={handleSelectSurah}
        onBack={handleBackFromSurahPicker}
        bottomInset={bottomInset}
      />
    );
  }

  if (view === 'all-days' && khatmah) {
    return (
      <AllDaysView
        khatmah={khatmah}
        onBack={handleBackFromAllDays}
        onDayTap={handleDayTap}
        bottomInset={bottomInset}
      />
    );
  }

  // Main view
  if (!khatmah) {
    return <EmptyState onStart={handleStartNew} />;
  }

  if (isCompleted) {
    return (
      <CompletedState
        khatmah={khatmah}
        onRepeat={handleRepeat}
        onStartNew={handleStartNew}
        onAllDays={handleAllDays}
        onDelete={handleDelete}
        onReminderToggle={handleReminderToggle}
        onReminderTimeChange={handleReminderTimeChange}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ActiveView
        khatmah={khatmah}
        onMarkComplete={handleCompletePress}
        onAllDays={handleAllDays}
        onDelete={handleDelete}
        onReminderToggle={handleReminderToggle}
        onReminderTimeChange={handleReminderTimeChange}
        onNavigateToStart={handleNavigateToStart}
        onNavigateToEnd={handleNavigateToEnd}
      />
      {showCompleteAnim && (
        <KhatmahCompleteAnimation onDone={handleMarkComplete} />
      )}
    </View>
  );
}

const rootStyles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const subStyles = StyleSheet.create({
  backHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 80,
  },
  backText: {
    fontSize: 15,
    fontWeight: '500',
  },
  backTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
});

export default memo(KhatmahScreen);
