/**
 * HajjHeroHeader — hero image with floating rounded text card.
 * Identical layout to UmrahHeroHeader but sources images from hajjGuideData.
 */

import React, { memo } from 'react';
import { View, Text, Image, StyleSheet, useWindowDimensions } from 'react-native';
import type { UmrahTheme } from '@/components/umrah/umrahTheme';
import {
  HAJJ_HERO_IMAGE_SOURCES,
  HAJJ_HERO_BG_COLORS,
  HAJJ_HERO_IMAGE_CONFIG,
} from '@/data/hajjGuideData';

type Props = {
  T:            UmrahTheme;
  heroKey:      string;
  title:        string;
  subtitle:     string;
  stepNumber:   number;
  totalSteps:   number;
  showProgress: boolean;
  isWelcome?:   boolean;
};

const IMAGE_ASPECT = 800 / 1170;

function HajjHeroHeader({
  T, heroKey, title, subtitle, stepNumber, totalSteps, showProgress, isWelcome = false,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const imageSource = HAJJ_HERO_IMAGE_SOURCES[heroKey] ?? null;
  const config      = HAJJ_HERO_IMAGE_CONFIG[heroKey];
  const fit         = config?.fit     ?? 'cover';
  const bgColor     = config?.bgColor ?? (HAJJ_HERO_BG_COLORS[heroKey] ?? '#1A3D36');
  const offsetY     = config?.offsetY ?? 0;
  const height      = Math.round(screenWidth * IMAGE_ASPECT);

  const cardBg = T.isDark
    ? 'rgba(10, 16, 28, 0.65)'
    : 'rgba(255, 255, 255, 0.62)';

  return (
    <View style={[styles.root, { height, backgroundColor: bgColor }]}>
      {imageSource != null && (
        <View style={[StyleSheet.absoluteFill, styles.imageWrapper]}>
          <Image
            source={imageSource}
            style={[
              { width: screenWidth, height },
              offsetY !== 0 && { transform: [{ translateY: offsetY }] },
            ]}
            resizeMode={fit}
          />
        </View>
      )}

      <View style={styles.cardAnchor}>
        <View style={[
          styles.textCard,
          {
            backgroundColor: cardBg,
            borderColor:     T.border,
            shadowColor:     T.isDark ? '#000' : 'rgba(0,0,0,0.25)',
          },
        ]}>
          {showProgress && !isWelcome && (
            <View style={[styles.progressPill, { backgroundColor: T.accentSoft }]}>
              <Text style={[styles.progressText, { color: T.accent }]}>
                Steg {stepNumber} av {totalSteps}
              </Text>
            </View>
          )}

          <Text
            style={[
              styles.title,
              isWelcome && styles.titleLarge,
              { color: T.text },
            ]}
            numberOfLines={2}
          >
            {title}
          </Text>

          <Text
            style={[styles.subtitle, { color: T.textSecondary }]}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width:    '100%',
    overflow: 'hidden',
  },
  imageWrapper: {
    overflow: 'hidden',
  },
  cardAnchor: {
    position: 'absolute',
    bottom:   16,
    left:     16,
    right:    16,
  },
  textCard: {
    alignSelf:         'flex-start',
    maxWidth:          '80%',
    borderRadius:      14,
    borderWidth:       0.5,
    paddingHorizontal: 13,
    paddingVertical:   10,
    shadowOffset:      { width: 0, height: 3 },
    shadowOpacity:     0.20,
    shadowRadius:      10,
  },
  progressPill: {
    alignSelf:         'flex-start',
    borderRadius:      10,
    paddingHorizontal: 10,
    paddingVertical:   3,
    marginBottom:      9,
  },
  progressText: {
    fontSize:      11,
    fontWeight:    '600',
    letterSpacing: 0.3,
  },
  title: {
    fontSize:         22,
    fontWeight:       '700',
    letterSpacing:    -0.3,
    marginBottom:     4,
    textShadowColor:  'rgba(0,0,0,0.08)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  titleLarge: {
    fontSize:      26,
    letterSpacing: -0.5,
    marginBottom:  5,
  },
  subtitle: {
    fontSize:         13,
    fontWeight:       '400',
    lineHeight:       18,
    letterSpacing:    0.1,
    textShadowColor:  'rgba(0,0,0,0.05)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
});

export default memo(HajjHeroHeader);
