import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackButton from '../components/BackButton';
import { useTheme } from '../context/ThemeContext';

const ABOUT_FS_KEY   = 'about-text-font-size-v1';
const ABOUT_FS_STEPS = [11, 14, 16, 18, 22, 27, 32] as const; // default idx 2 (16px)

const SECTIONS = [
  {
    title: 'Om Hidayah',
    body: 'Hidayah är en app som har utvecklats för att underlätta det dagliga religiösa livet för muslimer i Sverige. Den samlar flera viktiga funktioner på ett och samma ställe, såsom bönetider, dhikr, Allahs 99 namn, Koranen på svenska (översatt av Knut Bernström), en vägledning för Umrah, ruqyah, zakatberäkning, e-böcker samt frågesport.\n\nSyftet med Hidayah är att göra det enklare att söka kunskap, stärka sin tro och praktisera islam i vardagen.\n\nMaterialet för Allahs namn, ruqyah och e-böcker har hämtats från islam.nu. Må Allah belöna islam.nu rikligt för det värdefulla arbete och den kunskap som gjorts tillgänglig.',
  },
];

export default function AboutScreen() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [fsIdx, setFsIdx] = useState(2);
  const [showFontPanel, setShowFontPanel] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ABOUT_FS_KEY).then(v => {
      if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0 && n < ABOUT_FS_STEPS.length) setFsIdx(n); }
    });
  }, []);

  const decFs = useCallback(() => setFsIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(ABOUT_FS_KEY, String(n)); return n; }), []);
  const incFs = useCallback(() => setFsIdx(i => { const n = Math.min(ABOUT_FS_STEPS.length-1, i+1); AsyncStorage.setItem(ABOUT_FS_KEY, String(n)); return n; }), []);
  const bodyFs = ABOUT_FS_STEPS[fsIdx];

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Header */}
      <View style={[styles.header, {
        paddingTop: insets.top + 12,
        borderBottomColor: T.border,
        backgroundColor: T.bg,
      }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: T.text }]}>Om Hidayah</Text>
        <TouchableOpacity
          onPress={() => setShowFontPanel(p => !p)}
          style={{ width: 36, alignItems: 'flex-end' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"
            stroke={showFontPanel ? T.accent : T.textMuted}
            strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
            <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </Svg>
        </TouchableOpacity>
      </View>

      {/* Font size panel */}
      {showFontPanel && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.bg }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: T.textMuted }}>Textstorlek</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={decFs} disabled={fsIdx === 0} activeOpacity={0.7}
              style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: fsIdx === 0 ? T.textMuted : T.text }}>A</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {ABOUT_FS_STEPS.map((_, i) => (
                <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i <= fsIdx ? T.accent : T.border }} />
              ))}
            </View>
            <TouchableOpacity onPress={incFs} disabled={fsIdx === ABOUT_FS_STEPS.length - 1} activeOpacity={0.7}
              style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: fsIdx === ABOUT_FS_STEPS.length - 1 ? T.textMuted : T.text }}>A</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo hero */}
        <View style={[styles.hero, {
          backgroundColor: isDark ? `${T.accent}18` : `${T.accent}12`,
          borderBottomColor: T.border,
        }]}>
          <Image
            source={require('../assets/images/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.heroTitle, { color: T.text }]}>Hidayah</Text>
          <Text style={[styles.heroVersion, { color: T.textMuted }]}>Version 1.2.4</Text>
        </View>

        {/* Sections */}
        <View style={styles.sections}>
          {SECTIONS.map((s, i) => (
            <View key={i} style={styles.section}>
              <Text style={[styles.sectionLabel, { color: T.text }]}>{s.title}</Text>
              {s.body.split('\n\n').map((para, j) => (
                <Text key={j} style={[styles.sectionBody, { fontSize: bodyFs, lineHeight: Math.round(bodyFs * 1.73), color: T.textSecondary ?? T.textMuted, marginTop: j > 0 ? 12 : 0 }]}>
                  {para}
                </Text>
              ))}
            </View>
          ))}

          {/* Contact */}
          <View style={[styles.contactRow, { borderTopColor: T.border }]}>
            <Text style={[styles.contactLabel, { color: T.textMuted }]}>
              Vid buggar eller tekniska problem:
            </Text>
            <TouchableOpacity
              onPress={() => Linking.openURL('mailto:fatih.koker@outlook.com')}
              activeOpacity={0.7}
            >
              <Text style={[styles.contactEmail, { color: T.accent }]}>
                fatih.koker@outlook.com
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 20,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 14,
    letterSpacing: -0.3,
  },
  heroVersion: {
    fontSize: 13,
    marginTop: 4,
  },
  heroSub: {
    fontSize: 13,
    marginTop: 4,
  },
  sections: {
    padding: 20,
    gap: 28,
  },
  section: {
    gap: 0,
  },
  sectionLabel: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  sectionBody: {
    fontSize: 15,
    lineHeight: 26,
  },
  contactRow: {
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  contactLabel: {
    fontSize: 13,
    lineHeight: 20,
  },
  contactEmail: {
    fontSize: 15,
    fontWeight: '600',
  },
});
