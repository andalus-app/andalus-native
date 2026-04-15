import React, { useRef, useEffect } from 'react';
import { TouchableOpacity, Animated } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

const NORMAL_COLOR = '#8E8E93';

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  const glowAnim = useRef(new Animated.Value(0)).current;
  const riseAnim = useRef(new Animated.Value(14)).current;
  const opacAnim = useRef(new Animated.Value(0)).current;

  // Visa normal ikon direkt vid mount (opacity 1, ingen glow)
  useEffect(() => {
    opacAnim.setValue(1);
    riseAnim.setValue(0);
    glowAnim.setValue(0);
  }, []);

  const GLOW_COLOR = isDark ? '#FFFFFF' : '#FFD60A';

  function handlePress() {
    toggleTheme();
    // 1. Sätt ikonen nedanför och osynlig
    riseAnim.setValue(14);
    opacAnim.setValue(0);
    glowAnim.setValue(0);

    // 2. Stiger upp + tonas in + glöder
    Animated.sequence([
      Animated.parallel([
        Animated.timing(riseAnim, { toValue: 0, duration: 450, useNativeDriver: true }),
        Animated.timing(opacAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 1, duration: 450, useNativeDriver: false }),
      ]),
      Animated.delay(1500),
      // 3. Glow försvinner, ikonen stannar
      Animated.timing(glowAnim, { toValue: 0, duration: 500, useNativeDriver: false }),
    ]).start();
  }

  // Interpolera stroke/fill-färg
  const iconColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [NORMAL_COLOR, GLOW_COLOR],
  });

  // Vi ritar ALLTID månen i dark-mode och solen i light-mode
  // men använder AnimatedCircle/AnimatedPath via workaround:
  // Rita två lager — normal (opacity styrd av glow=0) och glow (opacity=glow)
  return (
    <TouchableOpacity
      style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
      onPress={handlePress}
    >
      <Animated.View
        style={{
          transform: [{ translateY: riseAnim }],
          opacity: opacAnim,
        }}
      >
        {/* Normal-ikon lager (NORMAL_COLOR, synlig när glow=0) */}
        <Animated.View style={{ position: 'absolute', opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
          {isDark ? <MoonIcon color={NORMAL_COLOR} /> : <SunIcon color={NORMAL_COLOR} />}
        </Animated.View>
        {/* Glow-ikon lager (GLOW_COLOR, synlig när glow=1) */}
        <Animated.View style={{ opacity: glowAnim }}>
          {isDark ? <MoonIconFilled color={GLOW_COLOR} /> : <SunIconFilled color={GLOW_COLOR} />}
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

function SunIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="4.5" stroke={color} strokeWidth="1.7" fill="none"/>
      <Path d="M12 2V4M12 20V22M2 12H4M20 12H22M4.93 4.93L6.34 6.34M17.66 17.66L19.07 19.07M19.07 4.93L17.66 6.34M6.34 17.66L4.93 19.07"
        stroke={color} strokeWidth="1.7" strokeLinecap="round"/>
    </Svg>
  );
}

function SunIconFilled({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="4.5" stroke={color} strokeWidth="1.7" fill={color}/>
      <Path d="M12 2V4M12 20V22M2 12H4M20 12H22M4.93 4.93L6.34 6.34M17.66 17.66L19.07 19.07M19.07 4.93L17.66 6.34M6.34 17.66L4.93 19.07"
        stroke={color} strokeWidth="1.7" strokeLinecap="round"/>
    </Svg>
  );
}

function MoonIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </Svg>
  );
}

function MoonIconFilled({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill={color}/>
    </Svg>
  );
}
