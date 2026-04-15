/**
 * OnboardingFlow — premium 5-step first-launch onboarding.
 *
 * Steps:
 *   1. Welcome
 *   2. Notification permission  (only on tap — never auto-triggered)
 *   3. Location / GPS           (only on tap — never auto-triggered)
 *      └─ Manual city search    (CitySearchModal, same component as Settings)
 *   4. Background location      (only on tap — never auto-triggered)
 *   5. AirPlay / local network  (informational — iOS asks automatically)
 *
 * On completion: writes islamnu_onboarding_completed='1' and
 *               islamnu_location_onboarded='1' to AsyncStorage.
 *
 * Design: dark Islamic premium — gold accent (#C9A84C), deep green buttons.
 */

import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestNotificationPermission, savePushToken } from '../services/notifications';
import { nativeReverseGeocode } from '../services/geocoding';
import CitySearchModal, { type CityResult } from './CitySearchModal';

export const ONBOARDING_COMPLETED_KEY = 'islamnu_onboarding_completed';

// ── Design tokens ─────────────────────────────────────────────────────────────

const GOLD  = '#C9A84C';
const GREEN = '#668468';

const MODAL_THEME = {
  bg:         '#000000',
  card:       '#1C1C1E',
  border:     'rgba(255,255,255,0.1)',
  text:       '#FFFFFF',
  textMuted:  '#8E8E93',
  accent:     GREEN,
  accentGlow: 'rgba(102,132,104,0.2)',
  separator:  'rgba(255,255,255,0.08)',
};

// ── Step definitions ──────────────────────────────────────────────────────────

interface StepDef {
  id:             'welcome' | 'notifications' | 'location' | 'background';
  image:          ReturnType<typeof require>;
  title:          string;
  body:           string;
  primaryLabel:   string;
  secondaryLabel?: string;
  skipLabel?:     string;
}

const STEPS: StepDef[] = [
  {
    id:           'welcome',
    image:        require('../assets/onboarding/welcome_hidayah.png'),
    title:        'Välkommen till\nHidayah',
    body:         'Din islamiska guide för bönetider, dhikr, Quran och mer – anpassad för Sverige.',
    primaryLabel: 'Kom igång',
  },
  {
    id:           'notifications',
    image:        require('../assets/onboarding/permission_notifications.png'),
    title:        'Böne-påminnelser',
    body:         'Få en notis när det är dags för bön. Vi skickar aldrig onödiga meddelanden.',
    primaryLabel: 'Tillåt notiser',
    skipLabel:    'Hoppa över',
  },
  {
    id:            'location',
    image:         require('../assets/onboarding/permission_location.png'),
    title:         'Din böneplats',
    body:          'Hidayah använder din plats för att beräkna korrekta bönetider för just din stad.',
    primaryLabel:  'Tillåt GPS',
    secondaryLabel:'Välj stad manuellt',
    skipLabel:     'Hoppa över',
  },
  {
    id:           'background',
    image:        require('../assets/onboarding/permission_widgets_background_location.png'),
    title:        'Widget-uppdateringar',
    body:         'Tillåt bakgrundsplats så att din widget alltid visar rätt bönetider, även när appen är stängd.',
    primaryLabel: 'Kom igång',
    skipLabel:    'Hoppa över',
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingFlow({ onDone, onNotificationsGranted }: { onDone: () => void; onNotificationsGranted?: () => void }) {
  const insets                            = useSafeAreaInsets();
  const [step,            setStep]        = useState(0);
  const [loading,         setLoading]     = useState(false);
  const [cityModalOpen,   setCityModal]   = useState(false);
  const [selectedCity,    setSelectedCity] = useState('');

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const finish = useCallback(async () => {
    try {
      await AsyncStorage.multiSet([
        [ONBOARDING_COMPLETED_KEY, '1'],
        ['islamnu_location_onboarded', '1'],
      ]);
    } catch {}
    onDone();
  }, [onDone]);

  const goNext = useCallback(() => {
    setStep(s => {
      const next = s + 1;
      if (next >= STEPS.length) { finish(); return s; }
      return next;
    });
  }, [finish]);

  // ── Button handlers ──────────────────────────────────────────────────────────

  const handlePrimary = useCallback(async () => {
    const id = STEPS[step].id;

    if (id === 'welcome') {
      goNext();
      return;
    }

    if (id === 'notifications') {
      setLoading(true);
      const granted = await requestNotificationPermission().catch(() => false);
      if (granted) {
        savePushToken(); // fire-and-forget — saves token to Supabase push_tokens
        // Default dhikr reminder to ON when user approves notifications.
        // Write to both storage keys so AppContext and Settings screen stay in sync.
        Promise.all([
          AsyncStorage.getItem('andalus_app_state').then(raw => {
            const prev = raw ? JSON.parse(raw) : {};
            return AsyncStorage.setItem('andalus_app_state', JSON.stringify({
              ...prev,
              settings: { ...(prev.settings ?? {}), dhikrReminder: true },
            }));
          }),
          AsyncStorage.getItem('andalus_settings').then(raw => {
            const prev = raw ? JSON.parse(raw) : {};
            return AsyncStorage.setItem('andalus_settings', JSON.stringify({ ...prev, dhikrReminder: true }));
          }),
        ]).catch(() => {});
        onNotificationsGranted?.();
      }
      setLoading(false);
      goNext();
      return;
    }

    if (id === 'location') {
      setLoading(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const geo = await nativeReverseGeocode(loc.coords.latitude, loc.coords.longitude);
          const city = geo.subLocality && geo.city && geo.subLocality !== geo.city
            ? `${geo.subLocality}, ${geo.city}`
            : geo.city || geo.subLocality || '';
          await AsyncStorage.setItem('andalus_location', JSON.stringify({
            lat: loc.coords.latitude, lng: loc.coords.longitude, city, country: geo.country,
          }));
          await AsyncStorage.setItem('andalus_settings_updated', Date.now().toString());
          setSelectedCity(city);
        }
      } catch {}
      setLoading(false);
      goNext();
      return;
    }

    if (id === 'background') {
      setLoading(true);
      try { await Location.requestBackgroundPermissionsAsync(); } catch {}
      setLoading(false);
      goNext();
      return;
    }

    goNext();
  }, [step, goNext, finish]);

  const handleSkip = useCallback(() => {
    goNext();
  }, [goNext]);

  const handleManualCity = useCallback(() => {
    setCityModal(true);
  }, []);

  const handleSelectCity = useCallback(async (r: CityResult) => {
    try {
      await AsyncStorage.setItem('andalus_location', JSON.stringify({
        lat: r.latitude, lng: r.longitude, city: r.city, country: r.country,
      }));
      await AsyncStorage.setItem('andalus_settings_updated', Date.now().toString());
    } catch {}
    setSelectedCity(r.city);
    setCityModal(false);
    goNext();
  }, [goNext]);

  // ── Render ───────────────────────────────────────────────────────────────────

  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" statusBarTranslucent>
      <ImageBackground source={current.image} style={styles.bg} resizeMode="cover">

        <View style={[styles.container, { paddingTop: insets.top + 20 }]}>

          {/* Step indicator */}
          <View style={styles.dotsRow}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i === step ? GOLD : 'rgba(255,255,255,0.22)',
                    width:           i === step ? 28   : 18,
                  },
                ]}
              />
            ))}
          </View>

          {/* Background image shows through here */}
          <View style={{ flex: 1 }} />

          {/* Buttons — float at the bottom */}
          <View style={[styles.btnSection, { paddingBottom: Math.max(insets.bottom, 28) + 36 }]}>
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={GOLD} size="large" />
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handlePrimary}
                  activeOpacity={0.82}
                >
                  <Text style={styles.primaryBtnText}>{current.primaryLabel}</Text>
                </TouchableOpacity>

                {current.secondaryLabel != null && (
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={handleManualCity}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.secondaryBtnText}>{current.secondaryLabel}</Text>
                  </TouchableOpacity>
                )}

                {current.skipLabel != null && (
                  <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.6}>
                    <Text style={styles.skipText}>{current.skipLabel}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

        </View>
      </ImageBackground>

      {/* City search modal (shared with Settings) */}
      <CitySearchModal
        visible={cityModalOpen}
        onClose={() => setCityModal(false)}
        onSelect={handleSelectCity}
        currentCity={selectedCity}
        T={MODAL_THEME}
      />
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex:            1,
    paddingHorizontal: 22,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    alignSelf:     'center',
  },
  dot: {
    height:       4,
    borderRadius: 2,
  },
  btnSection: {
    paddingTop: 16,
  },
  loadingRow: {
    height:          58,
    alignItems:      'center',
    justifyContent:  'center',
  },
  primaryBtn: {
    backgroundColor: GREEN,
    borderRadius:    14,
    paddingVertical: 15,
    alignItems:      'center',
    marginBottom:    10,
  },
  primaryBtnText: {
    color:         '#FFFFFF',
    fontSize:      16,
    fontWeight:    '600',
    letterSpacing: 0.15,
  },
  secondaryBtn: {
    borderRadius:    14,
    paddingVertical: 13,
    alignItems:      'center',
    marginBottom:    8,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.18)',
  },
  secondaryBtnText: {
    color:      'rgba(255,255,255,0.82)',
    fontSize:   15,
    fontWeight: '500',
  },
  skipBtn: {
    alignItems:      'center',
    paddingVertical: 10,
    marginTop:       2,
  },
  skipText: {
    color:      'rgba(255,255,255,0.36)',
    fontSize:   14,
    fontWeight: '500',
  },
});
