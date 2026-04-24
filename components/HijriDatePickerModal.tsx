/**
 * HijriDatePickerModal
 *
 * Combined Hijri date + time picker sheet.
 * Three inline dropdowns (Månad | Dag | Tid) that expand in place.
 * After saving: animated checkmark + "Påminnelse aktiverad".
 *
 * Used by:
 *   - components/ZakatReminderCard.tsx  (inside the Zakat calculator)
 *   - app/settings.tsx                  (direct first-time setup from Settings)
 */

import {
  View, Text, TouchableOpacity, Modal, ScrollView,
  Platform, Animated, ActivityIndicator,
} from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { HIJRI_MONTH_NAMES } from '../services/hijriCalendarService';

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

type ActiveDropdown = 'month' | 'day' | 'time' | null;

export type HijriDatePickerProps = {
  visible: boolean;
  currentDay: number;
  currentMonth: number;
  currentHour: number;
  currentMinute: number;
  /** Awaitable — modal waits for this to finish before showing the checkmark. */
  onConfirm: (day: number, month: number, monthName: string, hour: number, minute: number) => Promise<void>;
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
  const [selMonth,  setSelMonth]  = useState(currentMonth);
  const [selDay,    setSelDay]    = useState(currentDay);
  const [selHour,   setSelHour]   = useState(currentHour);
  const [selMinute, setSelMinute] = useState(currentMinute);
  const [open,      setOpen]      = useState<ActiveDropdown>('month');
  const [saved,     setSaved]     = useState(false);
  const [saving,    setSaving]    = useState(false);

  const checkScale   = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity  = useRef(new Animated.Value(0)).current;

  // Reset every time the modal opens
  useEffect(() => {
    if (visible) {
      setSelMonth(currentMonth);
      setSelDay(currentDay);
      setSelHour(currentHour);
      setSelMinute(currentMinute);
      setSaved(false);
      setSaving(false);
      setOpen('month');
      checkScale.setValue(0);
      checkOpacity.setValue(0);
      textOpacity.setValue(0);
    }
  }, [visible]);

  const maxDays   = HIJRI_MONTH_MAX_DAYS[selMonth] ?? 30;
  const monthName = HIJRI_MONTH_NAMES[selMonth] ?? '';
  const timeFmt   = `${String(selHour).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}`;

  const handleMonthSelect = (month: number) => {
    setSelMonth(month);
    const max = HIJRI_MONTH_MAX_DAYS[month] ?? 30;
    if (selDay > max) setSelDay(max);
  };

  const handleConfirm = async () => {
    if (saving || saved) return;
    setSaving(true);
    await onConfirm(selDay, selMonth, HIJRI_MONTH_NAMES[selMonth] ?? '', selHour, selMinute);
    setSaving(false);
    setSaved(true);

    Animated.parallel([
      Animated.timing(checkOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(checkScale,   { toValue: 1, bounciness: 10, useNativeDriver: true }),
    ]).start(() => {
      Animated.timing(textOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });

    setTimeout(onClose, 1600);
  };

  const toggle = (d: Exclude<ActiveDropdown, null>) => {
    setOpen(prev => (prev === d ? null : d));
  };

  // ── Dropdown selector button ───────────────────────────────────────────────
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Spacer — no backdrop */}
      <TouchableOpacity style={{ flex: 1, backgroundColor: 'transparent' }} activeOpacity={1} onPress={onClose} />

      {/* Sheet */}
      <View style={{
        backgroundColor: T.card,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        maxHeight: '86%',
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
        borderWidth: 0.5,
        borderBottomWidth: 0,
        borderColor: T.border,
      }}>
        {/* Drag handle */}
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, alignSelf: 'center', marginTop: 10, marginBottom: 14 }} />

        {/* Header */}
        <View style={{ paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.text }}>Välj Hijri-datum</Text>
          <TouchableOpacity onPress={onClose} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.accentGlow, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, color: T.textMuted, lineHeight: 20, marginTop: -1 }}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 0.5, backgroundColor: T.border, marginTop: 10 }} />

        {/* ── Success state ──────────────────────────────────────────────────── */}
        {saved ? (
          <Animated.View style={{ opacity: checkOpacity, alignItems: 'center', justifyContent: 'center', paddingVertical: 44 }}>
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
        ) : (
          <>
            {/* ── Three selector buttons ──────────────────────────────────── */}
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 }}>
              <DropBtn id="month" label="MÅNAD" value={monthName}       flex={2} />
              <DropBtn id="day"   label="DAG"   value={String(selDay)}  flex={1} />
              <DropBtn id="time"  label="TID"   value={timeFmt}         flex={1} />
            </View>

            {/* ── Expandable dropdown list ────────────────────────────────── */}
            {open !== null && (
              <>
                <View style={{ height: 0.5, backgroundColor: T.border }} />
                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>

                  {/* Month list */}
                  {open === 'month' && ALL_HIJRI_MONTHS.map((m, idx) => {
                    const active = selMonth === m.num;
                    const isLast = idx === ALL_HIJRI_MONTHS.length - 1;
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

                  {/* Day list */}
                  {open === 'day' && Array.from({ length: maxDays }, (_, i) => i + 1).map((d) => {
                    const active = selDay === d;
                    const isLast = d === maxDays;
                    return (
                      <TouchableOpacity
                        key={d}
                        onPress={() => setSelDay(d)}
                        activeOpacity={0.6}
                        style={{
                          paddingVertical: 12, paddingHorizontal: 20,
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: active ? T.accent + '12' : 'transparent',
                          borderBottomWidth: isLast ? 0 : 0.5,
                          borderBottomColor: T.border,
                        }}
                      >
                        <Text style={{ flex: 1, fontSize: 15, fontWeight: active ? '600' : '400', color: T.text }}>{d}</Text>
                        {active && <Text style={{ color: T.accent, fontSize: 15, fontWeight: '700' }}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}

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
                <View style={{ height: 0.5, backgroundColor: T.border, marginTop: 4 }} />
              </>
            )}

            {/* Save button */}
            <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
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
