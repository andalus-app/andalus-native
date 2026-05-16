import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  LayoutChangeEvent,
} from 'react-native';
import { useTheme } from '@/context/ThemeContext';

type Props = {
  segments: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
};

export default function GuideSegmentedControl({
  segments,
  selectedIndex,
  onChange,
}: Props) {
  const { theme: T, isDark } = useTheme();
  const trackWidth = useRef(0);
  const indicatorX = useRef(new Animated.Value(0)).current;

  const segmentWidth = trackWidth.current / segments.length;

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      trackWidth.current = w;
      const segW = w / segments.length;
      indicatorX.setValue(selectedIndex * segW);
    },
    [segments.length, selectedIndex, indicatorX]
  );

  const handlePress = useCallback(
    (index: number) => {
      if (index === selectedIndex) return;
      const segW = trackWidth.current / segments.length;
      Animated.spring(indicatorX, {
        toValue: index * segW,
        useNativeDriver: true,
        bounciness: 0,
        speed: 20,
      }).start();
      onChange(index);
    },
    [selectedIndex, segments.length, indicatorX, onChange]
  );

  const trackBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const indicatorBg = isDark ? T.cardElevated ?? '#2C2C2E' : '#FFFFFF';
  const indicatorShadow = isDark ? 0.3 : 0.1;

  return (
    <View
      style={[styles.track, { backgroundColor: trackBg }]}
      onLayout={handleLayout}
    >
      {/* Sliding indicator */}
      <Animated.View
        style={[
          styles.indicator,
          {
            width: `${100 / segments.length}%`,
            backgroundColor: indicatorBg,
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            shadowOpacity: indicatorShadow,
            transform: [{ translateX: indicatorX }],
          },
        ]}
      />

      {/* Segment labels */}
      {segments.map((label, index) => (
        <TouchableOpacity
          key={label}
          onPress={() => handlePress(index)}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: index === selectedIndex }}
          style={styles.segment}
        >
          <Text
            style={[
              styles.label,
              {
                color:
                  index === selectedIndex ? T.accent : T.textMuted,
                fontWeight: index === selectedIndex ? '600' : '400',
              },
            ]}
          >
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    position: 'relative',
    marginBottom: 16,
  },
  indicator: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 8,
    borderWidth: 0.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    zIndex: 1,
  },
  label: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
});
