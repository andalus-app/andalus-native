/**
 * ZakatReminderCard
 *
 * Shown at the bottom of the Zakat result step (step 6).
 * Lets the user configure an annual Hijri-based Zakat reminder.
 *
 * When OFF: minimal toggle row.
 * When ON:  tappable date+time row → HijriDatePickerModal.
 */

import {
  View, Text, Switch, TouchableOpacity,
  ActivityIndicator, Alert, Platform, UIManager,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useZakatReminder } from '../hooks/useZakatReminder';
import { ADVANCE_OPTIONS } from '../services/zakatReminderService';
import { requestNotificationPermission } from '../services/notifications';
import HijriDatePickerModal from './HijriDatePickerModal';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function ZakatReminderCard() {
  const { theme: T } = useTheme();
  const {
    settings, loading,
    enable, disable, updateAdvanceDays, updateHijriDate, updateReminderTime,
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

  // Sequential await prevents the race condition where both functions call
  // loadZakatReminderSettings() concurrently and overwrite each other's saves.
  const handlePickerConfirm = useCallback(async (
    day: number, month: number, monthName: string, hour: number, minute: number,
  ) => {
    await updateHijriDate(day, month, monthName);
    await updateReminderTime(hour, minute);
  }, [updateHijriDate, updateReminderTime]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const timeFmt = settings
    ? `${String(settings.reminderTimeHour).padStart(2, '0')}:${String(settings.reminderTimeMinute).padStart(2, '0')}`
    : '';

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
          fontSize: 11, fontWeight: '700',
          color: T.textMuted, letterSpacing: 1.1,
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

            {/* Combined date + time row — tappable */}
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
                  Datum &amp; tid
                </Text>
                <Text style={{ fontSize: 16, fontWeight: '600', color: T.text }}>
                  {settings.hijriDay} {settings.hijriMonthName} · {timeFmt}
                </Text>
              </View>
              <Text style={{ fontSize: 20, color: T.textMuted }}>›</Text>
            </TouchableOpacity>

            {/* Advance selector */}
            <Text style={{ fontSize: 13, color: T.textMuted, fontWeight: '500', marginBottom: 10 }}>
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
                      paddingHorizontal: 11, paddingVertical: 7,
                      borderRadius: 9, borderWidth: 0.5,
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

      <HijriDatePickerModal
        visible={pickerVisible}
        currentDay={settings?.hijriDay ?? 1}
        currentMonth={settings?.hijriMonth ?? 1}
        currentHour={settings?.reminderTimeHour ?? 10}
        currentMinute={settings?.reminderTimeMinute ?? 0}
        onConfirm={handlePickerConfirm}
        onClose={() => setPickerVisible(false)}
      />
    </>
  );
}
