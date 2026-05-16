import React, { useState, useCallback, memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/context/ThemeContext';
import type { GuideStep } from '@/data/guides/guideTypes';
import GuideIllustration from './GuideIllustration';
import PrayerPhraseBlock from './PrayerPhraseBlock';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

type Props = {
  step: GuideStep;
  totalSteps?: number;
  expandable?: boolean;
  initiallyExpanded?: boolean;
};

function GuideStepCard({
  step,
  totalSteps,
  expandable = true,
  initiallyExpanded = false,
}: Props) {
  const { theme: T, isDark } = useTheme();
  const [expanded, setExpanded] = useState(initiallyExpanded);

  const toggle = useCallback(() => {
    if (!expandable) return;
    LayoutAnimation.configureNext(
      LayoutAnimation.create(200, 'easeInEaseOut', 'opacity')
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((v) => !v);
  }, [expandable]);

  const hasDetails =
    step.detailedDescription || step.say || (step.notes && step.notes.length > 0);

  const showChevron = expandable && hasDetails;

  return (
    <TouchableOpacity
      onPress={toggle}
      activeOpacity={expandable && hasDetails ? 0.75 : 1}
      accessibilityLabel={`Steg ${step.stepNumber}: ${step.title}`}
      accessibilityHint={
        expandable && hasDetails
          ? expanded
            ? 'Tryck för att dölja detaljer'
            : 'Tryck för att visa detaljer'
          : undefined
      }
      style={[
        styles.card,
        {
          backgroundColor: T.card,
          borderColor: T.border,
          shadowOpacity: isDark ? 0.14 : 0.07,
        },
      ]}
    >
      {/* Header row */}
      <View style={styles.headerRow}>
        {/* Illustration */}
        <GuideIllustration
          illustrationKey={step.illustrationKey}
          size={56}
          variant="compact"
        />

        {/* Step badge */}
        <View
          style={[
            styles.badge,
            {
              backgroundColor: isDark
                ? `${T.accent}22`
                : `${T.accent}18`,
              borderColor: isDark ? `${T.accent}44` : `${T.accent}33`,
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: T.accent }]}>
            {step.stepNumber}
            {totalSteps ? `/${totalSteps}` : ''}
          </Text>
        </View>

        {/* Title + short desc */}
        <View style={styles.textBlock}>
          <Text style={[styles.title, { color: T.text }]} numberOfLines={2}>
            {step.title}
          </Text>
          <Text
            style={[styles.shortDesc, { color: T.textMuted }]}
            numberOfLines={expanded ? undefined : 2}
          >
            {step.shortDescription}
          </Text>
        </View>

        {/* Chevron */}
        {showChevron && (
          <Text
            style={[
              styles.chevron,
              { color: T.textMuted, transform: [{ rotate: expanded ? '90deg' : '0deg' }] },
            ]}
          >
            ›
          </Text>
        )}
      </View>

      {/* Expanded content */}
      {expanded && hasDetails && (
        <View style={[styles.expanded, { borderTopColor: T.separator }]}>
          {step.detailedDescription ? (
            <Text style={[styles.detailedDesc, { color: T.textSecondary ?? T.textMuted }]}>
              {step.detailedDescription}
            </Text>
          ) : null}

          {step.say ? <PrayerPhraseBlock phrase={step.say} /> : null}

          {step.notes && step.notes.length > 0 ? (
            <View style={styles.notesBlock}>
              {step.notes.map((note, i) => (
                <View key={i} style={styles.noteRow}>
                  <Text style={[styles.noteBullet, { color: T.accent }]}>•</Text>
                  <Text style={[styles.noteText, { color: T.textMuted }]}>
                    {note}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <TouchableOpacity
            onPress={toggle}
            style={styles.collapseBtn}
            accessibilityLabel="Visa mindre"
            hitSlop={{ top: 6, bottom: 6, left: 16, right: 16 }}
          >
            <Text style={[styles.collapseBtnText, { color: T.accent }]}>
              Visa mindre
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* "Visa mer" hint when collapsed and has details */}
      {!expanded && expandable && hasDetails && (
        <Text style={[styles.showMore, { color: T.accent }]}>Visa mer</Text>
      )}
    </TouchableOpacity>
  );
}

export default memo(GuideStepCard);

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  badge: {
    borderRadius: 8,
    borderWidth: 0.5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: -0.1,
    marginBottom: 3,
  },
  shortDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 26,
    marginLeft: 2,
    marginTop: -2,
  },
  expanded: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailedDesc: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 2,
  },
  notesBlock: {
    marginTop: 10,
    gap: 5,
  },
  noteRow: {
    flexDirection: 'row',
    gap: 6,
  },
  noteBullet: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  collapseBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  collapseBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  showMore: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    marginLeft: 66,
  },
});
