import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import SvgIcon from '@/components/SvgIcon';
import GuideIllustration from './GuideIllustration';

type Props = {
  title: string;
  subtitle: string;
  icon: 'prayer' | 'book' | 'dhikr';
  illustrationKey?: string;
  onPress: () => void;
  accessibilityLabel?: string;
};

export default function GuideCategoryCard({
  title,
  subtitle,
  icon,
  illustrationKey,
  onPress,
  accessibilityLabel,
}: Props) {
  const { theme: T, isDark } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      style={[
        styles.card,
        {
          backgroundColor: T.card,
          borderColor: T.border,
          shadowOpacity: isDark ? 0.18 : 0.07,
        },
      ]}
    >
      {/* Icon or illustration */}
      {illustrationKey ? (
        <GuideIllustration illustrationKey={illustrationKey} size={46} variant="compact" zoomable={false} />
      ) : (
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: isDark ? `${T.accent}1A` : `${T.accent}14`,
              borderColor: isDark ? `${T.accent}33` : `${T.accent}22`,
            },
          ]}
        >
          <SvgIcon name={icon} size={24} color={T.accent} />
        </View>
      )}

      {/* Text */}
      <View style={styles.textBlock}>
        <Text style={[styles.title, { color: T.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: T.textMuted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      {/* Chevron */}
      <Text style={[styles.chevron, { color: T.textMuted }]}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
    gap: 14,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 26,
  },
});
