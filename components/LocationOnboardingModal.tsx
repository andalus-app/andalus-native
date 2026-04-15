/**
 * LocationOnboardingModal
 *
 * Visas vid första appstart för att begära platsbehörigheter.
 * Steg:
 *   1. Förklaring — varför plats behövs
 *   2. Begär foreground-behörighet (iOS systemdialog)
 *   3. Begär background-behörighet ("Alltid tillåt", för widget)
 *   4. Hämtar GPS-position och sparar
 *   5. Markerar onboarding som klar (islamnu_location_onboarded)
 *
 * Kan också hoppas över — appen fungerar utan plats (manuell stad-sök).
 */

import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useApp } from '../context/AppContext';
import Svg, { Path, Circle } from 'react-native-svg';

export const LOCATION_ONBOARDED_KEY = 'islamnu_location_onboarded';

type Step = 'intro' | 'requesting' | 'background' | 'fetching' | 'done' | 'denied';

export default function LocationOnboardingModal({ onDone }: { onDone: () => void }) {
  const { theme: T, isDark } = useTheme();
  const { dispatch } = useApp();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('intro');

  const finish = useCallback(async () => {
    await AsyncStorage.setItem(LOCATION_ONBOARDED_KEY, '1');
    onDone();
  }, [onDone]);

  const handleAllow = useCallback(async () => {
    setStep('requesting');
    try {
      // 1. Foreground (WhenInUse) — krävs för att appen ska fungera
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        setStep('denied');
        return;
      }

      // 2. Background (Always) — krävs för widgeten
      setStep('background');
      try {
        await Location.requestBackgroundPermissionsAsync();
      } catch {
        // Om nekas fortsätter vi ändå — appen fungerar med foreground
      }

      // 3. Hämta GPS-position
      setStep('fetching');
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // Reverse geocode
      const geo = await Location.reverseGeocodeAsync({
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      const place = geo[0];
      const city    = place?.city ?? place?.subregion ?? place?.region ?? 'Okänd stad';
      const country = place?.country ?? '';

      dispatch({ type: 'SET_LOCATION', payload: {
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
        city,
        country,
      }});
    } catch {
      // Kunde inte hämta plats — hoppa över
    }

    await finish();
  }, [dispatch, finish]);

  const handleSkip = useCallback(async () => {
    await finish();
  }, [finish]);

  const isLoading = step === 'requesting' || step === 'background' || step === 'fetching';

  function loadingLabel() {
    if (step === 'requesting')  return 'Begär platsbehörighet…';
    if (step === 'background')  return 'Begär bakgrundsbehörighet…';
    if (step === 'fetching')    return 'Hämtar din position…';
    return '';
  }

  return (
    <Modal transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        {/* Glasmorfism bakgrund */}
        <BlurView
          intensity={isDark ? 60 : 80}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)' }]} />

        <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
          {/* Ikon */}
          <View style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(102,132,104,0.18)' : 'rgba(36,100,93,0.10)' }]}>
            <Svg width={36} height={36} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                fill="#668468"
              />
              <Circle cx="12" cy="9" r="2.5" fill="#fff" />
            </Svg>
          </View>

          <Text style={[styles.title, { color: T.text }]}>Tillåt platsåtkomst</Text>

          <Text style={[styles.body, { color: T.textSecondary ?? T.text }]}>
            Hidayah använder din plats för att beräkna korrekta bönetider för din stad.
          </Text>

          {/* Förmånslista */}
          <View style={styles.benefits}>
            <BenefitRow icon="clock" text="Korrekta bönetider för din plats" T={T} />
            <BenefitRow icon="widget" text="Widgeten uppdateras automatiskt när du reser" T={T} />
            <BenefitRow icon="notify" text="Bönepåminnelser på rätt tid" T={T} />
          </View>

          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#668468" />
              <Text style={[styles.loadingText, { color: T.textMuted ?? '#8E8E93' }]}>
                {loadingLabel()}
              </Text>
            </View>
          ) : step === 'denied' ? (
            <>
              <Text style={[styles.deniedText, { color: T.textMuted ?? '#8E8E93' }]}>
                Platsbehörighet nekades. Aktivera den i Inställningar → Hidayah → Plats.
              </Text>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: '#668468' }]}
                onPress={finish}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryBtnText}>Fortsätt ändå</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: '#668468' }]}
                onPress={handleAllow}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryBtnText}>Tillåt plats</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleSkip}
                activeOpacity={0.7}
              >
                <Text style={[styles.skipText, { color: T.textMuted ?? '#8E8E93' }]}>
                  Hoppa över
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function BenefitRow({ icon, text, T }: { icon: string; text: string; T: any }) {
  return (
    <View style={styles.benefitRow}>
      <View style={[styles.benefitDot, { backgroundColor: '#668468' }]} />
      <Text style={[styles.benefitText, { color: T.textSecondary ?? T.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 0.5,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
  },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  benefits: {
    gap: 12,
    marginBottom: 28,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  benefitDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginTop: 5,
    flexShrink: 0,
  },
  benefitText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  primaryBtn: {
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  loadingText: {
    fontSize: 14,
  },
  deniedText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20,
  },
});
