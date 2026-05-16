import { useState, useCallback, memo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/context/ThemeContext';
import GuideStepCard from '@/components/guides/GuideStepCard';
import GuideSegmentedControl from '@/components/guides/GuideSegmentedControl';
import PrayerPhraseBlock from '@/components/guides/PrayerPhraseBlock';
import RakAhSummaryCard from '@/components/guides/RakAhSummaryCard';
import {
  quickGuideSteps,
  fullGuideSteps,
  prayerPhrases,
  prayerInfoItems,
} from '@/data/guides/prayerGuide';
import type { PrayerInfoItem } from '@/data/guides/prayerGuide';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

// ── Extra informationskort ────────────────────────────────────────────────────

const PrayerInfoCard = memo(function PrayerInfoCard({ item }: { item: PrayerInfoItem }) {
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
        <Text style={[styles.infoTitle, { color: T.textMuted }]}>{item.title}</Text>
        <Text style={[styles.infoChevron, {
          color: T.textMuted,
          transform: [{ rotate: expanded ? '90deg' : '0deg' }],
        }]}>›</Text>
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
            if (section.type === 'numbered') {
              return (
                <View key={i} style={styles.listBlock}>
                  {section.items.map((text, j) => (
                    <View key={j} style={styles.listRow}>
                      <Text style={[styles.listIndex, { color: T.accent }]}>{j + 1}.</Text>
                      <View style={styles.listTextWrap}>
                        <Text style={[styles.listText, { color: T.textMuted }]}>{text}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              );
            }
            if (section.type === 'bold_text') {
              return (
                <Text key={i} style={[styles.infoText, { color: T.text, fontWeight: '700' }]}>
                  {section.text}
                </Text>
              );
            }
            if (section.type === 'italic_text') {
              return (
                <Text key={i} style={[styles.infoText, { color: T.textMuted, fontStyle: 'italic' }]}>
                  {section.text}
                </Text>
              );
            }
            if (section.type === 'inline_mixed') {
              return (
                <Text key={i} style={[styles.infoText, { color: T.textMuted }]}>
                  {section.parts.map((part, j) =>
                    part.highlight
                      ? <Text key={j} style={{ color: T.accent, fontWeight: '600' }}>{part.text}</Text>
                      : <Text key={j}>{part.text}</Text>
                  )}
                </Text>
              );
            }
            if (section.type === 'bullets') {
              return (
                <View key={i} style={styles.listBlock}>
                  {section.items.map((text, j) => (
                    <View key={j} style={styles.listRow}>
                      <Text style={[styles.listIndex, { color: T.accent }]}>•</Text>
                      <View style={styles.listTextWrap}>
                        <Text style={[styles.listText, { color: T.textMuted }]}>{text}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              );
            }
            // bold_items
            return (
              <View key={i} style={styles.listBlock}>
                {section.items.map((item, j) => (
                  <View key={j} style={styles.listRow}>
                    <View style={styles.listTextWrap}>
                      <Text style={[styles.listText, { color: T.textMuted }]}>
                        <Text style={{ fontWeight: '700', color: T.text }}>{item.label} </Text>
                        {item.description}
                      </Text>
                    </View>
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

const SEGMENTS = ['Fullständig', 'Snabbguide', 'Vad säger jag?'];

export default function PrayerStepsScreen() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = useCallback((index: number) => {
    setActiveTab(index);
  }, []);

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
            Hur man ber
          </Text>
          <Text style={[styles.headerSubtitle, { color: T.textMuted }]}>
            Lär dig bönen steg för steg
          </Text>
        </View>
      </View>

      {/* Segmented control — outside ScrollView so it stays fixed */}
      <View style={styles.segmentWrap}>
        <GuideSegmentedControl
          segments={SEGMENTS}
          selectedIndex={activeTab}
          onChange={handleTabChange}
        />
      </View>

      {/* Content */}
      <ScrollView
        key={activeTab}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Tab 0: Fullständig guide ── */}
        {activeTab === 0 && (
          <>
            {fullGuideSteps.map((step) => (
              <GuideStepCard
                key={step.id}
                step={step}
                totalSteps={fullGuideSteps.length}
                expandable
              />
            ))}
            <View style={styles.rakahSection}>
              <Text style={[styles.sectionLabel, { color: T.textMuted }]}>
                Antal rak&#39;ah
              </Text>
              <RakAhSummaryCard />
            </View>
            <InfoSection T={T} />
          </>
        )}

        {/* ── Tab 1: Snabbguide ── */}
        {activeTab === 1 && (
          <>
            {quickGuideSteps.map((step) => (
              <GuideStepCard
                key={step.id}
                step={step}
                totalSteps={quickGuideSteps.length}
                expandable={false}
              />
            ))}
            <InfoSection T={T} />
          </>
        )}

        {/* ── Tab 2: Vad säger jag? ── */}
        {activeTab === 2 && (
          <>
            {prayerPhrases.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.phraseCard,
                  {
                    backgroundColor: T.card,
                    borderColor: T.border,
                    shadowOpacity: isDark ? 0.14 : 0.06,
                  },
                ]}
              >
                <View style={styles.phraseHeader}>
                  <Text style={[styles.phrasePosition, { color: T.accent }]}>
                    {item.position}
                  </Text>
                  {item.repeat ? (
                    <View
                      style={[
                        styles.repeatPill,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255,255,255,0.07)'
                            : 'rgba(0,0,0,0.05)',
                        },
                      ]}
                    >
                      <Text style={[styles.repeatText, { color: T.accent }]}>
                        {item.repeat}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.phraseWhen, { color: T.textMuted }]}>
                  {item.when}
                </Text>
                <PrayerPhraseBlock
                  phrase={{
                    transliteration: item.transliteration,
                    meaning: item.meaning,
                  }}
                />
              </View>
            ))}

            <View style={styles.rakahSection}>
              <Text style={[styles.sectionLabel, { color: T.textMuted }]}>
                Antal rak&#39;ah
              </Text>
              <RakAhSummaryCard />
            </View>
            <InfoSection T={T} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Delad Mer information-sektion ─────────────────────────────────────────────

function InfoSection({ T }: { T: any }) {
  return (
    <View style={styles.infoSection}>
      <Text style={[styles.infoSectionLabel, { color: T.textMuted }]}>
        Mer information
      </Text>
      {prayerInfoItems.map((item) => (
        <PrayerInfoCard key={item.id} item={item} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  headerTextBlock: {
    flex: 1,
  },
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
  segmentWrap: {
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  phraseCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },
  phraseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  phrasePosition: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  phraseWhen: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 2,
  },
  repeatPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  repeatText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  rakahSection: {
    marginTop: 8,
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
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
  listBlock: {
    gap: 7,
    marginTop: 2,
  },
  listRow: {
    flexDirection: 'row',
    gap: 7,
  },
  listIndex: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
    minWidth: 18,
  },
  listTextWrap: {
    flex: 1,
  },
  listText: {
    fontSize: 13,
    lineHeight: 20,
  },
});
