/**
 * Hajj Transition — bridge screen between Umrah completion and Hajj day 8.
 *
 * Only reachable when the Umrah Guide was opened from the Hajj Guide
 * (returnToHajj helper in umrah.tsx). Standalone Umrah never routes here.
 *
 * On "Fortsätt till Hadj": router.replace('/hajj?targetStep=...')
 * so neither this screen nor the completed Umrah Guide remain on the stack.
 */

import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { umrahLight } from '@/components/umrah/umrahTheme';
import SvgIcon from '@/components/SvgIcon';

export default function HajjTransitionScreen() {
  const router      = useRouter();
  const insets      = useSafeAreaInsets();
  const { targetStep } = useLocalSearchParams<{ targetStep?: string }>();

  const T           = umrahLight;
  const destination = targetStep ?? 'day8_mina';

  const handleContinue = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push(`/hajj?targetStep=${destination}` as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8, borderBottomColor: T.separator }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={[styles.backBtn, { borderColor: T.border, backgroundColor: T.card }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.backChevron, { color: T.text }]}>‹</Text>
        </TouchableOpacity>
      </View>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <View style={styles.body}>

        {/* Decorative icon */}
        <View style={[styles.iconCircle, { backgroundColor: T.accentSoft, borderColor: T.accentBorder }]}>
          <SvgIcon name="hajj" size={32} color={T.accent} />
        </View>

        {/* Subtle badge */}
        <View style={[styles.badge, { backgroundColor: T.accentSoft, borderColor: T.accentBorder }]}>
          <Text style={[styles.badgeText, { color: T.accent }]}>Del av Tamattu'</Text>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: T.text }]}>
          Du är nu klar med din Umrah
        </Text>

        {/* Body text */}
        <Text style={[styles.bodyText, { color: T.textSecondary }]}>
          Du har fullbordat din Umrah som en del av Tamattu'. Nästa steg i din pilgrimsfärd är Hadj.
        </Text>

      </View>

      {/* ── CTA anchored at bottom ───────────────────────────────────────────── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          onPress={handleContinue}
          activeOpacity={0.7}
          style={[styles.ctaBtn, { backgroundColor: T.accent }]}
        >
          <Text style={styles.ctaText}>Fortsätt till Hadj</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // Top bar — matches guide screens
  topBar: {
    paddingHorizontal: 16,
    paddingBottom:     12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width:          36,
    height:         36,
    borderRadius:   18,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
  },
  backChevron: {
    fontSize:   20,
    lineHeight: 22,
    marginTop:  -1,
  },

  // Body — takes all available space, centers content vertically
  body: {
    flex:              1,
    paddingHorizontal: 32,
    justifyContent:    'center',
    gap:               16,
  },

  // Decorative icon circle
  iconCircle: {
    width:          68,
    height:         68,
    borderRadius:   34,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom:   4,
  },

  // "Del av Tamattu'" badge
  badge: {
    alignSelf:         'flex-start',
    borderRadius:      20,
    borderWidth:       0.5,
    paddingHorizontal: 12,
    paddingVertical:   5,
  },
  badgeText: {
    fontSize:      12,
    fontWeight:    '600',
    letterSpacing: 0.3,
  },

  // Title
  title: {
    fontSize:      28,
    fontWeight:    '700',
    letterSpacing: -0.5,
    lineHeight:    36,
  },

  // Body text
  bodyText: {
    fontSize:   16,
    fontWeight: '400',
    lineHeight: 26,
  },

  // CTA footer
  footer: {
    paddingHorizontal: 24,
  },
  ctaBtn: {
    height:         56,
    borderRadius:   18,
    alignItems:     'center',
    justifyContent: 'center',
    shadowColor:    'rgba(36,100,93,0.35)',
    shadowOffset:   { width: 0, height: 6 },
    shadowOpacity:  1,
    shadowRadius:   14,
    elevation:      6,
  },
  ctaText: {
    color:         '#FFFFFF',
    fontSize:      17,
    fontWeight:    '600',
    letterSpacing: -0.2,
  },
});
