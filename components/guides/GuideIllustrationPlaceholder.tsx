import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '@/context/ThemeContext';

type Props = {
  illustrationKey: string;
  size?: number;
  variant?: 'compact' | 'large';
};

// Simple SVG paths for icon type per prefix
function PlaceholderIcon({
  prefix,
  size,
  color,
}: {
  prefix: 'wudu' | 'prayer' | 'default';
  size: number;
  color: string;
}) {
  const s = size * 0.44;
  if (prefix === 'wudu') {
    // Water drop
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Path
          d="M12 2C12 2 5 10.5 5 15a7 7 0 0014 0C19 10.5 12 2 12 2z"
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  if (prefix === 'prayer') {
    // Person bowing (simplified crescent + dot)
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Circle cx="12" cy="5" r="2.2" fill={color} opacity={0.9} />
        <Path
          d="M12 8.5C9 8.5 7 11 7 13.5L10 15v5"
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <Path
          d="M12 8.5C15 8.5 17 11 17 13.5L14 15v5"
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </Svg>
    );
  }
  // Default: open book
  return (
    <Svg width={s} height={s} viewBox="0 0 24 24">
      <Path
        d="M4 6C4 6 7 5 12 5s8 1 8 1v13s-3-1-8-1-8 1-8 1V6z"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <Path
        d="M12 5v13"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function GuideIllustrationPlaceholder({
  illustrationKey,
  size = 80,
  variant = 'compact',
}: Props) {
  const { theme: T, isDark } = useTheme();

  const prefix: 'wudu' | 'prayer' | 'default' = illustrationKey.startsWith(
    'wudu_'
  )
    ? 'wudu'
    : illustrationKey.startsWith('prayer_')
    ? 'prayer'
    : 'default';

  const accentColor = isDark ? '#8dab8f' : T.accent;
  const bgColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  const borderColor = isDark
    ? 'rgba(255,255,255,0.07)'
    : 'rgba(0,0,0,0.07)';

  const actualSize = variant === 'large' ? size * 1.5 : size;

  return (
    <View
      style={[
        styles.container,
        {
          width: actualSize,
          height: actualSize,
          borderRadius: actualSize * 0.22,
          backgroundColor: bgColor,
          borderColor,
        },
      ]}
      accessibilityLabel="Illustration kommer snart"
    >
      <PlaceholderIcon prefix={prefix} size={actualSize} color={accentColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
