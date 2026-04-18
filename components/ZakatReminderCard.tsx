/**
 * ZakatReminderCard
 *
 * Shown at the bottom of the Zakat result step (step 6).
 * Lets the user configure an annual Hijri-based Zakat reminder.
 *
 * When OFF: minimal toggle row.
 * When ON:  tappable Hijri date → picker modal + advance selector + help notes.
 */

import {
  View, Text, Switch, TouchableOpacity,
  ActivityIndicator, Alert, Modal, ScrollView,
  Platform, UIManager,
} from 'react-native';
import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useZakatReminder } from '../hooks/useZakatReminder';
import { ADVANCE_OPTIONS } from '../services/zakatReminderService';
import { HIJRI_MONTH_NAMES } from '../services/hijriCalendarService';
import { requestNotificationPermission } from '../services/notifications';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ── Hijri calendar data ─────────────────────────────────────────────────────
// Standard (approximate) max days per Hijri month.
// Odd months = 30 days, even months = 29 days; Dhul-Hijjah shown as 30.
const HIJRI_MONTH_MAX_DAYS: Record<number, number> = {
  1: 30, 2: 29, 3: 30, 4: 29, 5: 30, 6: 29,
  7: 30, 8: 29, 9: 30, 10: 29, 11: 30, 12: 30,
};

const ALL_MONTHS = Object.entries(HIJRI_MONTH_NAMES).map(([num, name]) => ({
  num: parseInt(num, 10),
  name,
}));

// ── Sub-component: Hijri date picker modal ──────────────────────────────────

function HijriDatePickerModal({
  visible,
  currentDay,
  currentMonth,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  currentDay: number;
  currentMonth: number;
  onConfirm: (day: number, month: number, monthName: string) => void;
  onClose: () => void;
}) {
  const { theme: T } = useTheme();
  const [selMonth, setSelMonth] = useState(currentMonth);
  const [selDay,   setSelDay]   = useState(currentDay);

  const maxDays = HIJRI_MONTH_MAX_DAYS[selMonth] ?? 30;

  const handleMonthSelect = (month: number) => {
    setSelMonth(month);
    // Clamp day to new month's maximum
    const max = HIJRI_MONTH_MAX_DAYS[month] ?? 30;
    if (selDay > max) setSelDay(max);
  };

  const handleConfirm = () => {
    onConfirm(selDay, selMonth, HIJRI_MONTH_NAMES[selMonth] ?? '');
    onClose();
  };

  // Build day cells: 1..maxDays, laid out in rows of 5
  const dayCells = Array.from({ length: 30 }, (_, i) => i + 1);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        activeOpacity={1}
        onPress={onClose}
      />

      {/* Sheet */}
      <View style={{
        backgroundColor: T.card,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        maxHeight: '88%',
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
        borderWidth: 0.5,
        borderBottomWidth: 0,
        borderColor: T.border,
      }}>
        {/* Drag handle */}
        <View style={{
          width: 36, height: 4, borderRadius: 2,
          backgroundColor: T.border,
          alignSelf: 'center',
          marginTop: 10, marginBottom: 14,
        }} />

        {/* Header */}
        <View style={{
          paddingHorizontal: 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.text }}>
            Välj Hijri-datum
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={{
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: T.accentGlow,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 16, color: T.textMuted, lineHeight: 20, marginTop: -1 }}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 0.5, backgroundColor: T.border, marginTop: 10 }} />

        <ScrollView showsVerticalScrollIndicator={false}>

          {/* ── Month section ─────────────────────────────────────── */}
          <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 }}>
            <Text style={{
              fontSize: 11, fontWeight: '700',
              color: T.textMuted, letterSpacing: 1.1,
              marginBottom: 10,
            }}>
              MÅNAD
            </Text>
          </View>

          {ALL_MONTHS.map((m, idx) => {
            const active = selMonth === m.num;
            const isLast = idx === ALL_MONTHS.length - 1;
            return (
              <TouchableOpacity
                key={m.num}
                onPress={() => handleMonthSelect(m.num)}
                activeOpacity={0.6}
                style={{
                  paddingVertical: 13,
                  paddingHorizontal: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: active ? T.accent + '12' : 'transparent',
                  borderBottomWidth: isLast ? 0 : 0.5,
                  borderBottomColor: T.border,
                }}
              >
                <Text style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: active ? '600' : '400',
                  color: T.text,
                }}>
                  {m.name}
                </Text>
                <View style={{
                  width: 22, height: 22, borderRadius: 11,
                  backgroundColor: active ? T.accent : 'transparent',
                  borderWidth: active ? 0 : 1.5,
                  borderColor: T.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {active && (
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}

          {/* ── Day section ───────────────────────────────────────── */}
          <View style={{
            height: 0.5, backgroundColor: T.border,
            marginTop: 4, marginBottom: 0,
          }} />

          <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
            <Text style={{
              fontSize: 11, fontWeight: '700',
              color: T.textMuted, letterSpacing: 1.1,
              marginBottom: 14,
            }}>
              DAG
            </Text>

            {/* 5-column day grid */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {dayCells.map(d => {
                const valid  = d <= maxDays;
                const active = selDay === d && valid;
                return (
                  <TouchableOpacity
                    key={d}
                    onPress={() => valid && setSelDay(d)}
                    activeOpacity={valid ? 0.7 : 1}
                    style={{
                      width: 48, height: 42,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active
                        ? T.accent
                        : valid
                          ? T.bg
                          : 'transparent',
                      borderWidth: valid ? 0.5 : 0,
                      borderColor: active ? T.accent : T.border,
                      opacity: valid ? 1 : 0,
                    }}
                  >
                    <Text style={{
                      fontSize: 15,
                      fontWeight: active ? '700' : '400',
                      color: active ? '#fff' : T.text,
                    }}>
                      {d}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Confirm button */}
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
            <TouchableOpacity
              onPress={handleConfirm}
              activeOpacity={0.85}
              style={{
                height: 50,
                borderRadius: 14,
                backgroundColor: T.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                Välj datum
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 12 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main card ───────────────────────────────────────────────────────────────

export default function ZakatReminderCard() {
  const { theme: T } = useTheme();
  const {
    settings, loading,
    enable, disable, updateAdvanceDays, updateHijriDate,
  } = useZakatReminder();

  const [pickerVisible, setPickerVisible] = useState(false);

  const isEnabled = settings?.enabled ?? false;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleToggle = async (value: boolean) => {
    if (value) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Notiser nekade',
          'Aktivera notiser för Hidayah i iOS-inställningar för att få Zakat-påminnelser.',
          [{ text: 'OK' }],
        );
        return;
      }
      const success = await enable(7);
      if (!success) {
        Alert.alert(
          'Kunde inte aktivera',
          'Kunde inte hämta Hijri-datum. Kontrollera internetanslutningen och försök igen.',
          [{ text: 'OK' }],
        );
      }
    } else {
      await disable();
    }
  };

  const handleDateConfirm = (day: number, month: number, monthName: string) => {
    updateHijriDate(day, month, monthName);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <View style={{
        backgroundColor: T.card,
        borderRadius: 14,
        borderWidth: 0.5,
        borderColor: T.border,
        padding: 14,
        marginBottom: 16,
        marginTop: 4,
      }}>
        {/* Section label */}
        <Text style={{
          fontSize: 11,
          fontWeight: '700',
          color: T.textMuted,
          letterSpacing: 1.1,
          marginBottom: 12,
        }}>
          ÅRLIG PÅMINNELSE
        </Text>

        {/* Toggle row */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: T.text }}>
            Påminn mig varje år
          </Text>
          {loading ? (
            <ActivityIndicator size="small" color={T.accent} />
          ) : (
            <Switch
              value={isEnabled}
              onValueChange={handleToggle}
              trackColor={{ false: T.border, true: T.accent }}
              thumbColor="#fff"
              ios_backgroundColor={T.border}
            />
          )}
        </View>

        {/* Expanded panel — only when enabled */}
        {isEnabled && settings && !loading && (
          <>
            <View style={{ height: 0.5, backgroundColor: T.border, marginVertical: 14 }} />

            {/* Hijri date — tappable row */}
            <TouchableOpacity
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: T.bg,
                borderRadius: 10,
                borderWidth: 0.5,
                borderColor: T.border,
                paddingVertical: 12,
                paddingHorizontal: 14,
                marginBottom: 14,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: T.textMuted, marginBottom: 2 }}>
                  Hijri-datum
                </Text>
                <Text style={{ fontSize: 16, fontWeight: '600', color: T.text }}>
                  {settings.hijriDay} {settings.hijriMonthName}
                </Text>
              </View>
              <Text style={{ fontSize: 20, color: T.textMuted }}>›</Text>
            </TouchableOpacity>

            {/* Advance selector */}
            <Text style={{
              fontSize: 13,
              color: T.textMuted,
              fontWeight: '500',
              marginBottom: 10,
            }}>
              Påminn mig
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
              {ADVANCE_OPTIONS.map(opt => {
                const active = settings.advanceDays === opt.days;
                return (
                  <TouchableOpacity
                    key={opt.days}
                    onPress={() => updateAdvanceDays(opt.days)}
                    activeOpacity={0.7}
                    style={{
                      paddingHorizontal: 11,
                      paddingVertical: 7,
                      borderRadius: 9,
                      borderWidth: 0.5,
                      borderColor: active ? T.accent : T.border,
                      backgroundColor: active ? T.accentGlow : 'transparent',
                    }}
                  >
                    <Text style={{
                      fontSize: 12,
                      fontWeight: active ? '700' : '500',
                      color: active ? T.accent : T.textMuted,
                    }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Help notes */}
            <View style={{ gap: 5 }}>
              <Text style={{ fontSize: 12, color: T.textMuted, lineHeight: 17 }}>
                Du får alltid även en påminnelse på själva dagen.
              </Text>
              <Text style={{ fontSize: 12, color: T.textMuted, lineHeight: 17 }}>
                Denna inställning sparas endast lokalt på din enhet.
              </Text>
              <Text style={{ fontSize: 12, color: T.textMuted, lineHeight: 17, opacity: 0.65 }}>
                Hijri-datum kan variera beroende på beräkningsmetod och lokal observation.
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Date picker modal — rendered outside the card so it covers full screen */}
      {isEnabled && settings && (
        <HijriDatePickerModal
          visible={pickerVisible}
          currentDay={settings.hijriDay}
          currentMonth={settings.hijriMonth}
          onConfirm={handleDateConfirm}
          onClose={() => setPickerVisible(false)}
        />
      )}
    </>
  );
}
