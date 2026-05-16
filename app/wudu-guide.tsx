import { useState, useCallback, memo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/context/ThemeContext';
import GuideStepCard from '@/components/guides/GuideStepCard';
import { wuduSteps, wuduInfoItems, WUDU_HADITH } from '@/data/guides/wuduGuide';
import type { WuduInfoItem } from '@/data/guides/wuduGuide';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

// ── Extra informationskort ────────────────────────────────────────────────────

const WuduInfoCard = memo(function WuduInfoCard({ item }: { item: WuduInfoItem }) {
  const { theme: T, isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(200, 'easeInEaseOut', 'opacity')
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((v) => !v);
  }, []);

  const cardBg = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)';
  const borderColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  return (
    <TouchableOpacity
      onPress={toggle}
      activeOpacity={0.75}
      accessibilityLabel={item.title}
      accessibilityHint={expanded ? 'Tryck för att dölja' : 'Tryck för att visa mer'}
      style={[styles.infoCard, { backgroundColor: cardBg, borderColor }]}
    >
      <View style={styles.infoHeader}>
        <Text style={[styles.infoTitle, { color: T.textMuted }]}>
          {item.title}
        </Text>
        <Text style={[styles.infoChevron, {
          color: T.textMuted,
          transform: [{ rotate: expanded ? '90deg' : '0deg' }],
        }]}>
          ›
        </Text>
      </View>

      {expanded && (
        <View style={[styles.infoBody, { borderTopColor: T.separator }]}>
          {item.sections.map((section, i) => {
            if (section.type === 'text') {
              return (
                <Text key={i} style={[styles.infoText, { color: T.textMuted }]}>
                  {section.text}
                </Text>
              );
            }
            if (section.type === 'bullets') {
              return (
                <View key={i} style={styles.numberedList}>
                  {section.items.map((text, j) => (
                    <View key={j} style={styles.numberedRow}>
                      <Text style={[styles.numberedIndex, { color: T.accent }]}>•</Text>
                      <Text style={[styles.numberedText, { color: T.textMuted }]}>{text}</Text>
                    </View>
                  ))}
                </View>
              );
            }
            return (
              <View key={i} style={styles.numberedList}>
                {section.items.map((text, j) => (
                  <View key={j} style={styles.numberedRow}>
                    <Text style={[styles.numberedIndex, { color: T.accent }]}>
                      {j + 1}.
                    </Text>
                    <Text style={[styles.numberedText, { color: T.textMuted }]}>
                      {text}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      )}
    </TouchableOpacity>
  );
});

// ── Skärm ─────────────────────────────────────────────────────────────────────

export default function WuduGuideScreen() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Gå tillbaka"
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path
              d="M15 18l-6-6 6-6"
              stroke={T.text}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>

        <View style={styles.headerTextBlock}>
          <Text style={[styles.headerTitle, { color: T.text }]}>
            Hur man tvagar sig
          </Text>
          <Text style={[styles.headerSubtitle, { color: T.textMuted }]}>
            Lär dig wudu steg för steg
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Wudu-stegen */}
        {wuduSteps.map((step) => (
          <GuideStepCard
            key={step.id}
            step={step}
            totalSteps={wuduSteps.length}
            expandable
          />
        ))}

        {/* Hadith-kort */}
        <View style={[styles.hadithCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderColor: isDark ? `${T.accent}44` : `${T.accent}33`, borderLeftColor: T.accent }]}>
          <Text style={[styles.hadithTitle, { color: T.accent }]}>
            {WUDU_HADITH.title}
          </Text>
          <Text style={[styles.hadithNarrator, { color: T.textMuted }]}>
            {WUDU_HADITH.narrator}
          </Text>
          <Text style={[styles.hadithText, { color: T.text }]}>
            "{WUDU_HADITH.text}"
          </Text>
          <Text style={[styles.hadithReference, { color: T.textMuted }]}>
            [{WUDU_HADITH.reference}]
          </Text>
        </View>

        {/* Extra informationskort */}
        <View style={styles.infoSection}>
          <Text style={[styles.infoSectionLabel, { color: T.textMuted }]}>
            Mer information
          </Text>
          {wuduInfoItems.map((item) => (
            <WuduInfoCard key={item.id} item={item} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  headerTextBlock: { flex: 1 },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  // Hadith-kort
  hadithCard: {
    borderRadius: 12,
    borderWidth: 0.5,
    borderLeftWidth: 3,
    padding: 14,
    marginTop: 16,
    marginBottom: 4,
    gap: 5,
  },
  hadithTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  hadithNarrator: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  hadithText: {
    fontSize: 13,
    lineHeight: 20,
    fontStyle: 'italic',
    marginTop: 2,
  },
  hadithReference: {
    fontSize: 11,
    marginTop: 4,
    alignSelf: 'flex-end',
  },

  // Extra informationskort
  infoSection: {
    marginTop: 16,
  },
  infoSectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
  infoCard: {
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    letterSpacing: -0.1,
    paddingRight: 8,
  },
  infoChevron: {
    fontSize: 20,
    lineHeight: 24,
  },
  infoBody: {
    marginTop: 10,
    paddingTop: 10,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 20,
  },
  numberedList: {
    marginTop: 2,
  },
  numberedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 14,
  },
  numberedIndex: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 22,
    width: 36,
    flexShrink: 0,
  },
  numberedText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 22,
    flexShrink: 1,
    flexWrap: 'wrap',
    includeFontPadding: false,
  },
});
