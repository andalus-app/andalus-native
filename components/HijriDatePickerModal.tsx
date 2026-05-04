/**
 * HijriDatePickerModal
 *
 * Combined date + time picker sheet supporting two input modes:
 *   - 'hijri'     → direct save, no confirmation
 *   - 'gregorian' → converts to Hijri, shows inline confirmation with ±1 day
 *                   adjustment, then saves
 *
 * Used by:
 *   - components/ZakatReminderCard.tsx  (inside the Zakat calculator)
 *   - app/settings.tsx                  (direct first-time setup from Settings)
 */

import {
  View, Text, TouchableOpacity, Modal, ScrollView,
  Platform, Animated, ActivityIndicator, Alert,
} from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { HIJRI_MONTH_NAMES, gregorianToHijri } from '../services/hijriCalendarService';

// ── Hijri calendar data ─────────────────────────────────────────────────────
export const HIJRI_MONTH_MAX_DAYS: Record<number, number> = {
  1: 30, 2: 29, 3: 30, 4: 29, 5: 30, 6: 29,
  7: 30, 8: 29, 9: 30, 10: 29, 11: 30, 12: 30,
};

export const ALL_HIJRI_MONTHS = Object.entries(HIJRI_MONTH_NAMES).map(([num, name]) => ({
  num: parseInt(num, 10),
  name,
}));

export const MINUTE_OPTIONS = [0, 15, 30, 45];

// ── Gregorian calendar data ──────────────────────────────────────────────────

const GREGORIAN_MONTH_NAMES: Record<number, string> = {
  1: 'Januari', 2: 'Februari', 3: 'Mars', 4: 'April',
  5: 'Maj', 6: 'Juni', 7: 'Juli', 8: 'Augusti',
  9: 'September', 10: 'Oktober', 11: 'November', 12: 'December',
};

// February = 29 (safe max for leap years; day > actual max is guarded at render)
const GREGORIAN_MONTH_MAX_DAYS: Record<number, number> = {
  1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

const ALL_GREGORIAN_MONTHS = Object.entries(GREGORIAN_MONTH_NAMES).map(([num, name]) => ({
  num: parseInt(num, 10),
  name,
}));

// ── Types ────────────────────────────────────────────────────────────────────

type ActiveDropdown = 'month' | 'day' | 'time' | null;

type ConfirmationState = {
  gregorianDateStr: string;
  hijriDay: number;
  hijriMonth: number;
  hijriMonthName: string;
};

export type ConfirmMeta = {
  inputMode: 'hijri' | 'gregorian';
  originalGregorianMonth?: number;
  originalGregorianDay?: number;
};

export type HijriDatePickerProps = {
  visible: boolean;
  currentDay: number;
  currentMonth: number;
  currentHour: number;
  currentMinute: number;
  /** Awaitable — modal waits for this to finish before showing the checkmark. */
  onConfirm: (
    day: number,
    month: number,
    monthName: string,
    hour: number,
    minute: number,
    meta?: ConfirmMeta,
  ) => Promise<void>;
  onClose: () => void;
};

export default function HijriDatePickerModal({
  visible,
  currentDay,
  currentMonth,
  currentHour,
  currentMinute,
  onConfirm,
  onClose,
}: HijriDatePickerProps) {
  const { theme: T } = useTheme();

  // ── Input mode ────────────────────────────────────────────────────────────
  const [inputMode, setInputMode] = useState<'hijri' | 'gregorian'>('hijri');

  // ── Hijri selection ───────────────────────────────────────────────────────
  const [selMonth, setSelMonth] = useState(currentMonth);
  const [selDay,   setSelDay]   = useState(currentDay);

  // ── Gregorian selection ───────────────────────────────────────────────────
  const today = new Date();
  const [selGregMonth, setSelGregMonth] = useState(today.getMonth() + 1);
  const [selGregDay,   setSelGregDay]   = useState(today.getDate());

  // ── Shared: time ──────────────────────────────────────────────────────────
  const [selHour,   setSelHour]   = useState(currentHour);
  const [selMinute, setSelMinute] = useState(currentMinute);

  // ── Inline confirmation (Gregorian mode only) ─────────────────────────────
  const [confirmState, setConfirmState] = useState<ConfirmationState | null>(null);

  const [open,   setOpen]   = useState<ActiveDropdown>('month');
  const [saved,  setSaved]  = useState(false);
  const [saving, setSaving] = useState(false);

  const checkScale   = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity  = useRef(new Animated.Value(0)).current;

  // Reset every time the modal opens
  useEffect(() => {
    if (visible) {
      setInputMode('hijri');
      setSelMonth(currentMonth);
      setSelDay(currentDay);
      const now = new Date();
      setSelGregMonth(now.getMonth() + 1);
      setSelGregDay(now.getDate());
      setSelHour(currentHour);
      setSelMinute(currentMinute);
      setConfirmState(null);
      setSaved(false);
      setSaving(false);
      setOpen('month');
      checkScale.setValue(0);
      checkOpacity.setValue(0);
      textOpacity.setValue(0);
    }
  }, [visible]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const hijriMaxDays   = HIJRI_MONTH_MAX_DAYS[selMonth] ?? 30;
  const hijriMonthName = HIJRI_MONTH_NAMES[selMonth] ?? '';

  const gregMaxDays   = GREGORIAN_MONTH_MAX_DAYS[selGregMonth] ?? 31;
  const gregMonthName = GREGORIAN_MONTH_NAMES[selGregMonth] ?? '';

  const maxDays   = inputMode === 'hijri' ? hijriMaxDays   : gregMaxDays;
  const monthName = inputMode === 'hijri' ? hijriMonthName : gregMonthName;
  const dayValue  = inputMode === 'hijri' ? selDay         : selGregDay;

  const timeFmt = `${String(selHour).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}`;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleMonthSelect = (month: number) => {
    if (inputMode === 'hijri') {
      setSelMonth(month);
      const max = HIJRI_MONTH_MAX_DAYS[month] ?? 30;
      if (selDay > max) setSelDay(max);
    } else {
      setSelGregMonth(month);
      const max = GREGORIAN_MONTH_MAX_DAYS[month] ?? 31;
      if (selGregDay > max) setSelGregDay(max);
    }
  };

  const handleDaySelect = (d: number) => {
    if (inputMode === 'hijri') setSelDay(d);
    else setSelGregDay(d);
  };

  const switchMode = (mode: 'hijri' | 'gregorian') => {
    setInputMode(mode);
    setOpen('month');
  };

  const animateAndClose = () => {
    Animated.parallel([
      Animated.timing(checkOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(checkScale,   { toValue: 1, bounciness: 10, useNativeDriver: true }),
    ]).start(() => {
      Animated.timing(textOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
    setTimeout(onClose, 1600);
  };

  const handleConfirm = async () => {
    if (saving || saved) return;

    if (inputMode === 'hijri') {
      // Direct save — no confirmation needed
      setSaving(true);
      await onConfirm(selDay, selMonth, HIJRI_MONTH_NAMES[selMonth] ?? '', selHour, selMinute, { inputMode: 'hijri' });
      setSaving(false);
      setSaved(true);
      animateAndClose();
      return;
    }

    // Gregorian mode: convert → show inline confirmation
    setSaving(true);
    try {
      const dd     = String(selGregDay).padStart(2, '0');
      const mm     = String(selGregMonth).padStart(2, '0');
      const yyyy   = String(new Date().getFullYear());
      const result = await gregorianToHijri(`${dd}-${mm}-${yyyy}`);
      const hMthName = HIJRI_MONTH_NAMES[result.month] ?? result.monthName;
      setSaving(false);
      setConfirmState({
        gregorianDateStr: `${selGregDay} ${GREGORIAN_MONTH_NAMES[selGregMonth]}`,
        hijriDay:         result.day,
        hijriMonth:       result.month,
        hijriMonthName:   hMthName,
      });
    } catch {
      setSaving(false);
      Alert.alert(
        'Fel',
        'Kunde inte konvertera datum till Hijri. Kontrollera internetanslutningen och försök igen.',
        [{ text: 'OK' }],
      );
    }
  };

  // Called from inline confirmation screen when user taps "Bekräfta"
  const handleFinalConfirm = async () => {
    if (!confirmState || saving || saved) return;
    setSaving(true);
    await onConfirm(
      confirmState.hijriDay,
      confirmState.hijriMonth,
      confirmState.hijriMonthName,
      selHour,
      selMinute,
      {
        inputMode: 'gregorian',
        originalGregorianMonth: selGregMonth,
        originalGregorianDay:   selGregDay,
      },
    );
    setSaving(false);
    setConfirmState(null);
    setSaved(true);
    animateAndClose();
  };

  const adjustConfirmDay = (delta: -1 | 1) => {
    if (!confirmState) return;
    const maxDay = HIJRI_MONTH_MAX_DAYS[confirmState.hijriMonth] ?? 30;
    const newDay = Math.min(maxDay, Math.max(1, confirmState.hijriDay + delta));
    setConfirmState(prev => prev ? { ...prev, hijriDay: newDay } : prev);
  };

  const toggle = (d: Exclude<ActiveDropdown, null>) => {
    setOpen(prev => (prev === d ? null : d));
  };

  // ── Dropdown selector button ──────────────────────────────────────────────
  const DropBtn = ({
    id, label, value, flex,
  }: { id: Exclude<ActiveDropdown, null>; label: string; value: string; flex: number }) => {
    const isOpen = open === id;
    return (
      <TouchableOpacity
        onPress={() => toggle(id)}
        activeOpacity={0.7}
        style={{
          flex,
          borderRadius: 10,
          borderWidth: 0.5,
          borderColor: isOpen ? T.accent : T.border,
          backgroundColor: isOpen ? (T.accent + '18') : T.bg,
          paddingVertical: 10,
          paddingHorizontal: 10,
        }}
      >
        <Text style={{ fontSize: 10, fontWeight: '600', color: T.textMuted, letterSpacing: 0.8, marginBottom: 4 }}>
          {label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '600', color: isOpen ? T.accent : T.text }}>
            {value}
          </Text>
          <Text style={{ fontSize: 9, color: isOpen ? T.accent : T.textMuted, marginLeft: 3 }}>
            {isOpen ? '▲' : '▼'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const allMonths = inputMode === 'hijri' ? ALL_HIJRI_MONTHS : ALL_GREGORIAN_MONTHS;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Spacer — no backdrop */}
      <TouchableOpacity style={{ flex: 1, backgroundColor: 'transparent' }} activeOpacity={1} onPress={onClose} />

      {/* Sheet — fixed height so dropdowns never resize it */}
      <View style={{
        backgroundColor: T.card,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        height: '78%',
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
        borderWidth: 0.5,
        borderBottomWidth: 0,
        borderColor: T.border,
      }}>
        {/* ── Fixed header ───────────────────────────────────────────────────── */}
        {/* Drag handle */}
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, alignSelf: 'center', marginTop: 10, marginBottom: 14 }} />

        {/* Title row */}
        <View style={{ paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.text }}>
            {confirmState
              ? 'Bekräfta zakatdatum'
              : inputMode === 'hijri'
                ? 'Välj Hijri-datum'
                : 'Välj gregorianskt datum'}
          </Text>
          <TouchableOpacity
            onPress={confirmState ? () => setConfirmState(null) : onClose}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.accentGlow, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 16, color: T.textMuted, lineHeight: 20, marginTop: -1 }}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 0.5, backgroundColor: T.border, marginTop: 10 }} />

        {/* ── Success state ─────────────────────────────────────────────────── */}
        {saved ? (
          <Animated.View style={{ flex: 1, opacity: checkOpacity, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{
              transform: [{ scale: checkScale }],
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: T.accent,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
              shadowColor: T.accent,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.4,
              shadowRadius: 14,
            }}>
              <Text style={{ fontSize: 34, color: '#fff', lineHeight: 40, marginTop: 2 }}>✓</Text>
            </Animated.View>
            <Animated.Text style={{ opacity: textOpacity, fontSize: 16, fontWeight: '600', color: T.text }}>
              Påminnelse aktiverad
            </Animated.Text>
          </Animated.View>

        ) : confirmState ? (
          /* ── Inline confirmation screen (Gregorian mode) ──────────────────── */
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>

            {/* "You selected" */}
            <Text style={{ fontSize: 14, color: T.textMuted, marginBottom: 14, lineHeight: 20 }}>
              {'Du valde '}
              <Text style={{ fontWeight: '700', color: T.text }}>{confirmState.gregorianDateStr}</Text>
              {'.'}
            </Text>

            {/* Hijri date with ±1 adjustment */}
            <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 8 }}>
              Det motsvarar ungefär:
            </Text>
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: T.accentGlow,
              borderRadius: 14, borderWidth: 0.5, borderColor: T.accent,
              paddingVertical: 14, paddingHorizontal: 16,
              marginBottom: 16, gap: 16,
            }}>
              <TouchableOpacity
                onPress={() => adjustConfirmDay(-1)}
                disabled={confirmState.hijriDay <= 1}
                activeOpacity={0.7}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: confirmState.hijriDay <= 1 ? T.border : T.accent,
                }}
              >
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#fff', lineHeight: 24, marginTop: -1 }}>−</Text>
              </TouchableOpacity>

              <View style={{ alignItems: 'center', minWidth: 140 }}>
                <Text style={{ fontSize: 22, fontWeight: '700', color: T.accent }}>
                  {confirmState.hijriDay} {confirmState.hijriMonthName}
                </Text>
                <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>
                  Hijri-dag
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => adjustConfirmDay(1)}
                disabled={confirmState.hijriDay >= (HIJRI_MONTH_MAX_DAYS[confirmState.hijriMonth] ?? 30)}
                activeOpacity={0.7}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: confirmState.hijriDay >= (HIJRI_MONTH_MAX_DAYS[confirmState.hijriMonth] ?? 30) ? T.border : T.accent,
                }}
              >
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#fff', lineHeight: 24, marginTop: -1 }}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Explanation */}
            <View style={{
              backgroundColor: T.bg,
              borderRadius: 10, borderWidth: 0.5, borderColor: T.border,
              padding: 12, marginBottom: 20, gap: 6,
            }}>
              <Text style={{ fontSize: 13, color: T.textMuted, lineHeight: 19 }}>
                Påminnelsen sparas enligt Hijri-datumet, inte det gregorianska datumet.
              </Text>
              <Text style={{ fontSize: 12, color: T.textMuted, lineHeight: 18, opacity: 0.75 }}>
                Hijri-datum kan skilja ±1 dag beroende på månskådning. Justera vid behov med knapparna ovan.
              </Text>
            </View>

            {/* Buttons */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setConfirmState(null)}
                activeOpacity={0.7}
                style={{
                  flex: 1, height: 48, borderRadius: 14,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: T.bg, borderWidth: 0.5, borderColor: T.border,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: T.textMuted }}>Avbryt</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleFinalConfirm}
                disabled={saving}
                activeOpacity={0.85}
                style={{
                  flex: 2, height: 48, borderRadius: 14,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: T.accent,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Bekräfta</Text>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>

        ) : (
          /* ── Picker screen: fixed header + flex middle + fixed footer ─────── */
          <>
            {/* Three selector buttons — always visible, never move */}
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 }}>
              <DropBtn id="month" label="MÅNAD" value={monthName}        flex={2} />
              <DropBtn id="day"   label="DAG"   value={String(dayValue)} flex={1} />
              <DropBtn id="time"  label="TID"   value={timeFmt}          flex={1} />
            </View>

            {/* Flex middle — absorbs all remaining space so footer never moves */}
            <View style={{ flex: 1 }}>
              {open !== null && (
                <>
                  <View style={{ height: 0.5, backgroundColor: T.border }} />
                  <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

                  {/* Month list */}
                  {open === 'month' && allMonths.map((m, idx) => {
                    const active = inputMode === 'hijri' ? selMonth === m.num : selGregMonth === m.num;
                    const isLast = idx === allMonths.length - 1;
                    return (
                      <TouchableOpacity
                        key={m.num}
                        onPress={() => handleMonthSelect(m.num)}
                        activeOpacity={0.6}
                        style={{
                          paddingVertical: 12, paddingHorizontal: 20,
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: active ? T.accent + '12' : 'transparent',
                          borderBottomWidth: isLast ? 0 : 0.5,
                          borderBottomColor: T.border,
                        }}
                      >
                        <Text style={{ flex: 1, fontSize: 15, fontWeight: active ? '600' : '400', color: T.text }}>{m.name}</Text>
                        {active && <Text style={{ color: T.accent, fontSize: 15, fontWeight: '700' }}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}

                  {/* Day grid — 7 columns, 5 rows */}
                  {open === 'day' && (
                    <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                      {Array.from({ length: 5 }, (_, row) => (
                        <View
                          key={row}
                          style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: row < 4 ? 6 : 0 }}
                        >
                          {Array.from({ length: 7 }, (_, col) => {
                            const d = row * 7 + col + 1;
                            const valid = d <= maxDays;
                            const active = dayValue === d;
                            return (
                              <TouchableOpacity
                                key={col}
                                onPress={valid ? () => handleDaySelect(d) : undefined}
                                activeOpacity={valid ? 0.7 : 1}
                                style={{
                                  width: 38, height: 38, borderRadius: 19,
                                  alignItems: 'center', justifyContent: 'center',
                                  backgroundColor: active ? T.accent : 'transparent',
                                }}
                              >
                                <Text style={{
                                  fontSize: 15,
                                  fontWeight: active ? '700' : '500',
                                  color: active ? '#fff' : valid ? T.text : T.border,
                                }}>
                                  {d <= 31 ? d : ''}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Time: minute chips + hour list */}
                  {open === 'time' && (
                    <>
                      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 }}>
                        {MINUTE_OPTIONS.map(m => {
                          const active = selMinute === m;
                          return (
                            <TouchableOpacity
                              key={m}
                              onPress={() => setSelMinute(m)}
                              activeOpacity={0.7}
                              style={{
                                flex: 1, height: 36, borderRadius: 9,
                                alignItems: 'center', justifyContent: 'center',
                                backgroundColor: active ? T.accent : T.bg,
                                borderWidth: 0.5,
                                borderColor: active ? T.accent : T.border,
                              }}
                            >
                              <Text style={{ fontSize: 13, fontWeight: active ? '700' : '500', color: active ? '#fff' : T.text }}>
                                :{String(m).padStart(2, '0')}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <View style={{ height: 0.5, backgroundColor: T.border }} />
                      {Array.from({ length: 24 }, (_, h) => h).map((h) => {
                        const active = selHour === h;
                        const isLast = h === 23;
                        return (
                          <TouchableOpacity
                            key={h}
                            onPress={() => setSelHour(h)}
                            activeOpacity={0.6}
                            style={{
                              paddingVertical: 12, paddingHorizontal: 20,
                              flexDirection: 'row', alignItems: 'center',
                              backgroundColor: active ? T.accent + '12' : 'transparent',
                              borderBottomWidth: isLast ? 0 : 0.5,
                              borderBottomColor: T.border,
                            }}
                          >
                            <Text style={{ flex: 1, fontSize: 15, fontWeight: active ? '600' : '400', color: T.text }}>
                              {String(h).padStart(2, '0')}:{String(selMinute).padStart(2, '0')}
                            </Text>
                            {active && <Text style={{ color: T.accent, fontSize: 15, fontWeight: '700' }}>✓</Text>}
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}
                </ScrollView>
                <View style={{ height: 0.5, backgroundColor: T.border }} />
              </>
            )}
            </View>
            {/* ── Fixed footer — always at the same position ────────────────── */}
            <View style={{ paddingHorizontal: 20, paddingTop: 12, alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => switchMode(inputMode === 'hijri' ? 'gregorian' : 'hijri')}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              >
                <Text style={{ fontSize: 13, color: T.accent, fontWeight: '500' }}>
                  {inputMode === 'hijri'
                    ? 'Välj via gregorianskt datum'
                    : 'Välj Hijri-datum'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
              <TouchableOpacity
                onPress={handleConfirm}
                activeOpacity={0.85}
                disabled={saving}
                style={{
                  height: 50, borderRadius: 14,
                  backgroundColor: T.accent,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Spara påminnelse</Text>
                }
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}
