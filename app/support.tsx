import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  Linking, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Polyline, Line } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackButton from '../components/BackButton';
import { useTheme } from '../context/ThemeContext';

const SUPPORT_FS_KEY   = 'support-text-font-size-v1';
const SUPPORT_FS_STEPS = [11, 14, 16, 18, 22, 27, 32] as const; // default idx 2 (16px)

// ── External-link arrow icon ──────────────────────────────────────────────────
function ExternalLinkIcon({ color = '#fff', size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <Polyline points="15 3 21 3 21 9" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <Line x1="10" y1="14" x2="21" y2="3" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
function Divider({ color }: { color: string }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color, marginHorizontal: 0 }} />;
}

// ── Payment block ─────────────────────────────────────────────────────────────
function PaymentBlock({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ padding: 24, alignItems: 'center', gap: 14 }}>
      {children}
    </View>
  );
}

export default function SupportScreen() {
  const { theme: T } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [fsIdx, setFsIdx] = useState(2);
  const [showFontPanel, setShowFontPanel] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SUPPORT_FS_KEY).then(v => {
      if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0 && n < SUPPORT_FS_STEPS.length) setFsIdx(n); }
    });
  }, []);

  const decFs = useCallback(() => setFsIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(SUPPORT_FS_KEY, String(n)); return n; }), []);
  const incFs = useCallback(() => setFsIdx(i => { const n = Math.min(SUPPORT_FS_STEPS.length-1, i+1); AsyncStorage.setItem(SUPPORT_FS_KEY, String(n)); return n; }), []);
  const bodyFs = SUPPORT_FS_STEPS[fsIdx];

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Header */}
      <View style={[styles.header, {
        paddingTop: insets.top + 12,
        borderBottomColor: T.border,
        backgroundColor: T.bg,
      }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: T.text }]}>Stötta kallet</Text>
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
              {SUPPORT_FS_STEPS.map((_, i) => (
                <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i <= fsIdx ? T.accent : T.border }} />
              ))}
            </View>
            <TouchableOpacity onPress={incFs} disabled={fsIdx === SUPPORT_FS_STEPS.length - 1} activeOpacity={0.7}
              style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: fsIdx === SUPPORT_FS_STEPS.length - 1 ? T.textMuted : T.text }}>A</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro */}
        <View style={styles.intro}>
          <Text style={[styles.introTitle, { color: T.text }]}>Stötta kallet</Text>
          <Text style={[styles.introText, { fontSize: bodyFs, lineHeight: Math.round(bodyFs * 1.67), color: T.textMuted }]}>
            Genom att bli månadsgivare eller ge en gåva bidrar man till att stötta islam.nu och sprida gott.
          </Text>
          <Text style={[styles.introText, { fontSize: bodyFs, lineHeight: Math.round(bodyFs * 1.67), color: T.textMuted }]}>
            Arbetet på islam.nu möjliggörs genom bidrag från givare. Profeten ﷺ sade:
          </Text>
          <Text style={[styles.introSub, { fontSize: Math.max(11, bodyFs - 1), lineHeight: Math.round(bodyFs * 1.6), color: T.textMuted }]}>
            <Text style={{ fontStyle: 'italic' }}>
              "Den som vägleder till gott får samma belöning som den som utför handlingen."
            </Text>
            {' '}[Muslim]
          </Text>
        </View>

        {/* Payment card */}
        <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
          {/* Label */}
          <View style={{ paddingTop: 14, alignItems: 'center' }}>
            <Text style={[styles.cardLabel, { color: T.textMuted }]}>Ge en gåva</Text>
          </View>

          {/* Swish */}
          <PaymentBlock>
            <Image
              source={require('../assets/images/swish-logo.png')}
              style={styles.swishLogo}
              resizeMode="contain"
            />
            <TouchableOpacity
              onPress={() => Linking.openURL('https://app.swish.nu/1/p/sw/?sw=1236433940&msg=&src=qr')}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 15 }} />
              <Text style={[styles.paymentNumber, { color: T.accent, textDecorationLine: 'underline', textAlign: 'center', flex: 1 }]}>123 643 39 40</Text>
              <ExternalLinkIcon color={T.accent} size={15} />
            </TouchableOpacity>
          </PaymentBlock>

          <Divider color={T.border} />

          {/* Bankgiro */}
          <PaymentBlock>
            <Image
              source={require('../assets/images/bankgirot-logo.png')}
              style={styles.bgLogo}
              resizeMode="contain"
            />
            <Text style={[styles.paymentNumber, { color: T.text }]}>5323-2344</Text>
          </PaymentBlock>
        </View>

        {/* Månadsgivare CTA */}
        <View style={styles.ctaWrap}>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: T.accent }]}
            onPress={() => Linking.openURL('https://islam.nu/stod-oss/')}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaBtnText}>Eller bli månadsgivare</Text>
            <ExternalLinkIcon color="#fff" size={16} />
          </TouchableOpacity>
          <Text style={[styles.ctaHint, { color: T.textMuted }]}>Öppnas i din webbläsare</Text>
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
  intro: {
    padding: 20,
    paddingBottom: 8,
    alignItems: 'center',
  },
  introTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  introText: {
    fontSize: 15,
    lineHeight: 25,
    textAlign: 'center',
    marginBottom: 10,
  },
  introSub: {
    fontSize: 14,
    lineHeight: 24,
    textAlign: 'center',
  },
  card: {
    borderRadius: 18,
    marginHorizontal: 16,
    marginTop: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  // swish-logo.png: 400×143 → aspect 2.797 → at height 34 → width 95
  swishLogo: {
    width: 95,
    height: 34,
  },
  // bankgirot-logo.png: 494×157 → aspect 3.146 → at height 32 → width 101
  bgLogo: {
    width: 101,
    height: 32,
  },
  paymentNumber: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
  },
  ctaWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 14,
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  ctaHint: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 10,
  },
});
